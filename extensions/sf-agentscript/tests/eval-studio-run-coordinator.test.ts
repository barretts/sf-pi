/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  interruptStudioRuns,
  startStudioBackgroundTask,
} from "../lib/eval-studio/run-coordinator.ts";
import { acquireStudioRunLease } from "../lib/eval-studio/run-lease.ts";
import { applyRunSeedOverrides } from "../lib/eval-studio/run-target.ts";

const dirs: string[] = [];
async function project(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "eval-studio-run-"));
  dirs.push(cwd);
  await writeFile(path.join(cwd, "sfdx-project.json"), "{}");
  return cwd;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Eval Studio Run coordination", () => {
  it("allows only one Studio-owned Run per project", async () => {
    const cwd = await project();
    const first = await acquireStudioRunLease(cwd, "run-one");
    await expect(acquireStudioRunLease(cwd, "run-two")).rejects.toThrow("run-one");
    await first.release();
    const second = await acquireStudioRunLease(cwd, "run-two");
    await second.release();
  });

  it("marks an orphaned running Run interrupted before acquiring the next lease", async () => {
    const cwd = await project();
    const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
    const runDir = path.join(base, "orphan");
    await mkdir(runDir, { recursive: true });
    await writeFile(
      path.join(base, "_studio-lease.json"),
      JSON.stringify({
        schema_version: 1,
        owner_pid: 99999999,
        owner_token: "dead",
        run_id: "orphan",
        acquired: "2026-07-30T00:00:00.000Z",
      }),
    );
    await writeFile(
      path.join(runDir, "status.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: "orphan",
        status: "running",
        phase: "running_batches",
        started: "2026-07-30T00:00:00.000Z",
        updated: "2026-07-30T00:00:00.000Z",
      }),
    );

    const lease = await acquireStudioRunLease(cwd, "next");
    const status = JSON.parse(await readFile(path.join(runDir, "status.json"), "utf8"));
    expect(status).toMatchObject({ status: "interrupted", phase: "owner_lost" });
    await lease.release();
  });

  it("recovers only release Runs owned by the stale Studio coordinator", async () => {
    const cwd = await project();
    const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
    await mkdir(base, { recursive: true });
    await writeFile(
      path.join(base, "_studio-lease.json"),
      JSON.stringify({
        schema_version: 1,
        owner_pid: 99999999,
        owner_token: "studio-token",
        run_id: "release-contract-stale",
        acquired: "2026-07-30T00:00:00.000Z",
      }),
    );
    for (const [runId, coordinator] of [
      ["direct-release", undefined],
      ["studio-release", { kind: "studio", owner_token: "studio-token" }],
    ] as const) {
      const runDir = path.join(base, runId);
      await mkdir(runDir);
      await writeFile(
        path.join(runDir, "manifest.json"),
        JSON.stringify({
          created: "2026-07-30T00:00:01.000Z",
          release_contract: { kind: "generated_baseline" },
          coordinator,
        }),
      );
      await writeFile(
        path.join(runDir, "status.json"),
        JSON.stringify({
          schema_version: 1,
          run_id: runId,
          status: "running",
          phase: "running_batches",
          started: "2026-07-30T00:00:01.000Z",
          updated: "2026-07-30T00:00:01.000Z",
        }),
      );
    }

    const lease = await acquireStudioRunLease(cwd, "next");
    const direct = JSON.parse(
      await readFile(path.join(base, "direct-release", "status.json"), "utf8"),
    );
    const studio = JSON.parse(
      await readFile(path.join(base, "studio-release", "status.json"), "utf8"),
    );
    expect(direct.status).toBe("running");
    expect(studio.status).toBe("interrupted");
    await lease.release();
  });

  it("interrupts active background work when the owner session shuts down", async () => {
    const cwd = await project();
    const appendEntry = vi.fn();
    let observedReason: unknown;
    await startStudioBackgroundTask(
      { appendEntry } as never,
      cwd,
      "release-contract",
      async (signal) =>
        await new Promise((_, reject) => {
          signal.addEventListener("abort", () => {
            observedReason = signal.reason;
            reject(new Error("interrupted"));
          });
        }),
    );
    interruptStudioRuns();
    await vi.waitFor(() => expect(appendEntry).toHaveBeenCalled());
    expect(observedReason).toBe("interrupted");
  });

  it("applies one-run Scenario seed overrides without mutating source", () => {
    const source = {
      tests: [
        {
          id: "scenario",
          steps: [
            {
              type: "agent.send_message",
              id: "turn",
              utterance: "hello",
              context_variables: [{ name: "verified", type: "boolean", value: false }],
            },
          ],
        },
      ],
    };
    const executed = applyRunSeedOverrides(source, {
      scenario: { verified: true, locale: "en-US" },
    });
    expect(executed.tests[0]?.steps[0]?.context_variables).toEqual([
      { name: "verified", type: "boolean", value: true },
      { name: "locale", type: "string", value: "en-US" },
    ]);
    expect(source.tests[0]?.steps[0]?.context_variables).toEqual([
      { name: "verified", type: "boolean", value: false },
    ]);
  });

  it("validates dynamic-profile overrides and preserves the declared type", () => {
    const source = {
      seed_profiles: {
        account: {
          soql: "SELECT Id FROM Account ORDER BY CreatedDate DESC LIMIT 1",
          context_variables: [{ name: "account_id", type: "Text", field: "Id" }],
        },
      },
      tests: [
        {
          id: "scenario",
          seed_profile: "account",
          steps: [{ type: "agent.send_message", id: "turn", utterance: "hello" }],
        },
      ],
    };

    const executed = applyRunSeedOverrides(source, {
      scenario: { account_id: "001OVERRIDE" },
    });
    expect(executed.tests[0]?.steps[0]?.context_variables).toEqual([
      { name: "account_id", type: "Text", value: "001OVERRIDE" },
    ]);
    expect(() => applyRunSeedOverrides(source, { missing: { account_id: "001" } })).toThrow(
      "Unknown eval Scenario seed override 'missing'",
    );
    expect(() =>
      applyRunSeedOverrides(source, { scenario: { account_id: { bad: true } } }),
    ).toThrow("must be a string, number, or boolean");
  });
});
