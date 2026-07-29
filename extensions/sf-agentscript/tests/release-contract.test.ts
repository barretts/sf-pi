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

    writeRun(cwd, "baseline-run", {
      kind: "generated_baseline",
      spec_digest: "baseline-digest",
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });
    writeRun(cwd, "designated-run", {
      kind: "designated",
      spec_digest: hashEvalSpec(designated),
      baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
    });

    const result = await evaluateActivationEvidence({
      cwd,
      orgId: "00D000000000001",
      agentApiName: agent,
      botVersionId: "0X9000000000001",
    });

    expect(result).toMatchObject({ proceed: true, required: ["generated_baseline", "designated"] });
    expect(result.evidence).toHaveLength(2);
  });

  it("rejects stale designated evidence when the current suite changes", async () => {
    const cwd = tempCwd();
    const agent = "BillingAgent";
    const designatedPath = path.join(cwd, "tests", "agentforce", `${agent}.eval.json`);
    mkdirSync(path.dirname(designatedPath), { recursive: true });
    writeFileSync(designatedPath, JSON.stringify({ tests: [{ id: "new", steps: [] }] }));
    writeRun(cwd, "baseline-run", {
      kind: "generated_baseline",
      spec_digest: "baseline-digest",
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
  writeFileSync(
    path.join(run, "metadata.json"),
    JSON.stringify({
      run_id: runId,
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
  const indexPath = path.join(base, "_index.json");
  let ids: string[] = [];
  try {
    ids = JSON.parse(readFileSync(indexPath, "utf8"));
  } catch {
    // First run has no index yet.
  }
  writeFileSync(indexPath, JSON.stringify([runId, ...ids]));
}
