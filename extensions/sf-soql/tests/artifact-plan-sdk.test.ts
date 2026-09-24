/* SPDX-License-Identifier: Apache-2.0 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEventBus,
  createExtensionRuntime,
  ExtensionRunner,
  ModelRegistry,
  ModelRuntime,
  SessionManager,
  wrapRegisteredTool,
  type ToolCallEvent,
  type ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { loadExtensionFromFactory } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/index.js";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  artifactRoot: "/unused",
  connect: vi.fn(),
  afterWrite: undefined as ((file: string) => void) | undefined,
}));
vi.mock("node:fs/promises", async (original) => {
  const api = await original<typeof import("node:fs/promises")>();
  return {
    ...api,
    writeFile: async (...args: Parameters<typeof api.writeFile>) => {
      const result = await api.writeFile(...args);
      if (typeof args[0] === "string" && args[0].startsWith(fixture.artifactRoot))
        fixture.afterWrite?.(args[0]);
      return result;
    },
  };
});
vi.mock("../../../lib/common/pi-paths.ts", async (original) => {
  const api = await original<typeof import("../../../lib/common/pi-paths.ts")>();
  // The artifact module captures its root at import. Keep that root in our own tree.
  fixture.artifactRoot = mkdtempSync(path.join(tmpdir(), "sf-soql-artifact-sdk-root-"));
  return {
    ...api,
    globalAgentPath: (...parts: string[]) =>
      parts[0] === "sf-pi" && parts[1] === "sf-soql"
        ? fixture.artifactRoot
        : api.globalAgentPath(...parts),
  };
});
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({
  connectSalesforce: (options: unknown) => fixture.connect(options),
}));

import sfGuardrail from "../../sf-guardrail/index.ts";
import { registerSfSoqlTool } from "../lib/sf-soql-tool.ts";
import { JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../../sf-guardrail/lib/jev-client.ts";
import { readRecentDecisions } from "../../sf-guardrail/lib/approval-ledger.ts";
import { revokeAllSoqlArtifactPlans } from "../../../lib/common/sf-soql-artifact-plan/store.ts";

const params = {
  action: "query.run",
  query: "SELECT Id FROM Demo__c LIMIT 3",
  max_rows: 3,
  target_org: "SyntheticOrg",
};
let directory: string;
let agentDir: string;
let runner: ExtensionRunner;
let controller: AbortController;
let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>;
let query: ReturnType<typeof vi.fn>;
let auditFails: boolean;
let requestBodies: Record<string, unknown>[];

function setEngine(engine = "jev") {
  writeFileSync(
    path.join(agentDir, "settings.json"),
    JSON.stringify({
      sfPi: { guardrail: { engine, productionAliases: ["SyntheticOrg"] } },
    }),
  );
}
function reply(choice = "allow") {
  const request = requestBodies.at(-1) as { questions: Record<string, unknown> };
  return new Response(
    JSON.stringify({
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      id: `synthetic-plan-sdk-reply-${requestBodies.length}`,
      answers: Object.fromEntries(
        Object.keys(request.questions).map((id) => [
          id,
          {
            type: "choice",
            choice,
            confidence: 1,
            probabilities: {
              allow: choice === "allow" ? 1 : 0,
              confirm: 0,
              block: choice === "block" ? 1 : 0,
            },
          },
        ]),
      ),
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  );
}
function event(id = "call-1"): ToolCallEvent {
  return { type: "tool_call", toolName: "sf_soql", toolCallId: id, input: params };
}
async function execute(id = "call-1", input: Record<string, unknown> = params) {
  const registered = runner
    .getAllRegisteredTools()
    .find((tool) => tool.definition.name === "sf_soql");
  if (!registered) throw new Error("Missing synthetic registered SOQL tool.");
  return wrapRegisteredTool(registered, runner).execute(id, input, controller.signal, undefined);
}
function emptyArtifacts() {
  return readdirSync(fixture.artifactRoot).length === 0;
}

beforeEach(async () => {
  rmSync(path.join(fixture.artifactRoot, "runs"), { recursive: true, force: true });
  directory = mkdtempSync(path.join(tmpdir(), "sf-soql-artifact-sdk-profile-"));
  agentDir = path.join(directory, "agent");
  const cwd = path.join(directory, "project");
  mkdirSync(agentDir);
  mkdirSync(cwd);
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "https://decisions.example.test/v1/decisions");
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "synthetic-plan-test-key");
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  setEngine();
  controller = new AbortController();
  auditFails = false;
  fixture.afterWrite = undefined;
  requestBodies = [];
  query = vi.fn(async () => ({
    totalSize: 1,
    done: true,
    records: [{ Id: "001000000000001AAA" }],
  }));
  fixture.connect.mockReset();
  fixture.connect.mockResolvedValue({
    target: { apiVersion: "67.0" },
    query,
    path: (resource: string) => `/services/data/v67.0${resource}`,
  });
  fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    requestBodies.push(JSON.parse(String(init?.body)));
    return reply();
  });
  vi.stubGlobal("fetch", fetch);
  const runtime = createExtensionRuntime();
  const extension = await loadExtensionFromFactory(
    (pi) => {
      sfGuardrail(pi);
      registerSfSoqlTool(pi);
    },
    cwd,
    createEventBus(),
    runtime,
    "<synthetic-soql-plan-test>",
  );
  const session = SessionManager.inMemory(cwd);
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(agentDir, "auth.json"),
    modelsPath: null,
    modelsStorePath: path.join(agentDir, "model-cache.json"),
    allowModelNetwork: false,
    refreshOnCreate: false,
  });
  runner = new ExtensionRunner([extension], runtime, cwd, session, new ModelRegistry(modelRuntime));
  const tools: ToolInfo[] = runner.getAllRegisteredTools().map(({ definition, sourceInfo }) => ({
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
        if (auditFails) throw new Error("Synthetic audit failure.");
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
  revokeAllSoqlArtifactPlans();
  runner?.invalidate("Synthetic SOQL plan check finished.");
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  rmSync(fixture.artifactRoot, { recursive: true, force: true });
});

describe("registered SOQL tool and Jev artifact plan", () => {
  it("uses the exact five observed paths after allow audit and one claim", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    expect(fixture.connect).not.toHaveBeenCalled();
    const state = requestBodies[0].state as {
      operation: { metadata: { fileAccesses: Array<{ path: string; access: string }> } };
      observations: { contextComplete: boolean };
    };
    const paths = state.operation.metadata.fileAccesses
      .filter((access) => access.access === "write")
      .map((access) => access.path);
    expect(paths).toHaveLength(5);
    expect(state.observations.contextComplete).toBe(true);
    expect(readRecentDecisions(runner.createContext())[0].outcome).toBe("allow_auto");
    const result = await execute();
    expect(result.details).toMatchObject({
      digest: { status: "pass", artifacts: paths.map((path) => ({ path })) },
    });
    expect(query).toHaveBeenCalledOnce();
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(paths.map((name) => path.basename(name))).toEqual([
      "query.soql",
      "result.raw.json",
      "result.flattened.json",
      "result.flattened.csv",
      "summary.json",
    ]);
    expect(readFileSync(paths[0], "utf8")).toContain("SELECT Id FROM Demo__c LIMIT 3");
    expect(statSync(paths[0]).mode & 0o777).toBe(0o600);
    expect(statSync(path.dirname(paths[0])).mode & 0o777).toBe(0o700);
    expect(JSON.stringify(requestBodies)).not.toContain(params.query);
    expect(JSON.stringify(requestBodies)).not.toContain('sensitivity":"ordinary');
    const repeated = await execute();
    expect(repeated.details).toMatchObject({ digest: { status: "fail" } });
    expect(query).toHaveBeenCalledOnce();
    expect(fixture.connect).toHaveBeenCalledOnce();
  });

  it.each([
    "missing",
    "another-call",
    "changed-input",
    "cancelled",
    "revoked",
    "malformed-settings",
    "changed-engine",
    "changed-facts",
  ])("blocks %s before tool connection and API use", async (mode) => {
    if (mode !== "missing") expect(await runner.emitToolCall(event())).toBeUndefined();
    if (mode === "cancelled") controller.abort();
    if (mode === "revoked") revokeAllSoqlArtifactPlans();
    if (mode === "changed-engine") setEngine("deterministic");
    if (mode === "changed-facts") {
      const state = requestBodies[0].state as {
        operation: { metadata: { fileAccesses: Array<{ path: string; access: string }> } };
      };
      const file = state.operation.metadata.fileAccesses.find(
        (access) => access.access === "write",
      )!.path;
      mkdirSync(path.dirname(file), { recursive: true });
    }
    if (mode === "malformed-settings")
      writeFileSync(
        path.join(agentDir, "settings.json"),
        '{"sfPi":{"guardrail":{"engine":"jev","engine":"deterministic"}}}',
      );
    const result = await execute(
      mode === "another-call" ? "call-2" : "call-1",
      mode === "changed-input" ? { ...params, max_rows: 4 } : params,
    );
    expect(result.details).toMatchObject({ digest: { status: "fail" } });
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    if (mode !== "changed-facts") expect(emptyArtifacts()).toBe(true);
  });

  it.each(["block", "malformed", "audit-failure"])("leaves no authority after %s", async (mode) => {
    if (mode === "block")
      fetch.mockImplementation(async (_url, init) => {
        requestBodies.push(JSON.parse(String(init?.body)));
        return reply("block");
      });
    if (mode === "malformed") fetch.mockResolvedValue(new Response("{}"));
    if (mode === "audit-failure") auditFails = true;
    expect(await runner.emitToolCall(event())).toMatchObject({ block: true });
    const result = await execute();
    expect(result.details).toMatchObject({ digest: { status: "fail" } });
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(emptyArtifacts()).toBe(true);
  });

  it("refuses a collision after the API read without choosing another destination", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    const state = requestBodies[0].state as {
      operation: { metadata: { fileAccesses: Array<{ path: string; access: string }> } };
    };
    const file = state.operation.metadata.fileAccesses.find(
      (access) => access.access === "write",
    )!.path;
    query.mockImplementation(async () => {
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, "PRESERVE_EXISTING");
      return { totalSize: 0, done: true, records: [] };
    });
    const result = await execute();
    expect(result.details).toMatchObject({ digest: { status: "fail" } });
    expect(readFileSync(file, "utf8")).toBe("PRESERVE_EXISTING");
    expect(readdirSync(path.join(fixture.artifactRoot, "runs"))).toHaveLength(1);
  });

  it("checks cancellation after the API before the first artifact effect", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    query.mockImplementation(async () => {
      controller.abort();
      return { totalSize: 0, done: true, records: [] };
    });
    const result = await execute();
    expect(result.details).toMatchObject({ digest: { status: "fail" } });
    expect(query).toHaveBeenCalledOnce();
    expect(emptyArtifacts()).toBe(true);
  });

  it("permits only one parallel consumer before connection", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    const results = await Promise.all([execute(), execute()]);
    const states = results
      .map((result) => (result.details as { digest: { status: string } }).digest.status)
      .sort();
    expect(states).toEqual(["fail", "pass"]);
    expect(fixture.connect).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledOnce();
  });

  it("executes the approved snapshot when a caller retains and changes its object", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    const retained = { ...params };
    fixture.connect.mockImplementation(async () => {
      retained.query = "SELECT Name FROM Other__c LIMIT 9";
      retained.target_org = "AnotherOrg";
      return {
        target: { apiVersion: "67.0" },
        query,
        path: (resource: string) => `/services/data/v67.0${resource}`,
      };
    });
    expect((await execute("call-1", retained)).details).toMatchObject({
      digest: { status: "pass" },
    });
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ soql: params.query, maxRows: 3 }));
    expect(fixture.connect).toHaveBeenCalledWith(
      expect.objectContaining({ targetOrg: params.target_org }),
    );
    expect(retained.query).not.toBe(params.query);
  });

  it("revokes prepared authority before extension reload", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    await runner.emit({ type: "session_shutdown", reason: "reload" });
    expect((await execute()).details).toMatchObject({ digest: { status: "fail" } });
    expect(fixture.connect).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(emptyArtifacts()).toBe(true);
  });

  it.each(["finished", "revoked", "expired"])(
    "blocks a %s Jev call after another preparation and an engine change",
    async (state) => {
      expect(await runner.emitToolCall(event())).toBeUndefined();
      if (state === "finished") {
        expect((await execute()).details).toMatchObject({ digest: { status: "pass" } });
      } else if (state === "revoked") {
        revokeAllSoqlArtifactPlans();
      } else {
        const now = Date.now();
        vi.spyOn(Date, "now").mockReturnValue(now + 10 * 60 * 1000);
      }
      expect(await runner.emitToolCall(event("call-2"))).toBeUndefined();
      setEngine("deterministic");
      fixture.connect.mockClear();
      query.mockClear();
      expect((await execute()).details).toMatchObject({ digest: { status: "fail" } });
      expect(fixture.connect).not.toHaveBeenCalled();
      expect(query).not.toHaveBeenCalled();
      if (state !== "finished") expect(emptyArtifacts()).toBe(true);
      vi.restoreAllMocks();
    },
  );

  it("keeps validation from becoming query execution during a pending connection", async () => {
    const retained = { ...params, action: "query.validate" };
    let release!: (value: unknown) => void;
    fixture.connect.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    const pending = execute("validation-call", retained);
    await vi.waitFor(() => expect(fixture.connect).toHaveBeenCalledOnce());
    retained.action = "query.run";
    const request = vi.fn(async () => {
      throw new Error("Synthetic validation marker.");
    });
    release({ target: { apiVersion: "67.0" }, query, request });
    await expect(pending).rejects.toThrow("Synthetic validation marker.");
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/sobjects/Demo__c/describe" }),
    );
    expect(query).not.toHaveBeenCalled();
    expect(emptyArtifacts()).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds a fresh destination for the next identical query call", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    expect((await execute()).details).toMatchObject({ digest: { status: "pass" } });
    const first = readRecentDecisions(runner.createContext())[0].fingerprint;
    expect(await runner.emitToolCall(event("call-2"))).toBeUndefined();
    const second = readRecentDecisions(runner.createContext())[0].fingerprint;
    expect(second).not.toBe(first);
    expect((await execute("call-2")).details).toMatchObject({ digest: { status: "pass" } });
    expect(readdirSync(path.join(fixture.artifactRoot, "runs"))).toHaveLength(2);
  });

  it("retains partial owned output after cancellation during writes", async () => {
    expect(await runner.emitToolCall(event())).toBeUndefined();
    fixture.afterWrite = (file) => {
      if (path.basename(file) === "query.soql") controller.abort();
    };
    expect((await execute()).details).toMatchObject({ digest: { status: "fail" } });
    const directories = readdirSync(path.join(fixture.artifactRoot, "runs"));
    expect(directories).toHaveLength(1);
    const owned = path.join(fixture.artifactRoot, "runs", directories[0]);
    expect(readdirSync(owned)).toEqual(["query.soql"]);
    expect(readFileSync(path.join(owned, "query.soql"), "utf8")).toContain(params.query);
  });

  it("keeps the validated deterministic writer and its current file names", async () => {
    setEngine("deterministic");
    expect(await runner.emitToolCall(event())).toBeUndefined();
    const result = await execute();
    expect(result.details).toMatchObject({ digest: { status: "pass" } });
    expect(fetch).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledOnce();
    expect(readdirSync(path.join(fixture.artifactRoot, "runs"))[0]).toContain("Demo__c");
  });
});
