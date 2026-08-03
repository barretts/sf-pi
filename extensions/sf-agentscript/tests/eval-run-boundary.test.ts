/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let expectedRunDir = "";
let observedStartArtifacts = false;

vi.mock("../lib/eval/eval-client.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/eval/eval-client.ts")>();
  return {
    ...actual,
    callEval: vi.fn(async () => {
      const names = await readdir(expectedRunDir);
      observedStartArtifacts = [
        "manifest.json",
        "spec.source.snapshot.json",
        "spec.executed.snapshot.json",
        "status.json",
      ].every((name) => names.includes(name));
      return {
        status: 200,
        body: {
          results: [
            {
              id: "scenario",
              evaluation_results: [{ id: "ok", type: "evaluator.string_assertion", is_pass: true }],
            },
          ],
        },
        endpoint: "",
      };
    }),
  };
});

import { readFailures, runEval } from "../lib/eval/orchestrator.ts";

let base: string;
const conn = {
  instanceUrl: "https://example.invalid",
  identity: async () => ({ user_id: "005000000000001", organization_id: "00D000000000001" }),
};

beforeEach(async () => {
  base = await mkdtemp(path.join(tmpdir(), "sf-agentscript-boundary-"));
  expectedRunDir = path.join(base, "run-fixed");
  observedStartArtifacts = false;
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("eval Run boundary", () => {
  it("creates no Run for failed local preflight", async () => {
    await expect(
      runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId: "invalid",
        tracesMode: "off",
        spec: { tests: [] },
      }),
    ).rejects.toThrow("no tests");
    expect(await readdir(base)).toEqual([]);
  });

  it("persists immutable source/executed snapshots and manifest before the first API call", async () => {
    const source = {
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
              id: "ok",
              actual: "{turn.response}",
              expected: "hello",
            },
          ],
        },
      ],
    };
    const result = await runEval({
      conn: conn as never,
      targetOrg: "test-org",
      cwd: base,
      runBase: base,
      runId: "run-fixed",
      tracesMode: "off",
      spec: source,
      specPath: "tests/agentforce/Demo.eval.json",
    });

    expect(observedStartArtifacts).toBe(true);
    expect(
      JSON.parse(await readFile(path.join(expectedRunDir, "spec.source.snapshot.json"), "utf8")),
    ).toEqual(source);
    const manifest = JSON.parse(await readFile(path.join(expectedRunDir, "manifest.json"), "utf8"));
    expect(manifest).toMatchObject({
      schema_version: 2,
      run_id: "run-fixed",
      scope: "suite",
      spec_path: "tests/agentforce/Demo.eval.json",
      expected: { scenarios: [{ id: "scenario", evaluator_ids: ["ok"] }] },
    });
    expect(result.metadata).toMatchObject({
      execution_state: "completed",
      evidence_verdict: "passed",
      verdict_semantics_version: 1,
    });
    expect(await readFailures(base, "run-fixed", base)).toEqual([]);
  });
});
