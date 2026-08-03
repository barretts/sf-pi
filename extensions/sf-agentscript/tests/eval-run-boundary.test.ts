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
    callEval: vi.fn(async (_conn, tests: Array<{ id?: string; steps?: unknown[] }>) => {
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
          results: tests.map((test) => ({
            id: test.id,
            evaluation_results: (test.steps ?? [])
              .filter(
                (step): step is { id?: string; type: string } =>
                  !!step &&
                  typeof step === "object" &&
                  typeof (step as { type?: unknown }).type === "string" &&
                  (step as { type: string }).type.startsWith("evaluator."),
              )
              .map((step) => ({ id: step.id, type: step.type, is_pass: true })),
          })),
        },
        endpoint: "",
      };
    }),
  };
});

import { readFailures, runEval } from "../lib/eval/orchestrator.ts";
import { createTimingCollector } from "../lib/timings.ts";

let base: string;
const conn = {
  instanceUrl: "https://example.invalid",
  identity: async () => ({ user_id: "005000000000001", organization_id: "00D000000000001" }),
};

async function listRelativeFiles(dir: string, prefix = ""): Promise<string[]> {
  const output: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    if (entry.isDirectory())
      output.push(...(await listRelativeFiles(path.join(dir, entry.name), relative)));
    else output.push(relative);
  }
  return output.sort();
}

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

  it("keeps timed and untimed run results and persisted evidence semantically equivalent", async () => {
    const spec = {
      tests: Array.from({ length: 6 }, (_, index) => ({
        id: `scenario-${index + 1}`,
        steps: [
          {
            type: "agent.create_session",
            id: `session-${index + 1}`,
            agent_id: "0Xx",
            agent_version_id: "0X9",
          },
          { type: "agent.send_message", id: `turn-${index + 1}`, utterance: "hello" },
          {
            type: "evaluator.string_assertion",
            id: `ok-${index + 1}`,
            actual: `{turn-${index + 1}.response}`,
            expected: "hello",
          },
        ],
      })),
    };

    const run = async (runId: string, withTimings: boolean) => {
      expectedRunDir = path.join(base, runId);
      const result = await runEval({
        conn: conn as never,
        targetOrg: "test-org",
        cwd: base,
        runBase: base,
        runId,
        tracesMode: "off",
        spec,
        ...(withTimings ? { timings: createTimingCollector() } : {}),
      });
      const readJson = async (name: string) =>
        JSON.parse(await readFile(path.join(base, runId, name), "utf8")) as Record<string, unknown>;
      return {
        result,
        files: await listRelativeFiles(path.join(base, runId)),
        metadata: await readJson("metadata.json"),
        manifest: await readJson("manifest.json"),
        status: await readJson("status.json"),
        source: await readJson("spec.source.snapshot.json"),
        executed: await readJson("spec.executed.snapshot.json"),
        raw: await readJson("raw.json"),
        evidence: await readJson("evidence.json"),
      };
    };

    const untimed = await run("run-untimed", false);
    const timed = await run("run-timed", true);
    const withoutKeys = (value: Record<string, unknown>, keys: string[]) =>
      Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
    const stableMetadata = (value: Record<string, unknown>) =>
      withoutKeys(value, ["run_id", "started", "completed", "duration_ms"]);
    const stableManifest = (value: Record<string, unknown>) =>
      withoutKeys(value, ["run_id", "created"]);
    const stableStatus = (value: Record<string, unknown>) =>
      withoutKeys(value, ["run_id", "started", "updated", "completed"]);
    const stableResult = (value: typeof timed.result) => ({
      ...value,
      run_id: "<run>",
      run_dir: "<run-dir>",
      metadata: stableMetadata(value.metadata as unknown as Record<string, unknown>),
    });

    expect(stableResult(timed.result)).toEqual(stableResult(untimed.result));
    expect(timed.files).toEqual(untimed.files);
    expect(stableMetadata(timed.metadata)).toEqual(stableMetadata(untimed.metadata));
    expect(stableManifest(timed.manifest)).toEqual(stableManifest(untimed.manifest));
    expect(stableStatus(timed.status)).toEqual(stableStatus(untimed.status));
    expect(timed.source).toEqual(untimed.source);
    expect(timed.executed).toEqual(untimed.executed);
    expect(timed.raw).toEqual(untimed.raw);
    expect(timed.evidence).toEqual(untimed.evidence);
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
