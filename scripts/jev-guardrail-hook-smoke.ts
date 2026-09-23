/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One opt-in live request through the real Pi extension loader and tool_call hook.
 * The registered read tool only increments a counter; it reads no file contents.
 *
 * OPENROUTER_API_KEY_FILE=/absolute/key/path node --experimental-strip-types \
 *   scripts/jev-guardrail-hook-smoke.ts
 * Add --prepare-only to exercise SDK setup without reading credentials or calling Jev.
 */
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createEventBus,
  discoverAndLoadExtensions,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import {
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
} from "../extensions/sf-guardrail/lib/jev-client.ts";
import {
  DECISION_ENTRY_TYPE,
  type DecisionEntryData,
  type JevEvidence,
  type JevQuestionId,
  type JevRequest,
} from "../extensions/sf-guardrail/lib/types.ts";

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const EXECUTION_ENTRY_TYPE = "sf-guardrail-hook-smoke-execution";
const PRIVATE_FILE_MARKER = "private-file-body-must-stay-local-hook-smoke";
const QUESTION_IDS: JevQuestionId[] = [
  "risk",
  "file_policy",
  "command_policy",
  "org_policy",
  "disclosure",
  "authority",
];
const GUARDRAIL_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../extensions/sf-guardrail/index.ts",
);

export interface HookSmokeReport {
  success: boolean;
  preparedOnly: boolean;
  proofLevel: "actual-sdk-hook-with-inert-tool" | "sdk-preparation-only";
  model: string | null;
  provider: string | null;
  requestId: string | null;
  /** These are the risk answer's probabilities, never a synthesized combined score. */
  probabilityQuestion: "risk";
  probabilities: JevEvidence["probabilities"] | null;
  confidence: number | null;
  cost: number | null;
  latencyMs: number | null;
  outcome: string | null;
  audit: { ruleId: string; feature: string; outcome: string; jev: JevEvidence } | null;
  executionCount: number;
  requests: number;
  requestBytes: number;
  questionIds: JevQuestionId[];
  wirePrivacySuccess: boolean;
  failure: string | null;
}

/** Isolate all Pi state and restore environment/fetch even when setup or the hook fails. */
export async function runHookSmoke(
  options: { prepareOnly?: boolean } = {},
): Promise<HookSmokeReport> {
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalFetch = globalThis.fetch;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sf-pi-jev-hook-smoke-"));
  const agentDir = join(temporaryRoot, "agent");
  const cwd = join(temporaryRoot, "project");
  const readmePath = join(cwd, "README.md");
  let runner: ExtensionRunner | undefined;
  let hookActive = false;
  const report: HookSmokeReport = {
    success: false,
    preparedOnly: options.prepareOnly === true,
    proofLevel: options.prepareOnly ? "sdk-preparation-only" : "actual-sdk-hook-with-inert-tool",
    model: null,
    provider: null,
    requestId: null,
    probabilityQuestion: "risk",
    probabilities: null,
    confidence: null,
    cost: null,
    latencyMs: null,
    outcome: null,
    audit: null,
    executionCount: 0,
    requests: 0,
    requestBytes: 0,
    questionIds: [],
    wirePrivacySuccess: false,
    failure: null,
  };
  try {
    await mkdir(agentDir, { recursive: true });
    await mkdir(cwd, { recursive: true });
    await writeFile(join(agentDir, "settings.json"), '{"sfPi":{"guardrail":{"engine":"jev"}}}\n', {
      mode: 0o600,
    });
    await writeFile(readmePath, `${PRIVATE_FILE_MARKER}\n`, { mode: 0o600 });
    const resolvedReadmePath = await realpath(readmePath);
    const inertExtensionPath = join(temporaryRoot, "inert-read.ts");
    await writeFile(inertExtensionPath, inertReadExtension(), { mode: 0o600 });
    process.env.PI_CODING_AGENT_DIR = agentDir;

    // Inspect the bounded body only. Never inspect or retain authorization headers.
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!hookActive || url !== ENDPOINT || init?.method !== "POST" || report.requests !== 0) {
        throw new Error("unexpected-smoke-network-call");
      }
      report.requests += 1;
      if (typeof init.body !== "string" || Buffer.byteLength(init.body) > 32 * 1024) {
        throw new Error("invalid-smoke-wire-body");
      }
      report.requestBytes = Buffer.byteLength(init.body);
      report.wirePrivacySuccess = wirePrivacyPasses(init.body, readmePath, cwd, resolvedReadmePath);
      if (!report.wirePrivacySuccess) throw new Error("smoke-wire-privacy-failure");
      report.questionIds = Object.keys(
        (JSON.parse(init.body) as JevRequest).questions,
      ) as JevQuestionId[];
      return originalFetch(input, init);
    };

    const eventBus = createEventBus();
    const loaded = await discoverAndLoadExtensions(
      [GUARDRAIL_PATH, inertExtensionPath],
      cwd,
      agentDir,
      eventBus,
    );
    if (loaded.errors.length || loaded.extensions.length !== 2) {
      report.failure = "sdk-extension-load-failure";
      return report;
    }
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"),
      modelsPath: null,
      modelsStorePath: join(agentDir, "models-store.json"),
      allowModelNetwork: false,
      refreshOnCreate: false,
    });
    const sessionManager = SessionManager.inMemory(cwd);
    runner = new ExtensionRunner(
      loaded.extensions,
      loaded.runtime,
      cwd,
      sessionManager,
      new ModelRegistry(modelRuntime),
    );
    const controller = new AbortController();
    const unexpectedAction = () => {
      throw new Error("unexpected-smoke-runtime-action");
    };
    runner.bindCore(
      {
        sendMessage: unexpectedAction,
        sendUserMessage: unexpectedAction,
        appendEntry: (type, data) => {
          sessionManager.appendCustomEntry(type, data);
        },
        setSessionName: (name) => {
          sessionManager.appendSessionInfo(name);
        },
        getSessionName: () => sessionManager.getSessionName(),
        setLabel: (id, label) => {
          sessionManager.appendLabelChange(id, label);
        },
        getActiveTools: () => ["read"],
        getAllTools: () =>
          runner?.getAllRegisteredTools().map(({ definition, sourceInfo }) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            sourceInfo,
          })) ?? [],
        setActiveTools: unexpectedAction,
        refreshTools: unexpectedAction,
        getCommands: () => [],
        setModel: async () => false,
        getThinkingLevel: () => "off",
        setThinkingLevel: unexpectedAction,
      },
      {
        getModel: () => undefined,
        getScopedModels: () => [],
        isIdle: () => true,
        isProjectTrusted: () => true,
        getSignal: () => controller.signal,
        abort: () => controller.abort(),
        hasPendingMessages: () => false,
        shutdown: unexpectedAction,
        getContextUsage: () => undefined,
        compact: unexpectedAction,
        getSystemPrompt: () => "",
      },
    );
    runner.onError(() => {
      report.failure = "sdk-runtime-error";
    });
    await runner.emit({ type: "session_start", reason: "startup" });
    if (!runner.hasHandlers("tool_call") || !runner.getToolDefinition("read") || report.failure) {
      report.failure ??= "sdk-hook-or-tool-missing";
      return report;
    }
    if (options.prepareOnly) {
      report.success = report.requests === 0;
      return report;
    }

    const toolCallId = "jev-live-hook-smoke-read";
    const input = { path: readmePath };
    hookActive = true;
    const result = await runner.emitToolCall({
      type: "tool_call",
      toolCallId,
      toolName: "read",
      input,
    });
    hookActive = false;
    const audits = sessionManager
      .getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === DECISION_ENTRY_TYPE);
    const lastAudit = audits.at(-1);
    const audit = lastAudit?.type === "custom" ? (lastAudit.data as DecisionEntryData) : undefined;
    if (audits.length !== 1 || audit?.feature !== "jevGate" || !audit.jev) {
      report.failure = "smoke-jev-audit-missing";
      return report;
    }
    const evidence = audit.jev;
    Object.assign(report, {
      model: evidence.model,
      provider: evidence.provider ?? null,
      requestId: evidence.requestId ?? null,
      probabilities: evidence.probabilities ?? null,
      confidence: evidence.confidence ?? null,
      cost: evidence.cost ?? null,
      latencyMs: evidence.latencyMs,
      outcome: audit.outcome,
      audit: {
        ruleId: audit.ruleId,
        feature: audit.feature,
        outcome: audit.outcome,
        jev: evidence,
      },
    });
    const validDecision =
      !result?.block &&
      audit.outcome === "allow_auto" &&
      evidence.model === JEV_RESOLVED_MODEL &&
      evidence.provider === JEV_PROVIDER &&
      Boolean(evidence.requestId) &&
      evidence.probabilities !== undefined &&
      evidence.probabilities.allow >= 0.99 &&
      evidence.confidence !== undefined &&
      evidence.answers !== undefined &&
      Object.keys(evidence.answers).length === report.questionIds.length &&
      report.questionIds.every(
        (id) =>
          evidence.answers?.[id]?.choice === "allow" &&
          (evidence.answers[id]?.probabilities.allow ?? 0) >= 0.99,
      ) &&
      !evidence.failure;
    if (validDecision && report.wirePrivacySuccess && report.requests === 1) {
      const tool = runner.getToolDefinition("read");
      if (!tool) throw new Error("smoke-read-tool-missing");
      await tool.execute(toolCallId, input, controller.signal, undefined, runner.createContext());
    }
    const executions = sessionManager
      .getEntries()
      .filter((entry) => entry.type === "custom" && entry.customType === EXECUTION_ENTRY_TYPE);
    report.executionCount = executions.length;
    report.success =
      validDecision &&
      report.wirePrivacySuccess &&
      report.requests === 1 &&
      report.executionCount === 1 &&
      !report.failure;
    if (!report.success)
      report.failure ??=
        evidence.failure ?? (result?.block ? "smoke-hook-blocked" : "smoke-acceptance-failed");
    return report;
  } catch {
    // SDK exceptions can contain local paths or request details. Return only a fixed category.
    report.failure ??= "smoke-setup-or-hook-failure";
    return report;
  } finally {
    hookActive = false;
    try {
      runner?.invalidate("Jev smoke finished.");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

function wirePrivacyPasses(
  body: string,
  readmePath: string,
  cwd: string,
  resolvedReadmePath: string,
): boolean {
  if (body.includes(PRIVATE_FILE_MARKER)) return false;
  const request = JSON.parse(body) as JevRequest & {
    provider?: { only?: string[]; allow_fallbacks?: boolean };
  };
  const state = request.state as {
    version?: number;
    operation?: { toolName?: string; complete?: boolean; metadata?: Record<string, unknown> };
    facts?: {
      files?: Array<{
        path?: string;
        exists?: boolean;
        resolvedPath?: string;
        absolutePath?: string;
        relativePath?: string;
        basename?: string;
        homeRelativePath?: string;
      }>;
    };
    policy?: { files?: unknown[] };
    observations?: {
      contextComplete?: boolean;
      rowLimit?: { runnerCap?: number; effectiveMaximum?: number; bucket?: string };
    };
  };
  const operation = state.operation;
  const metadata = operation?.metadata;
  const questionIds = Object.keys(request.questions);
  const file = state.facts?.files?.[0];
  const filePathFields = [
    "path",
    "resolvedPath",
    "absolutePath",
    "relativePath",
    "basename",
    "homeRelativePath",
  ];
  const homeRelative = relative(resolve(process.env.HOME || homedir()), readmePath);
  const insideHome =
    homeRelative !== ".." && !homeRelative.startsWith(`..${sep}`) && !isAbsolute(homeRelative);
  const expectedHomeRelative = insideHome
    ? homeRelative
      ? `~/${homeRelative.split(sep).join("/")}`
      : "~"
    : undefined;
  const fileVariantsValid =
    file?.absolutePath === readmePath &&
    file.relativePath === relative(resolve(cwd), readmePath) &&
    file.basename === basename(readmePath) &&
    file.resolvedPath === resolvedReadmePath &&
    file.homeRelativePath === expectedHomeRelative &&
    filePathFields.every((key) => {
      const value = file[key as keyof typeof file];
      return (
        value === undefined ||
        (typeof value === "string" &&
          Buffer.byteLength(value) <= 4096 &&
          !/[\x00-\x1f\x7f]/.test(value))
      );
    });
  const rowLimit = state.observations?.rowLimit;
  const rowLimitValid =
    rowLimit === undefined ||
    (Object.keys(rowLimit).sort().join(",") === "bucket,effectiveMaximum,runnerCap" &&
      rowLimit.runnerCap === 2000 &&
      Number.isInteger(rowLimit.effectiveMaximum) &&
      (rowLimit.effectiveMaximum ?? 0) >= 1 &&
      (rowLimit.effectiveMaximum ?? 0) <= 2000 &&
      ["bounded", "large"].includes(rowLimit.bucket ?? ""));
  return (
    request.model === JEV_MODEL &&
    Object.keys(request).sort().join(",") === "model,provider,questions,state" &&
    Object.keys(request.provider ?? {})
      .sort()
      .join(",") === "allow_fallbacks,only" &&
    request.provider?.allow_fallbacks === false &&
    request.provider.only?.length === 1 &&
    request.provider.only[0] === "typesafe" &&
    state.version === 4 &&
    Object.keys(state).sort().join(",") === "facts,observations,operation,policy,version" &&
    operation?.toolName === "read" &&
    operation.complete === true &&
    Object.keys(operation).every((key) =>
      ["toolName", "metadata", "omissions", "complete"].includes(key),
    ) &&
    Boolean(metadata) &&
    Object.keys(metadata ?? {}).every((key) => ["path", "paths", "parameterShape"].includes(key)) &&
    Array.isArray(metadata?.paths) &&
    metadata.paths.length === 1 &&
    metadata.paths[0] === readmePath &&
    state.facts?.files?.length === 1 &&
    state.facts.files[0].path === readmePath &&
    state.facts.files[0].exists === true &&
    fileVariantsValid &&
    Object.keys(state.facts).every((key) => key === "files") &&
    Object.keys(state.facts.files[0]).every((key) => ["exists", ...filePathFields].includes(key)) &&
    Object.keys(state.policy ?? {}).join(",") === "files" &&
    Array.isArray(state.policy?.files) &&
    state.observations?.contextComplete === true &&
    Object.keys(state.observations).every((key) => ["contextComplete", "rowLimit"].includes(key)) &&
    rowLimitValid &&
    questionIds.includes("risk") &&
    questionIds.slice().sort().join(",") === "disclosure,file_policy,risk" &&
    questionIds.length <= QUESTION_IDS.length &&
    questionIds.every((id) => QUESTION_IDS.includes(id as JevQuestionId)) &&
    questionIds.every((id) => {
      const question = request.questions[id as JevQuestionId];
      return (
        question?.type === "choice" &&
        Object.keys(question.criteria).sort().join(",") === "allow,block,confirm"
      );
    })
  );
}

function inertReadExtension(): string {
  return `import { Type } from "typebox";
export default function inertRead(pi) {
  let executionCount = 0;
  pi.registerTool({
    name: "read", label: "Inert smoke read",
    description: "Read a local project text file without modifying it.",
    parameters: Type.Object({ path: Type.String() }),
    async execute(_id, _input, _signal, _onUpdate, ctx) {
      const audit = ctx.sessionManager.getEntries().filter(entry => entry.type === "custom" && entry.customType === ${JSON.stringify(DECISION_ENTRY_TYPE)}).at(-1);
      if (audit?.data?.feature !== "jevGate" || audit.data.outcome !== "allow_auto") throw new Error("smoke-execution-before-jev-audit");
      executionCount += 1;
      pi.appendEntry(${JSON.stringify(EXECUTION_ENTRY_TYPE)}, { executionCount, auditedBeforeExecution: true });
      return { content: [{ type: "text", text: "Inert callback executed; no file contents were read." }], details: { executionCount } };
    }
  });
}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--prepare-only")) {
    console.error(
      "Usage: node --experimental-strip-types scripts/jev-guardrail-hook-smoke.ts [--prepare-only]",
    );
    process.exitCode = 2;
  } else {
    const report = await runHookSmoke({ prepareOnly: args.includes("--prepare-only") });
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
  }
}
