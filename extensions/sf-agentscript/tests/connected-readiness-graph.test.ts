/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { checkConnectedAgentReadinessGraph } from "../lib/preflight/index.ts";

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "sf-agentscript-connected-graph-"));
  await writeFile(
    path.join(root, "sfdx-project.json"),
    JSON.stringify({ packageDirectories: [{ path: "force-app", default: true }] }),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function writeAgent(name: string, target?: string): Promise<string> {
  const dir = path.join(root, "force-app", "main", "default", "aiAuthoringBundles", name);
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, `${name}.agent`);
  const connected = target
    ? `\nconnected_subagent next:\n    target: "agent://${target}"\n    description: "Next"\n`
    : "";
  await writeFile(
    file,
    `config:\n    agent_name: "${name}"\nsystem:\n    instructions: "test"\n${connected}\nstart_agent main:\n    description: "Entry"\n`,
  );
  return file;
}

function fakeConn() {
  return {
    request: vi.fn(async (options: { url: string }) => {
      const url = decodeURIComponent(options.url);
      if (!url.includes("FROM BotDefinition")) return { records: [] };
      return {
        records: [
          {
            DeveloperName: "AgentB",
            BotVersions: { records: [{ DeveloperName: "v1", Status: "Active" }] },
          },
          { DeveloperName: "AgentC", BotVersions: { records: [] } },
        ],
      };
    }),
  };
}

describe("connected-agent readiness graph", () => {
  test("traverses local sources, annotates org readiness, and stops cycles", async () => {
    const agentA = await writeAgent("AgentA", "AgentB");
    await writeAgent("AgentB", "AgentC");
    await writeAgent("AgentC", "AgentA");

    const graph = await checkConnectedAgentReadinessGraph(fakeConn() as never, agentA);

    expect(graph.max_depth).toBe(5);
    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ agent_name: "AgentA", depth: 0, local_source: true }),
        expect.objectContaining({
          agent_name: "AgentB",
          depth: 1,
          status: "ok",
          runtime_readiness: "ready",
        }),
        expect.objectContaining({
          agent_name: "AgentC",
          depth: 2,
          status: "ok",
          runtime_readiness: "not_ready",
        }),
      ]),
    );
    expect(graph.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "runtime_not_ready", agent_name: "AgentC", depth: 2 }),
        expect.objectContaining({ kind: "cycle", agent_name: "AgentA", depth: 3 }),
      ]),
    );
  });

  test("marks remote-only descendants as unverifiable topology", async () => {
    const agentA = await writeAgent("AgentA", "RemoteAgent");
    const graph = await checkConnectedAgentReadinessGraph(fakeConn() as never, agentA);
    expect(graph.nodes).toContainEqual(
      expect.objectContaining({
        agent_name: "RemoteAgent",
        depth: 1,
        local_source: false,
      }),
    );
    expect(graph.issues).toContainEqual(
      expect.objectContaining({ kind: "source_unavailable", agent_name: "RemoteAgent" }),
    );
  });
});
