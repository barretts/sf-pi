/* SPDX-License-Identifier: Apache-2.0 */
/** Real SDK registration/event dispatch; tools are deliberately counter-only, with no external effects. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { performance as sourcePerformance } from "node:perf_hooks";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import {
  createEventBus,
  createExtensionRuntime,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  wrapRegisteredTool,
  type ExtensionUIContext,
  type ToolCallEvent,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
// This loader is exported by the SDK's installed extension module, but not its package root.
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sfGuardrail from "../index.ts";
import { readRecentDecisions } from "../lib/approval-ledger.ts";
import { JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../lib/jev-client.ts";
import { resolveJevFacts } from "../lib/jev-facts.ts";
import { jevDecisionTransportBindingHash } from "../lib/jev-risk.ts";
import { OPERATOR_AUTO_APPROVE_VALUE } from "../lib/hitl.ts";
import type { GuardrailPiSettings } from "../lib/guardrail-settings.ts";
import {
  ALLOW_ENTRY_TYPE,
  DECISION_ENTRY_TYPE,
  type JevAction,
  type JevQuestionId,
} from "../lib/types.ts";

let syntheticSandbox = false;
vi.mock("../lib/jev-facts.ts", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/jev-facts.ts")>();
  return {
    ...original,
    resolveJevFacts: vi.fn(async (options: Parameters<typeof original.resolveJevFacts>[0]) => {
      const resolved = await original.resolveJevFacts(options);
      return syntheticSandbox
        ? {
            ...resolved,
            facts: { ...resolved.facts, org: { type: "sandbox", verified: true, explicit: true } },
            orgIdentity: "synthetic-sandbox-identity",
          }
        : resolved;
    }),
  };
});

const BODY = "PRIVATE_OMITTED_BODY_SENTINEL";
const TEST_KEY = "sk-test-hook-only-credential";
const ENDPOINT = "https://decisions.example.test/v1/decisions";
const OTHER_ENDPOINT = "https://other-decisions.example.test/v1/decisions";
let directory: string;
let agentDir: string;
let cwd: string;
let session: SessionManager;
let runner: ExtensionRunner;
let controller: AbortController;
let counter: number;
let appendEntryFails: boolean;
let appendEntryFailureType: string | undefined;
let appendEntryTypes: string[];
let sequence: number;
let tools: ToolInfo[];
let select: ReturnType<typeof vi.fn<ExtensionUIContext["select"]>>;
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;

function reply(
  choice: "allow" | "confirm" | "block" = "allow",
  allow = choice === "allow" ? 1 : 0,
  overrides: Partial<Record<JevQuestionId, { choice: JevAction; allow: number }>> = {},
) {
  const requestBody = fetch?.mock.calls.at(-1)?.[1]?.body;
  const questions =
    typeof requestBody === "string" ? Object.keys(JSON.parse(requestBody).questions) : ["risk"];
  const answer = (selected: JevAction, pAllow: number) => ({
    type: "choice",
    choice: selected,
    confidence: 0.95,
    probabilities: {
      allow: pAllow,
      confirm: selected === "block" ? 0 : 1 - pAllow,
      block: selected === "block" ? 1 - pAllow : 0,
    },
  });
  return new Response(
    JSON.stringify({
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      id: `gen-dec-synthetic-hook-test-${fetch.mock.calls.length}`,
      answers: Object.fromEntries(
        questions.map((id) => {
          const override = overrides[id];
          return [
            id,
            id.startsWith("f_")
              ? {
                  type: "choice",
                  choice: "no_match",
                  probabilities: { match: 0, no_match: 1, unknown: 0 },
                  confidence: 0.37,
                }
              : id.startsWith("r_")
                ? {
                    type: "choice",
                    choice: "no_match",
                    probabilities: { match: 0, no_match: 1 },
                    confidence: 0.734567,
                  }
                : override
                  ? answer(override.choice, override.allow)
                  : answer(choice, allow),
          ];
        }),
      ),
      usage: { input_tokens: 200, output_tokens: 35, cost: 0.00002 },
    }),
  );
}

function settings(overrides: GuardrailPiSettings = {}) {
  writeFileSync(
    join(agentDir, "settings.json"),
    JSON.stringify({
      sfPi: { guardrail: { engine: "jev", ...overrides } },
    }),
  );
}

function interactive() {
  runner.setUIContext(
    { ...runner.getUIContext(), select, notify: vi.fn(), setStatus: vi.fn() },
    "tui",
  );
}

async function invoke(toolName = "read", input: Record<string, unknown> = { path: "README.md" }) {
  const event: ToolCallEvent = {
    type: "tool_call",
    toolCallId: `inert-${++sequence}`,
    toolName,
    input,
  };
  const result = await runner.emitToolCall(event);
  if (!result?.block) {
    const registered = runner
      .getAllRegisteredTools()
      .find((tool) => tool.definition.name === toolName);
    if (!registered) throw new Error("Missing inert registered tool.");
    await wrapRegisteredTool(registered, runner).execute(
      event.toolCallId,
      input,
      controller.signal,
      undefined,
    );
  }
  return result;
}

const audit = () => readRecentDecisions(runner.createContext());
const pendingFetch = () => {
  let release: (value: Response) => void;
  fetch.mockImplementationOnce(
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  return (choice: "allow" | "confirm" | "block" = "allow") => release(reply(choice));
};

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "sf-guardrail-jev-sdk-hook-"));
  agentDir = join(directory, "agent");
  cwd = join(directory, "project");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  writeFileSync(join(cwd, "README.md"), BODY);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", TEST_KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "conservative");
  vi.stubEnv("SF_GUARDRAIL_ALLOW_HEADLESS", "");
  vi.stubEnv("SF_GUARDRAIL_OPERATOR_AUTO_APPROVE", "");
  settings();
  syntheticSandbox = false;
  counter = 0;
  appendEntryFails = false;
  appendEntryFailureType = undefined;
  appendEntryTypes = [];
  sequence = 0;
  controller = new AbortController();
  fetch = vi.fn<typeof globalThis.fetch>(async () => reply());
  vi.stubGlobal("fetch", fetch);
  select = vi.fn<ExtensionUIContext["select"]>(async () => "Block");
  const runtime = createExtensionRuntime();
  const extension = await loadExtensionFromFactory(
    (pi) => {
      sfGuardrail(pi);
      for (const name of ["read", "write", "bash", "herdr_pane", "jev_inert_unknown"]) {
        pi.registerTool({
          name,
          label: `Inert ${name}`,
          description: "Counter-only synthetic test operation.",
          parameters: Type.Object({
            path: Type.Optional(Type.String()),
            content: Type.Optional(Type.String()),
            action: Type.Optional(Type.String()),
            command: Type.Optional(Type.String()),
          }),
          execute: async () => {
            counter += 1;
            return { content: [{ type: "text", text: "Inert counter incremented." }], details: {} };
          },
        });
      }
    },
    cwd,
    createEventBus(),
    runtime,
    "<jev-sdk-hook-test>",
  );
  session = SessionManager.inMemory(cwd);
  const modelRuntime = await ModelRuntime.create({
    authPath: join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: join(agentDir, "model-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runner = new ExtensionRunner([extension], runtime, cwd, session, new ModelRegistry(modelRuntime));
  tools = runner.getAllRegisteredTools().map(({ definition, sourceInfo }) => ({
    name: definition.name,
    description: definition.description,
    parameters: definition.parameters,
    sourceInfo,
  }));
  runner.bindCore(
    {
      sendMessage: () => {},
      sendUserMessage: () => {},
      appendEntry: (type, data) => {
        appendEntryTypes.push(type);
        if (appendEntryFails || type === appendEntryFailureType)
          throw new Error("Synthetic audit append failure.");
        session.appendCustomEntry(type, data);
      },
      setSessionName: () => {},
      getSessionName: () => session.getSessionName(),
      setLabel: () => {},
      getActiveTools: () => tools.map((tool) => tool.name),
      getAllTools: () => tools,
      setActiveTools: () => {},
      refreshTools: () => {},
      getCommands: () => [],
      setModel: async () => false,
      getThinkingLevel: () => "off",
      setThinkingLevel: () => {},
    },
    {
      getModel: () => undefined,
      getScopedModels: () => [],
      isIdle: () => true,
      isProjectTrusted: () => true,
      getSignal: () => controller.signal,
      abort: () => controller.abort(),
      hasPendingMessages: () => false,
      shutdown: () => {},
      getContextUsage: () => undefined,
      compact: () => {},
      getSystemPrompt: () => "",
    },
  );
  await runner.emit({ type: "session_start", reason: "startup" });
});

afterEach(() => {
  runner?.invalidate("Synthetic hook test completed.");
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("Jev actual SDK pre-execution hook with inert registered tools", () => {
  it("dispatches actual factory registration and automatically executes a complete high-probability read", async () => {
    expect(runner.hasHandlers("tool_call")).toBe(true);
    expect(runner.getToolDefinition("read")).toBeDefined();
    expect(await invoke()).toBeUndefined();
    expect(counter).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Object.keys(JSON.parse(fetch.mock.calls[0][1].body as string).questions)).toEqual([
      "f_a",
      "f_b",
      "f_c",
      "f_d",
      "f_e",
      "f_f",
      "f_g",
      "f_h",
    ]);
    expect(Object.keys(JSON.parse(fetch.mock.calls[1][1].body as string).questions)).toContain(
      "risk",
    );
    expect(audit()[0].jev.process.fileStage.match.evidence.requestId).toBe(
      "gen-dec-synthetic-hook-test-1",
    );
    expect(audit()[0].jev.process.fileStage.match.evidence.usage.cost).toBe(0.00002);
    expect(select).not.toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({
      outcome: "allow_auto",
      feature: "jevGate",
      jev: {
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        requestId: "gen-dec-synthetic-hook-test-2",
        probabilities: { allow: 1, confirm: 0, block: 0 },
        confidence: 0.95,
        cost: 0.00002,
        transportHash: jevDecisionTransportBindingHash(ENDPOINT),
      },
    });
    expect(JSON.stringify(audit())).not.toContain(BODY);
    expect(JSON.stringify(audit())).not.toContain(TEST_KEY);
    expect(JSON.stringify(audit())).not.toContain(ENDPOINT);
    expect(fetch.mock.calls[0][1].body).not.toContain(BODY);
    expect(fetch.mock.calls[0][0]).toBe(ENDPOINT);
  });

  it("uses three actual Bash replies and keeps each head at its own origin", async () => {
    expect(await invoke("bash", { command: "git status" })).toBeUndefined();
    expect(counter).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
    const requests = fetch.mock.calls.map((call) => JSON.parse(call[1].body as string));
    expect(Object.keys(requests[0].questions)).not.toContain("command_policy");
    expect(Object.keys(requests[0].questions)).toContain("risk");
    expect(Object.keys(requests[1].questions).every((id) => id.startsWith("r_"))).toBe(true);
    expect(Object.keys(requests[2].questions)).toEqual(["command_policy"]);
    const evidence = audit()[0].jev;
    expect(evidence.process.kind).toBe("command_stages");
    if (evidence.process.kind !== "command_stages") throw new Error("Expected command stages.");
    expect(evidence).not.toHaveProperty("requestId");
    expect(evidence).not.toHaveProperty("answers");
    expect(evidence.process.result.stages.map((stage) => stage.stage)).toEqual([
      "non_command",
      "syntax",
      "command_policy",
    ]);
    expect(evidence.riskOrigin.stage).toBe("non_command");
    expect(evidence.process.result.origins.command_policy.stage).toBe("command_policy");
    expect(evidence.process.result.distributionsCombined).toBe(false);
    expect(evidence.process.result.representsOneProviderReply).toBe(false);
    expect(evidence.process.result.syntaxTranscript.length).toBe(
      Object.keys(requests[1].questions).length,
    );
    expect(
      new Set(evidence.process.result.stages.map((stage) => stage.evidence.transportHash)),
    ).toEqual(new Set([evidence.transportHash]));
  });

  it("keeps a non-Bash command head in one actual all-head call", async () => {
    expect(await invoke("herdr_pane", { action: "run", command: "git status" })).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
    const request = JSON.parse(fetch.mock.calls[0][1].body as string);
    expect(Object.keys(request.questions)).toContain("command_policy");
    const evidence = audit()[0].jev;
    expect(evidence.process.kind).toBe("all_heads");
    if (evidence.process.kind !== "all_heads") throw new Error("Expected one actual reply.");
    expect(evidence.process.stage.answers.command_policy.choice).toBe("allow");
    expect(evidence.requestId).toBe(evidence.process.stage.evidence.requestId);
    expect(counter).toBe(1);
  });

  it("keeps a first-stage actual block after a later stage fails", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply("block"));
    fetch.mockRejectedValueOnce(new Error("Synthetic syntax transport error."));
    expect(await invoke("bash", { command: "git status" })).toMatchObject({ block: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(counter).toBe(0);
    expect(select).not.toHaveBeenCalled();
    const evidence = audit()[0].jev;
    if (evidence.process.kind !== "command_stages") throw new Error("Expected command stages.");
    expect(evidence.process.result.actualBlocks[0]).toMatchObject({
      questionId: "risk",
      answer: { choice: "block" },
      origin: { stage: "non_command" },
    });
    expect(evidence.process.result.stages).toHaveLength(1);
    expect(evidence.process.result.failure).toMatchObject({
      stage: "syntax",
      code: "transport_error",
    });
  });

  it.each(["conservative", "argmax"])(
    "uses the declared %s syntax floor with actual raw numbers",
    async (point) => {
      vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", point);
      fetch.mockImplementation(async () => {
        const current = JSON.parse(fetch.mock.calls.at(-1)[1].body as string);
        if (!Object.keys(current.questions)[0].startsWith("r_")) return reply();
        return new Response(
          JSON.stringify({
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            id: "synthetic-binary-point",
            answers: Object.fromEntries(
              Object.keys(current.questions).map((id) => [
                id,
                {
                  type: "choice",
                  choice: "no_match",
                  probabilities: { match: 0.4, no_match: 0.6 },
                  confidence: 0.123456,
                },
              ]),
            ),
            usage: { input_tokens: 200, output_tokens: 50 },
          }),
        );
      });
      const result = await invoke("bash", { command: "git status" });
      expect(result?.block ?? false).toBe(point === "conservative");
      expect(counter).toBe(point === "argmax" ? 1 : 0);
      const evidence = audit()[0].jev;
      expect(evidence.operatingPoint.name).toBe(point);
      if (evidence.process.kind !== "command_stages") throw new Error("Expected command stages.");
      expect(evidence.process.result.syntaxTranscript[0].answer).toEqual({
        choice: "no_match",
        probabilities: { match: 0.4, no_match: 0.6 },
        confidence: 0.123456,
      });
      expect(evidence.process.result.gate).toBe(point === "argmax" ? "allow" : "confirm");
    },
  );

  it("blocks an invalid operating point before facts or dispatch", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "custom");
    vi.mocked(resolveJevFacts).mockClear();
    expect(await invoke()).toMatchObject({ block: true });
    expect(resolveJevFacts).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(counter).toBe(0);
  });

  it("allows a late human approval after a fresh bounded context check", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(sourcePerformance, "now").mockImplementation(() => performance.now());
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("confirm"));
    select.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(20_000);
      return "Allow once";
    });
    expect(await invoke()).toBeUndefined();
    expect(counter).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(audit()[0].outcome).toBe("allow_once");
    expect(resolveJevFacts).toHaveBeenCalledTimes(6);
  });

  it("blocks when the later approval recheck consumes its separate 1500 ms bound", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(sourcePerformance, "now").mockImplementation(() => performance.now());
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("confirm"));
    const original = vi.mocked(resolveJevFacts).getMockImplementation();
    select.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(20_000);
      vi.mocked(resolveJevFacts).mockImplementationOnce(async (options) => {
        const resolved = await original(options);
        vi.advanceTimersByTime(1500);
        return resolved;
      });
      return "Allow once";
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "changed-context" },
    });
  });

  it("rechecks the point after an automatic allow audit before release", async () => {
    const original = session.appendCustomEntry.bind(session);
    vi.spyOn(session, "appendCustomEntry").mockImplementation((type, data) => {
      const entry = original(type, data);
      if (type === DECISION_ENTRY_TYPE) vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "argmax");
      return entry;
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(audit().map((entry) => entry.outcome)).toEqual(["hard_block", "allow_auto"]);
  });

  it("includes facts time and final automatic context checks in one total deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.spyOn(sourcePerformance, "now").mockImplementation(() => performance.now());
    const original = vi.mocked(resolveJevFacts).getMockImplementation();
    let resolutions = 0;
    vi.mocked(resolveJevFacts).mockImplementation(async (options) => {
      const resolved = await original(options);
      resolutions++;
      if (resolutions === 1) vi.advanceTimersByTime(6000);
      // The adapter completes its four observations, then the hook checks automatic release.
      if (resolutions === 5) vi.advanceTimersByTime(4000);
      return resolved;
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(resolutions).toBe(5);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "changed-context" },
    });
  });

  it.each(["toolName", "toolCallId"] as const)(
    "blocks a changed %s while classification is pending",
    async (field) => {
      const release = pendingFetch();
      const event: ToolCallEvent = {
        type: "tool_call",
        toolCallId: "same-descriptor-origin",
        toolName: "read",
        input: { path: "README.md" },
      };
      const pending = runner.emitToolCall(event);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      event[field] = field === "toolName" ? "write" : "changed-origin";
      release();
      expect(await pending).toMatchObject({ block: true });
      expect(counter).toBe(0);
      expect(audit()[0]).toMatchObject({
        toolName: "read",
        outcome: "hard_block",
        jev: { failure: "identity_mismatch" },
      });
    },
  );

  it("blocks a missing endpoint before fact lookup or a model request", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "");
    vi.mocked(resolveJevFacts).mockClear();
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(resolveJevFacts).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(select).not.toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "missing_endpoint" },
    });
  });

  it("blocks a model hard block before inert execution without offering approval", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("block"));
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { probabilities: { block: 1 } },
    });
  });

  it("enforces a model policy-question block despite a high-probability overall allow", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () =>
      reply("allow", 1, { file_policy: { choice: "block", allow: 0 } }),
    );
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(Object.keys(JSON.parse(fetch.mock.calls[1][1].body as string).questions)).toContain(
      "file_policy",
    );
    expect(select).not.toHaveBeenCalled();
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: {
        probabilities: { allow: 1 },
        answers: { file_policy: { choice: "block", probabilities: { block: 1 } } },
      },
    });
  });

  it("requires explicit approval for an uncertain policy question despite a high-probability overall allow", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () =>
      reply("allow", 1, { file_policy: { choice: "allow", allow: 0.98 } }),
    );
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledOnce();
    expect(audit()[0]).toMatchObject({
      outcome: "block",
      jev: {
        probabilities: { allow: 1 },
        answers: { file_policy: { choice: "allow", probabilities: { allow: 0.98 } } },
      },
    });
  });

  it("blocks an approval UI exception and records a hard block when the audit remains available", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("confirm"));
    select.mockRejectedValueOnce(new Error(`Synthetic UI failure: ${BODY}`));
    const result = await invoke();
    expect(result).toMatchObject({ block: true });
    expect(result.reason).not.toContain(BODY);
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenCalledOnce();
    expect(audit()[0]).toMatchObject({ outcome: "hard_block", feature: "jevGate" });
    expect(JSON.stringify(audit())).not.toContain(BODY);
  });

  it("keeps a model hard block enforced when UI notification throws", async () => {
    interactive();
    runner.setUIContext(
      {
        ...runner.getUIContext(),
        notify: () => {
          throw new Error(`Synthetic notification failure: ${BODY}`);
        },
      },
      "tui",
    );
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("block"));
    const result = await invoke();
    expect(result).toMatchObject({ block: true });
    expect(result.reason).not.toContain(BODY);
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
    expect(audit().some((decision) => decision.outcome === "hard_block")).toBe(true);
  });

  it("blocks an otherwise valid automatic allow when audit persistence throws", async () => {
    appendEntryFails = true;
    const result = await invoke();
    expect(result).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(audit()).toHaveLength(0);
  });

  it("requires approval again after a failed session-grant write recovers", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    appendEntryFailureType = ALLOW_ENTRY_TYPE;
    const input = { path: "source.ts", content: BODY };

    expect(await invoke("write", input)).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledOnce();
    expect(appendEntryTypes).toContain(ALLOW_ENTRY_TYPE);
    expect(
      session
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === ALLOW_ENTRY_TYPE),
    ).toBe(false);
    expect(audit()[0]).toMatchObject({ outcome: "hard_block" });

    appendEntryFailureType = undefined;
    select.mockResolvedValue("Block");
    expect(await invoke("write", { ...input })).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(audit()[0]).toMatchObject({ outcome: "block" });
  });

  it("does not create a session grant when its approval audit fails", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    appendEntryFailureType = DECISION_ENTRY_TYPE;
    const input = { path: "source.ts", content: BODY };

    expect(await invoke("write", input)).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledOnce();
    expect(appendEntryTypes).not.toContain(ALLOW_ENTRY_TYPE);
    expect(
      session
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === ALLOW_ENTRY_TYPE),
    ).toBe(false);
    expect(audit()).toHaveLength(0);

    appendEntryFailureType = undefined;
    select.mockResolvedValue("Block");
    expect(await invoke("write", { ...input })).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(audit()[0]).toMatchObject({ outcome: "block" });
  });

  it("routes unknown effects to actual explicit allow-once UI and asks again on the next call", async () => {
    interactive();
    select.mockResolvedValue("Allow once");
    expect(await invoke("jev_inert_unknown", { action: "execute", content: BODY })).toBeUndefined();
    expect(counter).toBe(1);
    expect(select.mock.calls[0][1]).toEqual(["Allow once", "Block"]);
    expect(audit()[0].outcome).toBe("allow_once");
    select.mockResolvedValue("Block");
    expect(await invoke("jev_inert_unknown", { action: "execute", content: BODY })).toMatchObject({
      block: true,
    });
    expect(counter).toBe(1);
    expect(select).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(fetch.mock.calls.map((call) => call[1].body))).not.toContain(BODY);
    expect(JSON.stringify(audit())).not.toContain(BODY);
  });

  it("routes a valid uncertain allow prediction to confirmation before execution", async () => {
    interactive();
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("allow", 0.98));
    expect(await invoke()).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledOnce();
    expect(audit()[0]).toMatchObject({ outcome: "block", jev: { probabilities: { allow: 0.98 } } });
  });

  it("keeps headless confirmations blocked with both legacy opt-ins and Power Tool mode", async () => {
    settings({ powerTool: { mode: "all" } });
    vi.stubEnv("SF_GUARDRAIL_ALLOW_HEADLESS", "1");
    vi.stubEnv("SF_GUARDRAIL_OPERATOR_AUTO_APPROVE", OPERATOR_AUTO_APPROVE_VALUE);
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("confirm"));
    expect(await invoke("write", { path: "source.ts", content: BODY })).toMatchObject({
      block: true,
    });
    expect(counter).toBe(0);
    expect(audit()[0].outcome).toBe("headless_block");
  });

  it("reuses only exact verified-sandbox session grants and invalidates them for changed withheld bodies", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    const first = { path: "source.ts", content: BODY };
    expect(await invoke("write", first)).toBeUndefined();
    expect(select.mock.calls[0][1]).toContain("Allow for this session");
    expect(await invoke("write", { ...first })).toBeUndefined();
    expect(counter).toBe(2);
    expect(select).toHaveBeenCalledOnce();
    select.mockResolvedValue("Block");
    expect(await invoke("write", { ...first, content: `${BODY}_changed` })).toMatchObject({
      block: true,
    });
    expect(counter).toBe(2);
    expect(select).toHaveBeenCalledTimes(2);
    expect(new Set(audit().map((decision) => decision.fingerprint)).size).toBe(2);
    expect(JSON.stringify(audit())).not.toContain(BODY);
  });

  it("invalidates an earlier session grant when effective policy changes", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    const input = { path: "source.ts", content: BODY };
    expect(await invoke("write", input)).toBeUndefined();
    settings({ confirmTimeoutMs: 45_000 });
    select.mockResolvedValue("Block");
    expect(await invoke("write", input)).toMatchObject({ block: true });
    expect(counter).toBe(1);
    expect(select).toHaveBeenCalledTimes(2);
    expect(audit()[0].jev.policyHash).not.toBe(audit()[1].jev.policyHash);
  });

  it("requires a new approval when the endpoint changes after an exact session grant", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    const input = { path: "source.ts", content: BODY };
    expect(await invoke("write", input)).toBeUndefined();
    expect(await invoke("write", { ...input })).toBeUndefined();
    expect(counter).toBe(2);
    expect(select).toHaveBeenCalledOnce();

    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
    select.mockResolvedValue("Block");
    expect(await invoke("write", { ...input })).toMatchObject({ block: true });
    expect(counter).toBe(2);
    expect(select).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls.map((call) => call[0])).toEqual([
      ENDPOINT,
      ENDPOINT,
      ENDPOINT,
      ENDPOINT,
      OTHER_ENDPOINT,
      OTHER_ENDPOINT,
    ]);
    const decisions = audit();
    expect(decisions[0].outcome).toBe("block");
    expect(decisions[1].outcome).toBe("allow_session");
    expect(decisions[0].jev.transportHash).toBe(jevDecisionTransportBindingHash(OTHER_ENDPOINT));
    expect(decisions[1].jev.transportHash).toBe(jevDecisionTransportBindingHash(ENDPOINT));
    expect(decisions[0].fingerprint).not.toBe(decisions[1].fingerprint);
    expect(JSON.stringify(decisions)).not.toContain("decisions.example.test");
  });

  it("does not save a session grant when the endpoint changes during approval", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    let approve!: (choice: string) => void;
    select.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          approve = resolve;
        }),
    );
    const input = { path: "source.ts", content: BODY };
    const pending = invoke("write", input);
    await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
    approve("Allow for this session");
    expect(await pending).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(appendEntryTypes).not.toContain(ALLOW_ENTRY_TYPE);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "changed-context", transportHash: jevDecisionTransportBindingHash(ENDPOINT) },
    });

    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
    select.mockResolvedValue("Block");
    expect(await invoke("write", { ...input })).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(select).toHaveBeenCalledTimes(2);
    expect(appendEntryTypes).not.toContain(ALLOW_ENTRY_TYPE);
  });

  it("does not restore a session grant from a sibling SDK session branch", async () => {
    syntheticSandbox = true;
    interactive();
    fetch.mockImplementation(async () => reply("confirm"));
    select.mockResolvedValue("Allow for this session");
    const input = { path: "source.ts", content: BODY };
    expect(await invoke("write", input)).toBeUndefined();
    const oldLeafId = session.getLeafId();
    session.resetLeaf();
    session.appendCustomEntry("synthetic-sibling-root", {});
    await runner.emit({ type: "session_tree", oldLeafId, newLeafId: session.getLeafId() });
    select.mockResolvedValue("Block");
    expect(await invoke("write", input)).toMatchObject({ block: true });
    expect(counter).toBe(1);
    expect(select).toHaveBeenCalledTimes(2);
  });

  it("blocks cancellation and never executes a late successful provider response", async () => {
    const release = pendingFetch();
    const pending = invoke();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    controller.abort();
    expect(await pending).toMatchObject({ block: true });
    release();
    await Promise.resolve();
    expect(counter).toBe(0);
    expect(audit()[0].jev.failure).toBe("cancelled");
    expect(audit()).toHaveLength(1);
  });

  it.each(["engine", "policy", "endpoint", "input", "registry", "file", "org", "branch"] as const)(
    "blocks %s changes while a provider response is awaited",
    async (change) => {
      const input = { path: "README.md" };
      syntheticSandbox = change === "org";
      if (change === "branch") session.appendCustomEntry("synthetic-branch-anchor", {});
      const release = pendingFetch();
      const pending = invoke("read", input);
      await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
      if (change === "engine") settings({ engine: "deterministic" });
      if (change === "policy") settings({ confirmTimeoutMs: 45_000 });
      if (change === "endpoint") vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
      if (change === "input") input.path = "other.md";
      if (change === "registry")
        tools = tools.map((tool) =>
          tool.name === "read" ? { ...tool, description: "Changed tool semantics." } : tool,
        );
      if (change === "file") rmSync(join(cwd, "README.md"));
      if (change === "org") syntheticSandbox = false;
      if (change === "branch") {
        session.resetLeaf();
        session.appendCustomEntry("synthetic-sibling-root", {});
      }
      release();
      expect(fetch.mock.calls[0][0]).toBe(ENDPOINT);
      expect(await pending).toMatchObject({ block: true });
      expect(counter).toBe(0);
      expect(fetch).toHaveBeenCalledOnce();
      expect(audit()[0].jev.process.fileStage.match.evidence.requestId).toBe(
        "gen-dec-synthetic-hook-test-1",
      );
      expect(audit()[0].jev.riskAnswer).toBeUndefined();
      expect(audit()[0]).toMatchObject({
        outcome: "hard_block",
        jev: { failure: "identity_mismatch" },
      });
    },
  );

  it.each([
    "engine",
    "policy",
    "endpoint",
    "operatingPoint",
    "input",
    "registry",
    "cancelled",
    "file",
    "org",
    "branch",
  ] as const)("blocks %s changes while approval UI is awaited", async (change) => {
    interactive();
    syntheticSandbox = change === "org";
    if (change === "branch") session.appendCustomEntry("synthetic-branch-anchor", {});
    fetch.mockImplementationOnce(async () => reply()); // Separate synthetic matching receipt.
    fetch.mockImplementationOnce(async () => reply("confirm"));
    const input = { path: "source.ts", content: BODY };
    let approve: (choice: string) => void;
    select.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          approve = resolve;
        }),
    );
    const pending = invoke("write", input);
    await vi.waitFor(() => expect(select).toHaveBeenCalledOnce());
    if (change === "engine") settings({ engine: "deterministic" });
    if (change === "policy") settings({ confirmTimeoutMs: 45_000 });
    if (change === "endpoint") vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
    if (change === "operatingPoint") vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "argmax");
    if (change === "input") input.content = `${BODY}_changed`;
    if (change === "registry")
      tools = tools.map((tool) =>
        tool.name === "write" ? { ...tool, description: "Changed tool semantics." } : tool,
      );
    if (change === "cancelled") controller.abort();
    if (change === "file") writeFileSync(join(cwd, "source.ts"), "Changed local file facts.");
    if (change === "org") syntheticSandbox = false;
    if (change === "branch") {
      session.resetLeaf();
      session.appendCustomEntry("synthetic-sibling-root", {});
    }
    approve("Allow once");
    expect(await pending).toMatchObject({ block: true });
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "changed-context" },
    });
  });
});

describe("private staged file context controls", () => {
  const switchToDeterministic = () =>
    writeFileSync(
      join(agentDir, "settings.json"),
      JSON.stringify({ sfPi: { guardrail: { engine: "deterministic" } } }),
    );
  const matchingReply = () => {
    const body = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string);
    return new Response(
      JSON.stringify({
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        id: "synthetic-file-prefix-hook",
        answers: Object.fromEntries(
          Object.keys(body.questions).map((id) => [
            id,
            {
              type: "choice",
              choice: "no_match",
              probabilities: { match: 0, no_match: 1, unknown: 0 },
              confidence: 0.81,
            },
          ]),
        ),
        usage: { input_tokens: 45, output_tokens: 22 },
      }),
    );
  };
  it("keeps the audited endpoint failure when no endpoint is captured", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "");
    expect(await invoke()).toMatchObject({ block: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "missing_endpoint" },
    });
  });
  it("stops the next dispatch when equal policy contents move to another private profile", async () => {
    const other = join(directory, "second-private-agent");
    mkdirSync(other);
    writeFileSync(
      join(other, "settings.json"),
      JSON.stringify({ sfPi: { guardrail: { engine: "jev" } } }),
    );
    fetch.mockImplementationOnce(async () => {
      const response = matchingReply();
      vi.stubEnv("PI_CODING_AGENT_DIR", other);
      return response;
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "identity_mismatch" },
    });
  });
  it("stops human release when equal policy contents move to another private profile", async () => {
    const other = join(directory, "human-wait-private-agent");
    mkdirSync(other);
    writeFileSync(
      join(other, "settings.json"),
      JSON.stringify({ sfPi: { guardrail: { engine: "jev" } } }),
    );
    interactive();
    fetch.mockImplementation(async () => {
      const body = JSON.parse(fetch.mock.calls.at(-1)![1]!.body as string);
      return Object.keys(body.questions)[0].startsWith("f_") ? matchingReply() : reply("confirm");
    });
    select.mockImplementationOnce(async () => {
      vi.stubEnv("PI_CODING_AGENT_DIR", other);
      return "Allow once";
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "changed-context" },
    });
  });
  it("stops the first dispatch when settings change during initial facts", async () => {
    const original = vi.mocked(resolveJevFacts).getMockImplementation()!;
    vi.mocked(resolveJevFacts).mockImplementationOnce(async (options) => {
      const result = await original(options);
      switchToDeterministic();
      return result;
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(fetch).not.toHaveBeenCalled();
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: { failure: "identity_mismatch" },
    });
  });
  it("stops the policy dispatch after a match reply changes the settings source", async () => {
    fetch.mockImplementationOnce(async () => {
      const response = matchingReply();
      switchToDeterministic();
      return response;
    });
    expect(await invoke()).toMatchObject({ block: true });
    expect(fetch).toHaveBeenCalledOnce();
    expect(counter).toBe(0);
    expect(audit()[0]).toMatchObject({
      outcome: "hard_block",
      jev: {
        process: {
          kind: "file_stages",
          fileStage: {
            match: { stage: "file_match", evidence: { requestId: "synthetic-file-prefix-hook" } },
          },
        },
      },
    });
    expect(audit()[0].jev?.riskOrigin).toBeUndefined();
  });
});
