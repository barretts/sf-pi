/* SPDX-License-Identifier: Apache-2.0 */
/**
 * One opt-in live classification through the real Pi extension loader and tool_call hook.
 * The registered read tool only increments a counter; it reads no file contents.
 *
 * Set SF_GUARDRAIL_JEV_ENDPOINT and SF_GUARDRAIL_JEV_API_KEY or
 * SF_GUARDRAIL_JEV_API_KEY_FILE. Add --live to send a request.
 * No arguments or --prepare-only use strict synthetic stage replies through the SDK hook.
 * This mode reads no real key, sends no provider request, and executes no tool.
 */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
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
  JEV_RESOLVED_MODEL,
  JEV_PROVIDER,
  resolveJevEndpoint,
} from "../extensions/sf-guardrail/lib/jev-client.ts";
import { validateJevStageResult } from "../extensions/sf-guardrail/lib/jev-command-process.ts";
import {
  resolveJevOperatingPoint,
  validateJevOperatingPoint,
  jevOperatingPointHash,
} from "../extensions/sf-guardrail/lib/jev-operating-point.ts";
import {
  DECISION_ENTRY_TYPE,
  type DecisionEntryData,
  type JevEvidence,
  type JevAllHeadRequest,
  type GuardrailConfig,
  type JevToolMetadata,
  type JevFacts,
  type JevOperatingPoint,
  type JevQuestionId,
  type JevRequest,
} from "../extensions/sf-guardrail/lib/types.ts";

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
// Load stateful source modules only after runHookSmoke installs its private profile.
let sourceRisk: typeof import("../extensions/sf-guardrail/lib/jev-risk.ts") | undefined;
let sourceFile: typeof import("../extensions/sf-guardrail/lib/jev-file-process.ts") | undefined;
type FilePlan = import("../extensions/sf-guardrail/lib/jev-file-process.ts").JevFileProcessPlan;
type PostedStage = {
  stage: "file_match" | "all_heads";
  requestHash: string;
  requestBytes: number;
  questionIds: string[];
  synthetic: boolean;
};

export interface HookSmokeReport {
  success: boolean;
  preparedOnly: boolean;
  proofLevel: "actual-sdk-hook-with-inert-tool" | "sdk-preparation-only";
  model: string | null;
  provider: string | null;
  requestId: string | null;
  operatingPoint: JevEvidence["operatingPoint"] | null;
  operatingPointHash: string | null;
  protocolHash: string | null;
  transportHash: string | null;
  requestHash: string | null;
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
  syntheticRequests: number;
  selectedFormat: FilePlan["format"] | null;
  requestPreparations: PostedStage[];
  stageReceipts: Array<{
    stage: "file_match" | "all_heads";
    requestHash: string;
    responseHash: string;
    requestId: string;
    cost: number | null;
  }>;
  syntheticPreparation: {
    stages: PostedStage[];
    modelCredit: false;
    permissionCredit: false;
  } | null;
  requestBytes: number;
  questionIds: JevQuestionId[];
  wirePrivacySuccess: boolean;
  failure: string | null;
}

/** Isolate all Pi state and restore environment/fetch even when setup or the hook fails. */
export async function runHookSmoke(
  options: { prepareOnly?: boolean } = {},
): Promise<HookSmokeReport> {
  const prepareOnly = options.prepareOnly !== false;
  const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  const originalFetch = globalThis.fetch;
  const temporaryRoot = await mkdtemp(join(tmpdir(), "sf-pi-jev-hook-smoke-"));
  const agentDir = join(temporaryRoot, "agent");
  const cwd = join(temporaryRoot, "project");
  const readmePath = join(cwd, "README.md");
  let runner: ExtensionRunner | undefined;
  let hookActive = false;
  let endpoint: string | undefined;
  let postedRequest: { request: JevAllHeadRequest; hash: string; bytes: number } | undefined;
  let filePlan: FilePlan | undefined;
  let routeConfig: GuardrailConfig | undefined;
  const connectionKeys = [
    "SF_GUARDRAIL_JEV_ENDPOINT",
    "SF_GUARDRAIL_JEV_API_KEY",
    "SF_GUARDRAIL_JEV_API_KEY_FILE",
  ];
  const originalConnection = Object.fromEntries(
    connectionKeys.map((key) => [key, process.env[key]]),
  );
  const report: HookSmokeReport = {
    success: false,
    preparedOnly: prepareOnly,
    proofLevel: prepareOnly ? "sdk-preparation-only" : "actual-sdk-hook-with-inert-tool",
    model: null,
    provider: null,
    requestId: null,
    operatingPoint: null,
    operatingPointHash: null,
    protocolHash: null,
    transportHash: null,
    requestHash: null,
    probabilityQuestion: "risk",
    probabilities: null,
    confidence: null,
    cost: null,
    latencyMs: null,
    outcome: null,
    audit: null,
    executionCount: 0,
    requests: 0,
    syntheticRequests: 0,
    selectedFormat: null,
    requestPreparations: [],
    stageReceipts: [],
    syntheticPreparation: null,
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
    sourceRisk = await import("../extensions/sf-guardrail/lib/jev-risk.ts");
    sourceFile = await import("../extensions/sf-guardrail/lib/jev-file-process.ts");
    const sourceConfig = await import("../extensions/sf-guardrail/lib/config.ts");
    routeConfig = sourceConfig.loadGuardrailSnapshot().config;
    if (prepareOnly) {
      process.env.SF_GUARDRAIL_JEV_ENDPOINT = "https://decisions.example.test/v1/decisions";
      process.env.SF_GUARDRAIL_JEV_API_KEY = "synthetic-hook-preparation-key";
      delete process.env.SF_GUARDRAIL_JEV_API_KEY_FILE;
    }

    // Inspect the bounded body only. Never inspect or retain authorization headers.
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (!hookActive || endpoint === undefined || url !== endpoint || init?.method !== "POST") {
        report.failure ??= "unexpected-smoke-network-call";
        throw new Error("unexpected-smoke-network-call");
      }
      if (typeof init.body !== "string" || Buffer.byteLength(init.body) > 32768)
        throw new Error("invalid-smoke-wire-body");
      const request = JSON.parse(init.body) as JevRequest;
      if (!filePlan) {
        if (!sourceFile || !sourceRisk || !routeConfig) throw new Error("smoke-source-missing");
        const state = request.state as { operation: JevToolMetadata; facts: JevFacts };
        const original = sourceRisk.buildJevRequest(state.operation, state.facts, routeConfig);
        filePlan = sourceFile.prepareJevFileProcess(original, false);
        const first =
          filePlan.format === "file_match_then_policy" ? filePlan.match : filePlan.original;
        if (first.json !== init.body) throw new Error("smoke-source-route-mismatch");
        report.selectedFormat = filePlan.format;
      }
      const ordered =
        filePlan.format === "file_match_then_policy"
          ? [
              Object.keys(filePlan.match.request.questions),
              Object.keys(filePlan.original.request.questions),
            ]
          : [Object.keys(filePlan.original.request.questions)];
      const index = report.requestPreparations.length;
      const ids = Object.keys(request.questions);
      if (index >= ordered.length || !isDeepStrictEqual(ids, ordered[index])) {
        report.failure ??= "unexpected-smoke-stage";
        throw new Error("unexpected-smoke-stage");
      }
      const stage = ids[0]?.startsWith("f_") ? "file_match" : "all_heads";
      const requestBytes = Buffer.byteLength(init.body);
      const requestHash = createHash("sha256").update(init.body).digest("hex");
      report.requestPreparations.push({
        stage,
        requestHash,
        requestBytes,
        questionIds: ids,
        synthetic: prepareOnly,
      });
      if (prepareOnly) report.syntheticRequests += 1;
      else report.requests += 1;
      const privacy = wirePrivacyPasses(init.body, readmePath, cwd, resolvedReadmePath);
      report.wirePrivacySuccess = index === 0 ? privacy : report.wirePrivacySuccess && privacy;
      if (!privacy) throw new Error("smoke-wire-privacy-failure");
      if (stage === "all_heads") {
        postedRequest = {
          request: request as JevAllHeadRequest,
          hash: requestHash,
          bytes: requestBytes,
        };
        if (!prepareOnly) {
          report.requestBytes = requestBytes;
          report.requestHash = requestHash;
          report.questionIds = ids as JevQuestionId[];
        }
      }
      if (prepareOnly)
        return new Response(
          JSON.stringify({
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            id: `synthetic-hook-preparation-${index + 1}`,
            answers: Object.fromEntries(
              ids.map((id) => [
                id,
                {
                  type: "choice",
                  choice: stage === "file_match" ? "no_match" : "allow",
                  probabilities:
                    stage === "file_match"
                      ? { match: 0, no_match: 1, unknown: 0 }
                      : { allow: 1, confirm: 0, block: 0 },
                  confidence: 0.37,
                },
              ]),
            ),
            usage: { input_tokens: 0, output_tokens: 0 },
          }),
        );
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
    endpoint = resolveJevEndpoint();
    const declaredPoint = resolveJevOperatingPoint();
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
    const validDecision =
      !result?.block &&
      audit.outcome === "allow_auto" &&
      postedRequest !== undefined &&
      filePlan !== undefined &&
      hookSmokeDecisionPasses(evidence, postedRequest, endpoint, declaredPoint, filePlan);
    const expectedPosts =
      filePlan?.format === "file_match_then_policy" ? 2 : filePlan?.format === "legacy" ? 1 : 0;
    const routeComplete = expectedPosts > 0 && report.requestPreparations.length === expectedPosts;
    if (prepareOnly) {
      report.syntheticPreparation = {
        stages: structuredClone(report.requestPreparations),
        modelCredit: false,
        permissionCredit: false,
      };
      report.success =
        validDecision &&
        routeComplete &&
        report.wirePrivacySuccess &&
        report.requests === 0 &&
        !report.failure;
      if (!report.success) report.failure ??= evidence.failure ?? "smoke-preparation-failed";
      return report;
    }
    if (evidence.process?.fileStage?.match) {
      const receipt = evidence.process.fileStage.match.evidence;
      report.stageReceipts.push({
        stage: "file_match",
        requestHash: receipt.requestHash,
        responseHash: receipt.responseHash,
        requestId: receipt.requestId,
        cost: receipt.usage.cost ?? null,
      });
    }
    if (evidence.process?.kind === "all_heads" && evidence.process.stage) {
      const receipt = evidence.process.stage.evidence;
      report.stageReceipts.push({
        stage: "all_heads",
        requestHash: receipt.requestHash,
        responseHash: receipt.responseHash,
        requestId: receipt.requestId,
        cost: receipt.usage.cost ?? null,
      });
    }
    Object.assign(report, {
      model: evidence.model,
      provider: evidence.provider ?? null,
      requestId: evidence.requestId ?? null,
      operatingPoint: evidence.operatingPoint ?? null,
      operatingPointHash: evidence.operatingPointHash ?? null,
      protocolHash: evidence.protocolHash,
      transportHash: evidence.transportHash ?? null,
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
    if (
      validDecision &&
      routeComplete &&
      report.wirePrivacySuccess &&
      report.requests === expectedPosts
    ) {
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
      routeComplete &&
      report.requests === expectedPosts &&
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
      for (const key of connectionKeys) {
        if (originalConnection[key] === undefined) delete process.env[key];
        else process.env[key] = originalConnection[key];
      }
      if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
      else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  }
}

/** Validate each actual stage and its premises, then use the source gates for the fixed point. */
export function hookSmokeDecisionPasses(
  evidence: JevEvidence,
  posted: { request: JevAllHeadRequest; hash: string; bytes: number },
  endpoint: string,
  declaredPoint: JevOperatingPoint,
  filePlan?: FilePlan,
): boolean {
  try {
    if (!sourceRisk) return false;
    const json = JSON.stringify(posted.request);
    if (
      posted.hash !== createHash("sha256").update(json).digest("hex") ||
      posted.bytes !== Buffer.byteLength(json)
    )
      return false;
    const point = validateJevOperatingPoint(evidence.operatingPoint);
    if (!isDeepStrictEqual(point, validateJevOperatingPoint(declaredPoint))) return false;
    const transportHash = sourceRisk.jevDecisionTransportBindingHash(endpoint, point);
    const process = evidence.process;
    if (
      evidence.failure ||
      evidence.operatingPointHash !== jevOperatingPointHash(point) ||
      evidence.protocolHash !== sourceRisk.jevRuntimeProtocolHash(point) ||
      evidence.transportHash !== transportHash ||
      !Number.isFinite(evidence.latencyMs) ||
      evidence.latencyMs < 0 ||
      evidence.latencyMs >= point.totalTimeoutMs ||
      process?.kind !== "all_heads" ||
      !process.completed ||
      process.cleanupFailed ||
      process.failureEvidence !== undefined ||
      process.stageTimingOrigin !== "transport_cleanup" ||
      !process.stage ||
      !isDeepStrictEqual(process.attempt, {
        requestedQuestionIds: Object.keys(posted.request.questions),
        requestHash: posted.hash,
        requestBytes: posted.bytes,
      })
    )
      return false;
    const fileStage = process.fileStage;
    if (
      !sourceFile ||
      !filePlan ||
      !fileStage ||
      !fileStage.completed ||
      fileStage.cleanupFailed ||
      fileStage.failureEvidence !== undefined ||
      fileStage.failure !== undefined ||
      fileStage.format !== filePlan.format ||
      !isDeepStrictEqual(fileStage.selection, filePlan.selection) ||
      fileStage.selectedProbabilityFloor !== point.syntaxProbability
    )
      return false;
    if (filePlan.format === "file_match_then_policy") {
      if (
        !fileStage.match ||
        !fileStage.transcript ||
        fileStage.matchTimingOrigin !== "transport_cleanup" ||
        !isDeepStrictEqual(fileStage.attempt, {
          requestedQuestionIds: filePlan.selection.questionIds,
          requestHash: filePlan.match.hash,
          requestBytes: filePlan.match.bytes,
        })
      )
        return false;
      sourceFile.validateJevFileMatchResult(fileStage.match, filePlan, transportHash);
      if (
        fileStage.match.evidence.latencyMs > evidence.latencyMs ||
        fileStage.match.evidence.requestId === process.stage.evidence.requestId ||
        sourceFile.encodeJevFileTranscript(filePlan, fileStage.match, transportHash) !==
          fileStage.transcript ||
        sourceFile.restoreJevFileSourceRequest(
          filePlan,
          posted.request,
          fileStage.match,
          transportHash,
        ) !== filePlan.original.json
      )
        return false;
      const floorMet = Object.values(fileStage.match.answers).every(
        (answer) => answer.probabilities[answer.choice] >= point.syntaxProbability,
      );
      if (floorMet !== fileStage.selectedProbabilityFloorMet || !floorMet) return false;
    } else if (
      filePlan.original.json !== json ||
      fileStage.match !== undefined ||
      fileStage.transcript !== undefined ||
      fileStage.selectedProbabilityFloorMet !== true
    )
      return false;
    const stage = process.stage;
    validateJevStageResult("all_heads", stage, posted, transportHash);
    if (stage.evidence.latencyMs > evidence.latencyMs) return false;
    const risk = stage.answers.risk;
    if (
      evidence.model !== stage.evidence.model ||
      evidence.provider !== stage.evidence.provider ||
      evidence.requestId !== stage.evidence.requestId ||
      !isDeepStrictEqual(evidence.answers, stage.answers) ||
      !isDeepStrictEqual(evidence.riskAnswer, risk) ||
      !isDeepStrictEqual(evidence.probabilities, risk.probabilities) ||
      evidence.confidence !== risk.confidence ||
      evidence.cost !== stage.evidence.usage.cost ||
      !isDeepStrictEqual(evidence.riskOrigin, {
        ...stage.evidence,
        stage: "all_heads",
        questionId: "risk",
        timingOrigin: "transport_cleanup",
      })
    )
      return false;
    const state = posted.request.state as {
      operation?: { complete?: boolean };
      observations?: { contextComplete?: boolean };
    };
    return (
      sourceRisk.evaluateJevPrediction(
        {
          ...risk,
          answers: stage.answers,
          model: stage.evidence.model,
          provider: stage.evidence.provider,
          requestId: stage.evidence.requestId,
          usage: stage.evidence.usage,
        },
        state.operation?.complete === true && state.observations?.contextComplete === true,
        point,
      ) === "allow"
    );
  } catch {
    return false;
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
        kind?: string;
        resolvedPath?: string;
        absolutePath?: string;
        relativePath?: string;
        basename?: string;
        homeRelativePath?: string;
      }>;
    };
    policy?: { files?: unknown[] };
    fileMatch?: string;
    fileMatchPremises?: Array<{
      fileRecordIndex?: number;
      policyRowIndex?: number;
      patternList?: string;
      choice?: string;
    }>;
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
    state.version === 6 &&
    [
      "facts,observations,operation,policy,version",
      "facts,fileMatch,fileMatchPremises,observations,operation,policy,version",
    ].includes(Object.keys(state).sort().join(",")) &&
    (state.fileMatch === undefined || typeof state.fileMatch === "string") &&
    (state.fileMatchPremises === undefined
      ? state.fileMatch === undefined
      : typeof state.fileMatch === "string" &&
        Array.isArray(state.fileMatchPremises) &&
        state.fileMatchPremises.length >= 1 &&
        state.fileMatchPremises.length <= 8 &&
        state.fileMatchPremises.every(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            Object.keys(entry).sort().join(",") ===
              "choice,fileRecordIndex,patternList,policyRowIndex" &&
            Number.isInteger(entry.fileRecordIndex) &&
            (entry.fileRecordIndex ?? -1) >= 0 &&
            (entry.fileRecordIndex ?? Infinity) < (state.facts?.files?.length ?? 0) &&
            Number.isInteger(entry.policyRowIndex) &&
            (entry.policyRowIndex ?? -1) >= 0 &&
            (entry.policyRowIndex ?? Infinity) < (state.policy?.files?.length ?? 0) &&
            ["patterns", "allowedPatterns"].includes(entry.patternList ?? "") &&
            ["match", "no_match", "unknown"].includes(entry.choice ?? ""),
        )) &&
    operation?.toolName === "read" &&
    operation.complete === true &&
    Object.keys(operation).every((key) =>
      ["toolName", "metadata", "omissions", "complete"].includes(key),
    ) &&
    Boolean(metadata) &&
    Object.keys(metadata ?? {}).every((key) =>
      [
        "path",
        "paths",
        "parameterShape",
        "fileAccess",
        "outputShape",
        "selectedDescendantsObserved",
      ].includes(key),
    ) &&
    metadata?.fileAccess === "read" &&
    metadata.outputShape === "file_content" &&
    metadata.selectedDescendantsObserved === false &&
    Array.isArray(metadata?.paths) &&
    metadata.paths.length === 1 &&
    metadata.paths[0] === readmePath &&
    state.facts?.files?.length === 1 &&
    state.facts.files[0].path === readmePath &&
    state.facts.files[0].exists === true &&
    state.facts.files[0].kind === "file" &&
    fileVariantsValid &&
    Object.keys(state.facts).every((key) => key === "files") &&
    Object.keys(state.facts.files[0]).every((key) =>
      ["exists", "kind", ...filePathFields].includes(key),
    ) &&
    Object.keys(state.policy ?? {}).join(",") === "files" &&
    Array.isArray(state.policy?.files) &&
    state.observations?.contextComplete === true &&
    Object.keys(state.observations).every((key) => ["contextComplete", "rowLimit"].includes(key)) &&
    rowLimitValid &&
    (questionIds[0]?.startsWith("f_")
      ? state.fileMatch === undefined &&
        state.fileMatchPremises === undefined &&
        questionIds.length >= 1 &&
        questionIds.length <= 8 &&
        questionIds.every(
          (id, index) =>
            id === `f_${String.fromCharCode(97 + index)}` &&
            request.questions[id]?.type === "choice" &&
            Object.keys(request.questions[id].criteria).sort().join(",") ===
              "match,no_match,unknown",
        )
      : questionIds.slice().sort().join(",") === "disclosure,file_policy,risk" &&
        questionIds.length <= QUESTION_IDS.length &&
        questionIds.every((id) => QUESTION_IDS.includes(id as JevQuestionId)) &&
        questionIds.every(
          (id) =>
            request.questions[id]?.type === "choice" &&
            Object.keys(request.questions[id].criteria).sort().join(",") === "allow,block,confirm",
        ))
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
  if (
    args.some((arg) => arg !== "--prepare-only" && arg !== "--live") ||
    (args.includes("--prepare-only") && args.includes("--live"))
  ) {
    console.error(
      "Usage: node --experimental-strip-types scripts/jev-guardrail-hook-smoke.ts [--prepare-only | --live]",
    );
    process.exitCode = 2;
  } else {
    const report = await runHookSmoke({ prepareOnly: !args.includes("--live") });
    console.log(JSON.stringify(report, null, 2));
    if (!report.success) process.exitCode = 1;
  }
}
