/* SPDX-License-Identifier: Apache-2.0 */

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { readPublicFailures } from "../lib/eval-tool.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("seeded failure drill-down redaction", () => {
  test("masks org-derived values read back from restricted failure artifacts", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "sf-agentscript-public-failure-"));
    dirs.push(cwd);
    const runDir = path.join(cwd, ".pi", "state", "sf-agentscript", "runs", "seeded");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: "seeded",
        seed_provenance: [
          {
            scenario_id: "scenario",
            names: ["customer_id"],
            sensitive_names: ["customer_id"],
            profile: "customer",
            query_digest: "digest",
          },
        ],
      }),
    );
    await writeFile(
      path.join(runDir, "spec.executed.snapshot.json"),
      JSON.stringify({
        tests: [
          {
            id: "scenario",
            steps: [
              {
                type: "agent.send_message",
                id: "turn",
                context_variables: [{ name: "customer_id", type: "Text", value: "001SECRET" }],
              },
            ],
          },
        ],
      }),
    );
    await writeFile(
      path.join(runDir, "failures.jsonl"),
      `${JSON.stringify({
        test_id: "scenario",
        failed_evaluators: [{ id: "response", actual_value: "Account 001SECRET is unavailable" }],
        step_errors: [],
        turns: [
          {
            turn_id: "turn",
            agent_response: "Account 001SECRET is unavailable",
            turn_errors: [],
            state_variables: { customer_id: "001SECRET" },
            execution_history_last5: [],
            plugins: [],
            llm_events: [],
          },
        ],
        trace_files: [],
      })}\n`,
    );

    const failures = await readPublicFailures({ cwd } as never, "seeded");
    expect(JSON.stringify(failures)).not.toContain("001SECRET");
    expect(failures[0]?.turns[0]?.state_variables.customer_id).toBe("[REDACTED]");

    await rm(path.join(runDir, "manifest.json"));
    await expect(readPublicFailures({ cwd } as never, "seeded")).rejects.toThrow(
      "Unable to safely expose failure evidence for run 'seeded'",
    );
  });
});
