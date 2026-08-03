/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverEvalStudio } from "../lib/eval-studio/discovery.ts";

const dirs: string[] = [];
async function project(): Promise<string> {
  const cwd = await mkdtemp(path.join(tmpdir(), "eval-studio-discovery-"));
  dirs.push(cwd);
  await writeFile(
    path.join(cwd, "sfdx-project.json"),
    JSON.stringify({ packageDirectories: [{ path: "force-app" }] }),
  );
  return cwd;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function writeSuite(cwd: string, name: string, scenario = "scenario"): Promise<string> {
  const file = path.join(cwd, "tests", "agentforce", name);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    JSON.stringify({
      tests: [
        {
          id: scenario,
          steps: [
            { type: "agent.create_session", id: "session" },
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
    }),
  );
  return file;
}

describe("Eval Studio local discovery", () => {
  it("discovers designated/additional/unassigned suites without Salesforce calls", async () => {
    const cwd = await project();
    await writeSuite(cwd, "Demo_Agent.eval.json");
    await writeSuite(cwd, "Demo_Agent.safety.eval.json", "safety");
    await writeSuite(cwd, "misc.eval-spec.json", "misc");

    const inventory = await discoverEvalStudio(cwd);
    expect(
      inventory.suites.map((suite) => [suite.display_name, suite.agent_api_name, suite.designated]),
    ).toEqual([
      ["Demo_Agent", "Demo_Agent", true],
      ["safety", "Demo_Agent", false],
      ["misc.eval-spec", undefined, false],
    ]);
  });

  it("merges branch Suite pointers with configured local Agent identity", async () => {
    const cwd = await project();
    const agentFile = path.join(cwd, "force-app", "agents", "Demo.agent");
    await mkdir(path.dirname(agentFile), { recursive: true });
    await writeFile(agentFile, 'config:\n    agent_name: "Demo_Agent"\n');
    const specPath = await writeSuite(cwd, "branch-only.json");

    const inventory = await discoverEvalStudio(cwd, {
      branch_specs: [{ spec_path: specPath, agent_file: agentFile }],
    });
    const suite = inventory.suites.find((candidate) => candidate.path === specPath);
    expect(suite).toMatchObject({ agent_api_name: "Demo_Agent" });
    expect(suite?.agent_source_paths).toContain(agentFile);
  });

  it("surfaces canonical filename versus branch Agent identity conflicts", async () => {
    const cwd = await project();
    const specPath = await writeSuite(cwd, "AgentA.eval.json");
    const agentFile = path.join(cwd, "force-app", "agents", "AgentB.agent");
    await mkdir(path.dirname(agentFile), { recursive: true });
    await writeFile(agentFile, 'config:\n    agent_name: "AgentB"\n');

    const inventory = await discoverEvalStudio(cwd, {
      branch_specs: [{ spec_path: specPath, agent_file: agentFile }],
    });
    expect(inventory.suites[0]).toMatchObject({
      agent_api_name: "AgentA",
      canonical_agent_api_name: "AgentA",
      identity_conflict: expect.stringContaining("AgentB"),
    });
  });

  it("finds runs outside the 50-entry convenience index and classifies corrupt artifacts", async () => {
    const cwd = await project();
    const suitePath = await writeSuite(cwd, "Demo_Agent.eval.json");
    const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
    await mkdir(base, { recursive: true });
    await writeFile(path.join(base, "_index.json"), JSON.stringify([]));
    for (let i = 0; i < 55; i++) {
      const runId = `run-${String(i).padStart(2, "0")}`;
      const runDir = path.join(base, runId);
      await mkdir(runDir);
      await writeFile(
        path.join(runDir, "manifest.json"),
        JSON.stringify({
          schema_version: 2,
          run_id: runId,
          created: `2026-07-30T00:${String(i).padStart(2, "0")}:00.000Z`,
          scope: "suite",
          spec_path: path.relative(cwd, suitePath),
          org: "sandbox",
          org_id: "00D000000000001",
          agent_api_name: "Demo_Agent",
          source_digest: "digest",
          executed_digest: "digest",
          source_snapshot: "spec.source.snapshot.json",
          executed_snapshot: "spec.executed.snapshot.json",
          expected: { scenarios: [] },
        }),
      );
      await writeFile(
        path.join(runDir, "metadata.json"),
        JSON.stringify({
          run_id: runId,
          started: "2026-07-30T00:00:00.000Z",
          completed: "2026-07-30T00:00:01.000Z",
          execution_state: "completed",
          evidence_verdict: "passed",
          totals: {},
        }),
      );
    }
    await mkdir(path.join(base, "corrupt"));
    await writeFile(path.join(base, "corrupt", "manifest.json"), "{");

    const inventory = await discoverEvalStudio(cwd);
    expect(inventory.suites[0]?.runs).toHaveLength(55);
    expect(inventory.unassigned_runs).toContainEqual(
      expect.objectContaining({ run_id: "corrupt", classification: "unavailable" }),
    );
  });
});
