/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "terminal" as "terminal" | "progress",
  terminalWriteStarted: false,
  progressGate: undefined as Promise<void> | undefined,
  progressWriteStarted: undefined as (() => void) | undefined,
  progressWriteStartedSignal: undefined as Promise<void> | undefined,
}));

vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/eval-client.ts")>();
  return {
    ...actual,
    callEval: vi.fn(async (_conn, tests: Array<{ id: string; steps: unknown[] }>) => {
      if (state.mode === "progress" && tests[0]?.id === "scenario-6") {
        await state.progressWriteStartedSignal;
        throw new Error("ORIGINAL_BATCH_FAILURE");
      }
      return {
        status: 200,
        body: {
          results: tests.map((test) => ({
            id: test.id,
            evaluation_results: [
              { id: "response_ok", type: "evaluator.string_assertion", is_pass: true },
            ],
          })),
        },
        endpoint: "",
        endpoint_cache: "miss" as const,
      };
    }),
  };
});

vi.mock("../lib/eval/persist.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/persist.ts")>();
  return {
    ...actual,
    writeRun: vi.fn(async (...args: Parameters<typeof actual.writeRun>) => {
      if (state.mode === "terminal") {
        state.terminalWriteStarted = true;
        throw new Error("ORIGINAL_PERSISTENCE_FAILURE");
      }
      return await actual.writeRun(...args);
    }),
    writeRunStatus: vi.fn(async (...args: Parameters<typeof actual.writeRunStatus>) => {
      const artifact = args[1];
      if (
        state.mode === "progress" &&
        artifact.status === "running" &&
        artifact.progress?.completed_batches === 1
      ) {
        state.progressWriteStarted?.();
        await state.progressGate;
        throw new Error("PROGRESS_STATUS_FAILURE");
      }
      if (state.terminalWriteStarted) throw new Error("FALLBACK_STATUS_FAILURE");
      return await actual.writeRunStatus(...args);
    }),
  };
});

import { runEval } from "../lib/eval/orchestrator.ts";

const conn = {
  instanceUrl: "https://example.invalid",
  identity: async () => ({ user_id: "005000000000001", organization_id: "00D000000000001" }),
};

function scenario(id: string) {
  return {
    id,
    steps: [
      {
        type: "agent.create_session",
        id: "session",
        agent_id: "0Xx",
        agent_version_id: "0X9",
      },
      { type: "agent.send_message", id: "turn", utterance: "hello" },
      { type: "evaluator.string_assertion", id: "response_ok" },
    ],
  };
}

let base: string;

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sf-agentscript-terminal-persistence-"));
  state.mode = "terminal";
  state.terminalWriteStarted = false;
  state.progressGate = undefined;
  state.progressWriteStarted = undefined;
  state.progressWriteStartedSignal = undefined;
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("eval terminal persistence", () => {
  it("preserves the original run error when fallback status persistence also fails", async () => {
    const logs: string[] = [];
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "terminal-persistence",
        tracesMode: "off",
        log: (message) => logs.push(message),
        spec: { tests: [scenario("scenario")] },
      }),
    ).rejects.toThrow("ORIGINAL_PERSISTENCE_FAILURE");
    expect(logs).toContain("Failed to persist terminal eval status: FALLBACK_STATUS_FAILURE");
  });

  it("preserves a batch error when an already-queued progress write also fails", async () => {
    state.mode = "progress";
    let releaseProgressWrite!: () => void;
    state.progressGate = new Promise<void>((resolve) => {
      releaseProgressWrite = resolve;
    });
    let markProgressWriteStarted!: () => void;
    state.progressWriteStartedSignal = new Promise<void>((resolve) => {
      markProgressWriteStarted = resolve;
    });
    state.progressWriteStarted = markProgressWriteStarted;
    const logs: string[] = [];
    const outcome = runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "progress-persistence",
      concurrency: 2,
      tracesMode: "off",
      log: (message) => logs.push(message),
      spec: { tests: Array.from({ length: 6 }, (_, index) => scenario(`scenario-${index + 1}`)) },
    });

    await state.progressWriteStartedSignal;
    releaseProgressWrite();
    await expect(outcome).rejects.toThrow("ORIGINAL_BATCH_FAILURE");
    expect(logs).toContain("Failed to drain eval progress status writes: PROGRESS_STATUS_FAILURE");
    const status = JSON.parse(
      await readFile(path.join(base, "progress-persistence", "status.json"), "utf8"),
    );
    expect(status).toMatchObject({
      status: "infrastructure_failed",
      error: { message: "ORIGINAL_BATCH_FAILURE" },
    });
  });
});
