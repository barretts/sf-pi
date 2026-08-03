/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  AGENT_SCRIPT_RELEASE_BASELINE_ID,
  evaluateActivationEvidence,
  hashEvalSpec,
  rewriteReleaseSpecForLatest,
} from "../lib/release-contract.ts";

const dirs: string[] = [];
function tempCwd(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "sf-agentscript-release-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Agent Script Release Eval Contract", () => {
  it("rewrites active placeholders to latest for inactive-version release eval without mutating the source spec", () => {
    const source = {
      tests: [
        {
          id: "release",
          steps: [
            {
              type: "agent.create_session",
              id: "session",
              planner_id: "$active_planner_id",
              setupSessionContext: {
                tags: {
                  botId: "$active_bot_id",
                  botVersionId: "$active_bot_version_id",
                },
              },
            },
          ],
        },
      ],
    };

    const rewritten = rewriteReleaseSpecForLatest(source);
    expect(JSON.stringify(rewritten)).toContain("$latest_planner_id");
    expect(JSON.stringify(rewritten)).toContain("$latest_bot_version_id");
    expect(JSON.stringify(source)).toContain("$active_planner_id");
  });

  it("accepts complete baseline and current designated-suite evidence for the exact org version", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const designatedPath = path.join(cwd, "tests", "agentforce", `${agent}.eval.json`);
    const designated = { tests: [{ id: "refund", steps: [] }] };
    mkdirSync(path.dirname(designatedPath), { recursive: true });
    writeFileSync(designatedPath, `${JSON.stringify(designated)}\n`);

    const baselineDigest = writeBaselineSource(cwd, agent);
    writeRun(cwd, "baseline-run", {
      kind: "generated_baseline",
      spec_digest: baselineDigest,
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    writeRun(cwd, "designated-run", {
      kind: "designated",
      spec_digest: hashEvalSpec(designated),
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    // `_index.json` is display-only. Exact release evidence remains valid after eviction.
    const runBase = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
    writeFileSync(path.join(runBase, "_index.json"), "[]");
    // Simulate a process ending after designated evidence became terminal but before index update.
    writeFileSync(
      path.join(runBase, "_release-evidence.json"),
      JSON.stringify({
        schema_version: 1,
        entries: [
          {
            run_id: "baseline-run",
            org_id: "00D000000000001",
            agent_api_name: agent,
            bot_version_id: "0X9000000000001",
            kind: "generated_baseline",
            spec_digest: baselineDigest,
            baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
          },
        ],
      }),
    );

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });

    expect(result).toMatchObject({ proceed: true, required: ["generated_baseline", "designated"] });
    expect(result.evidence).toHaveLength(2);
    const releaseIndex = JSON.parse(
      readFileSync(
        path.join(cwd, ".pi", "state", "sf-agentscript", "runs", "_release-evidence.json"),
        "utf8",
      ),
    );
    expect(releaseIndex.entries).toHaveLength(2);
  });

  it("rejects release evidence whose immutable snapshot digest does not match the manifest", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const digest = writeBaselineSource(cwd, agent);
    writeRun(cwd, "tampered-run", {
      kind: "generated_baseline",
      spec_digest: digest,
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    writeFileSync(
      path.join(
        cwd,
        ".pi",
        "state",
        "sf-agentscript",
        "runs",
        "tampered-run",
        "spec.executed.snapshot.json",
      ),
      JSON.stringify({ tests: [{ id: "replaced", steps: [] }] }),
    );

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });
    expect(result).toMatchObject({ proceed: false, missing: ["generated_baseline"] });
  });

  it("rejects a passing metadata file until status and raw evidence are terminal", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const digest = writeBaselineSource(cwd, agent);
    writeRun(cwd, "partial-run", {
      kind: "generated_baseline",
      spec_digest: digest,
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    writeFileSync(
      path.join(cwd, ".pi", "state", "sf-agentscript", "runs", "partial-run", "status.json"),
      JSON.stringify({
        schema_version: 1,
        run_id: "partial-run",
        status: "running",
        phase: "persisting",
        started: "2026-07-30T00:00:00.000Z",
        updated: "2026-07-30T00:00:01.000Z",
      }),
    );

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });
    expect(result).toMatchObject({ proceed: false, missing: ["generated_baseline"] });
  });

  it("rejects generated-baseline evidence when the current generated source changes", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const originalDigest = writeBaselineSource(cwd, agent);
    writeRun(cwd, "baseline-run", {
      kind: "generated_baseline",
      spec_digest: originalDigest,
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    const baselinePath = path.join(
      cwd,
      ".pi",
      "state",
      "sf-agentscript",
      "release-contracts",
      `${agent}.generated.eval.json`,
    );
    writeFileSync(baselinePath, JSON.stringify({ tests: [{ id: "changed", steps: [] }] }));

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });

    expect(result).toMatchObject({ proceed: false, missing: ["generated_baseline"] });
  });

  it("rejects stale designated evidence when the current suite changes", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const designatedPath = path.join(cwd, "tests", "agentforce", `${agent}.eval.json`);
    mkdirSync(path.dirname(designatedPath), { recursive: true });
    writeFileSync(designatedPath, JSON.stringify({ tests: [{ id: "new", steps: [] }] }));
    const baselineDigest = writeBaselineSource(cwd, agent);
    writeRun(cwd, "baseline-run", {
      kind: "generated_baseline",
      spec_digest: baselineDigest,
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    writeRun(cwd, "stale-designated", {
      kind: "designated",
      spec_digest: "old-digest",
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });

    expect(result).toMatchObject({ proceed: false, missing: ["designated"] });
  });
});

function writeRun(
  cwd: string,
  runId: string,
  releaseContract: { kind: string; spec_digest: string; baseline_id: string },
): void {
  const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
  const run = path.join(base, runId);
  mkdirSync(run, { recursive: true });
  const proofSpec = {
    tests: [
      {
        id: "release",
        steps: [{ type: "evaluator.string_assertion", id: "ok" }],
      },
    ],
  };
  writeFileSync(
    path.join(run, "metadata.json"),
    JSON.stringify({
      run_id: runId,
      execution_state: "completed",
      evidence_verdict: "passed",
      verdict_semantics_version: 1,
      org_id: "00D000000000001",
      agent_api_name: "BillingAgent",
      bot_version_id: "0X9000000000001",
      tests_count: 1,
      returned_tests_count: 1,
      failed_batches: 0,
      totals: { tests: 1, test_pass: 1, test_fail: 0, evals: 1, ev_pass: 1, ev_fail: 0, errors: 0 },
      release_contract: releaseContract,
    }),
  );
  writeFileSync(
    path.join(run, "manifest.json"),
    JSON.stringify({
      schema_version: 2,
      run_id: runId,
      scope: "suite",
      org_id: "00D000000000001",
      agent_api_name: "BillingAgent",
      bot_version_id: "0X9000000000001",
      release_contract: releaseContract,
      source_snapshot: "spec.source.snapshot.json",
      executed_snapshot: "spec.executed.snapshot.json",
      source_digest: hashEvalSpec(proofSpec),
      executed_digest: hashEvalSpec(proofSpec),
    }),
  );
  writeFileSync(path.join(run, "spec.source.snapshot.json"), JSON.stringify(proofSpec));
  writeFileSync(path.join(run, "spec.executed.snapshot.json"), JSON.stringify(proofSpec));
  writeFileSync(
    path.join(run, "raw.json"),
    JSON.stringify({
      results: [
        {
          id: "release",
          evaluation_results: [{ id: "ok", type: "evaluator.string_assertion", is_pass: true }],
        },
      ],
    }),
  );
  writeFileSync(
    path.join(run, "status.json"),
    JSON.stringify({
      schema_version: 1,
      run_id: runId,
      status: "completed",
      phase: "completed",
      started: "2026-07-30T00:00:00.000Z",
      updated: "2026-07-30T00:00:01.000Z",
      completed: "2026-07-30T00:00:01.000Z",
    }),
  );
  const indexPath = path.join(base, "_index.json");
  let ids: string[] = [];
  try {
    ids = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    // First run has no index yet.
  }
  writeFileSync(indexPath, JSON.stringify([runId, ...ids]));
}

function writeBaselineSource(cwd: string, agent: string): string {
  const baseline = { tests: [{ id: "baseline", steps: [] }] };
  const file = path.join(
    cwd,
    ".pi",
    "state",
    "sf-agentscript",
    "release-contracts",
    `${agent}.generated.eval.json`,
  );
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(baseline));
  return hashEvalSpec(baseline);
}
