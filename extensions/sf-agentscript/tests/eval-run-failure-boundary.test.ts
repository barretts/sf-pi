/* SPDX-License-Identifier: Apache-2.0 */
import { access, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EvalTest } from "../lib/eval/types.ts";

const mockState = vi.hoisted(() => ({
  mode: "success" as
    | "success"
    | "behavioral_failure"
    | "missing_result"
    | "timeout"
    | "concurrent_timeout"
    | "cancelled"
    | "interrupted"
    | "trace"
    | "terminal_persistence_failure",
  controller: undefined as AbortController | undefined,
  runDir: undefined as string | undefined,
  lastCallOptions: undefined as { timeoutMs?: number; signal?: AbortSignal } | undefined,
}));

vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/eval-client.ts")>();
  return {
    ...actual,
    callEval: vi.fn(
      async (
        _conn,
        tests: EvalTest[],
        _headers,
        options: { timeoutMs?: number; signal?: AbortSignal },
      ) => {
        mockState.lastCallOptions = options;
        if (mockState.mode === "terminal_persistence_failure" && mockState.runDir) {
          await rm(mockState.runDir, { recursive: true, force: true });
          await writeFile(mockState.runDir, "blocked", "utf8");
        }
        if (
          mockState.mode === "timeout" ||
          (mockState.mode === "concurrent_timeout" && tests[0]?.id === "scenario-1")
        ) {
          const error = new Error("Evaluation API batch timed out after 1000ms.");
          error.name = "TimeoutError";
          throw error;
        }
        if (mockState.mode === "concurrent_timeout") {
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        if (mockState.mode === "cancelled" || mockState.mode === "interrupted") {
          mockState.controller?.abort(
            mockState.mode === "interrupted" ? "interrupted" : "cancelled",
          );
          return { status: 499, body: {}, endpoint: "", endpoint_cache: "miss" as const };
        }
        if (mockState.mode === "missing_result") {
          return {
            status: 200,
            body: { results: [] },
            endpoint: "",
            endpoint_cache: "miss" as const,
          };
        }
        return {
          status: 200,
          body: {
            results: tests.map((test) => ({
              id: test.id,
              outputs:
                mockState.mode === "trace" || mockState.mode === "behavioral_failure"
                  ? [
                      { type: "agent.create_session", id: "session", session_id: "SID-1" },
                      {
                        type: "agent.send_message",
                        id: "turn",
                        response: { messages: [{ message: "hello back" }] },
                      },
                      {
                        type: "agent.get_state",
                        id: "state",
                        response: {
                          planner_response: {
                            sessionProperties: { planId: "PID-1", sessionId: "SID-1" },
                            lastExecution: {
                              topic: "main",
                              agentResponse: "hello back",
                              invokedActions: [],
                              errors: [],
                              llmEvents: [],
                            },
                            sessionContext: { stateVariables: {} },
                          },
                        },
                      },
                    ]
                  : [],
              evaluation_results: test.steps
                .filter((step) => step.type.startsWith("evaluator."))
                .map((step) => ({
                  id: step.id,
                  type: step.type,
                  is_pass: mockState.mode !== "behavioral_failure",
                })),
            })),
          },
          endpoint: "",
          endpoint_cache: "miss" as const,
        };
      },
    ),
  };
});

import { runEval } from "../lib/eval/orchestrator.ts";

const conn = {
  instanceUrl: "https://example.invalid",
  identity: async () => ({ user_id: "005000000000001", organization_id: "00D000000000001" }),
};

function spec() {
  return {
    tests: [
      {
        id: "scenario",
        steps: [
          {
            type: "agent.create_session",
            id: "session",
            agent_id: "0Xx",
            agent_version_id: "0X9",
          },
          { type: "agent.send_message", id: "turn", utterance: "hello" },
          {
            type: "evaluator.string_assertion",
            id: "response_ok",
            actual: "{turn.response}",
            expected: "hello back",
          },
        ],
      },
    ],
  };
}

async function readJson(file: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
}

let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sf-agentscript-eval-failure-boundary-"));
  mockState.mode = "success";
  mockState.controller = undefined;
  mockState.runDir = undefined;
  mockState.lastCallOptions = undefined;
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("eval Run failure boundaries", () => {
  it("records behavioral failure as completed execution with failed evidence", async () => {
    mockState.mode = "behavioral_failure";
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "behavioral",
      tracesMode: "off",
      spec: spec(),
    });

    expect(result.metadata).toMatchObject({
      execution_state: "completed",
      evidence_verdict: "failed",
      failed_batches: 0,
    });
    expect(result.failures[0]?.turns[0]?.utterance).toBe("hello");
    expect(await readJson(path.join(base, "behavioral", "status.json"))).toMatchObject({
      status: "completed",
      phase: "completed",
    });
    expect(await readJson(path.join(base, "behavioral", "evidence.json"))).toMatchObject({
      verdict: "failed",
    });
    expect(await readFile(path.join(base, "behavioral", "failures.jsonl"), "utf8")).toContain(
      '"test_id":"scenario"',
    );
  });

  it("records a successful HTTP response with missing tests as incomplete evidence", async () => {
    mockState.mode = "missing_result";
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "missing",
      tracesMode: "off",
      spec: spec(),
    });

    expect(result.metadata).toMatchObject({
      execution_state: "completed",
      evidence_verdict: "incomplete",
      returned_tests_count: 0,
      missing_test_ids: ["scenario"],
    });
    expect(await readJson(path.join(base, "missing", "evidence.json"))).toMatchObject({
      verdict: "incomplete",
    });
  });

  it("persists timeout as infrastructure failure without passing evidence", async () => {
    mockState.mode = "timeout";
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "timeout",
        batchTimeoutMs: 1000,
        tracesMode: "off",
        spec: spec(),
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    expect(mockState.lastCallOptions).toMatchObject({ timeoutMs: 1000 });
    expect(await readJson(path.join(base, "timeout", "status.json"))).toMatchObject({
      status: "infrastructure_failed",
      phase: "running_batches",
      batch_timeout_ms: 1000,
      error: { name: "TimeoutError" },
    });
    await expect(access(path.join(base, "timeout", "evidence.json"))).rejects.toThrow();
  });

  it("drains delayed batches before persisting terminal timeout status", async () => {
    mockState.mode = "concurrent_timeout";
    const tests = Array.from({ length: 6 }, (_, index) => ({
      ...spec().tests[0],
      id: `scenario-${index + 1}`,
    }));
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "concurrent-timeout",
        concurrency: 2,
        batchTimeoutMs: 1000,
        tracesMode: "off",
        spec: { tests },
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });

    const statusPath = path.join(base, "concurrent-timeout", "status.json");
    expect(await readJson(statusPath)).toMatchObject({
      status: "infrastructure_failed",
      phase: "running_batches",
      error: { name: "TimeoutError" },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(await readJson(statusPath)).toMatchObject({
      status: "infrastructure_failed",
      phase: "running_batches",
    });
  });

  it.each([
    ["cancelled", "cancelled"],
    ["interrupted", "interrupted"],
  ] as const)("persists %s batch abortion distinctly", async (mode, expectedStatus) => {
    mockState.mode = mode;
    mockState.controller = new AbortController();
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: mode,
        tracesMode: "off",
        signal: mockState.controller.signal,
        spec: spec(),
      }),
    ).rejects.toThrow();

    expect(await readJson(path.join(base, mode, "status.json"))).toMatchObject({
      status: expectedStatus,
      phase: "running_batches",
    });
    await expect(access(path.join(base, mode, "evidence.json"))).rejects.toThrow();
  });

  it("reuses the normalized utterance for trace and transcript artifacts", async () => {
    mockState.mode = "trace";
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "trace",
      tracesMode: "all",
      spec: spec(),
    });

    expect(result.metadata).toMatchObject({ traces_mode: "all", traces_synthesized: 1 });
    const traceFiles = await readdir(path.join(base, "trace", "traces"));
    expect(traceFiles).toHaveLength(1);
    const trace = await readJson(path.join(base, "trace", "traces", traceFiles[0]));
    expect(trace.plan).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "UserInputStep", data: { utterance: "hello" } }),
      ]),
    );
    expect(await readFile(path.join(base, "trace", "transcript.jsonl"), "utf8")).toContain(
      '"utterance":"hello"',
    );
  });

  it("returns equivalent success semantics without creating persistence artifacts", async () => {
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "no-persist",
      noPersist: true,
      tracesMode: "off",
      spec: spec(),
    });

    expect(result.run_dir).toBeUndefined();
    expect(result.metadata).toMatchObject({
      execution_state: "completed",
      evidence_verdict: "passed",
    });
    expect(await readdir(base)).toEqual([]);
  });

  it("fails seed preflight before creating a Run", async () => {
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "seed-failure",
        tracesMode: "off",
        spec: {
          tests: [{ ...spec().tests[0], seed_profile: "missing" }],
        },
      }),
    ).rejects.toThrow("Unknown eval seed profile 'missing'.");
    expect(await readdir(base)).toEqual([]);
  });

  it("surfaces terminal evidence persistence failure after the Run has begun", async () => {
    mockState.mode = "terminal_persistence_failure";
    mockState.runDir = path.join(base, "terminal-persistence-failure");
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "terminal-persistence-failure",
        tracesMode: "off",
        spec: spec(),
      }),
    ).rejects.toThrow();
    expect(await readFile(mockState.runDir, "utf8")).toBe("blocked");
  });

  it("surfaces start-artifact persistence failure without deleting the conflicting path", async () => {
    const blockedBase = path.join(base, "blocked");
    await writeFile(blockedBase, "keep", "utf8");
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: blockedBase,
        runId: "persistence-failure",
        tracesMode: "off",
        spec: spec(),
      }),
    ).rejects.toThrow();
    expect(await readFile(blockedBase, "utf8")).toBe("keep");
  });
});
