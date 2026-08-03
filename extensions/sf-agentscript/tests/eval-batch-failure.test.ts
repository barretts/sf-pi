/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/eval-client.ts")>();
  return {
    ...actual,
    callEval: vi.fn(async () => ({
      status: 422,
      body: { detail: [{ msg: "unsupported evaluator" }] },
      endpoint: "",
    })),
  };
});

import { runEval } from "../lib/eval/orchestrator.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-batch-failure-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("eval batch failure evidence", () => {
  test("persists non-2xx bodies and marks the run failed instead of green 0/0", async () => {
    const conn = {
      instanceUrl: "https://example.invalid",
      identity: async () => ({ user_id: "005", organization_id: "00D" }),
    };
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: workDir,
      runBase: workDir,
      tracesMode: "off",
      spec: {
        tests: [
          {
            id: "stateful",
            steps: [
              {
                type: "agent.create_session",
                id: "session",
                agent_id: "0Xx",
                agent_version_id: "0X9",
              },
            ],
          },
        ],
      },
    });

    expect(result.failed_batches).toBe(1);
    expect(result.batch_failures).toEqual([
      {
        batch_index: 0,
        status: 422,
        test_ids: ["stateful"],
        body: { detail: [{ msg: "unsupported evaluator" }] },
      },
    ]);
    expect(result.metadata.returned_tests_count).toBe(0);
    expect(result.metadata.missing_test_ids).toEqual(["stateful"]);

    const status = JSON.parse(await readFile(path.join(result.run_dir!, "status.json"), "utf8"));
    expect(status).toMatchObject({
      status: "infrastructure_failed",
      progress: { completed_batches: 1, total_batches: 1, returned_tests: 0 },
    });
    const persisted = JSON.parse(
      await readFile(path.join(result.run_dir!, "batch-failures.json"), "utf8"),
    );
    expect(persisted).toEqual(result.batch_failures);
  });
});
