/* SPDX-License-Identifier: Apache-2.0 */
/** Local-source topology discovery for transitive connected-agent readiness. */

import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { inspectFile } from "../inspect.ts";
import type { TargetRuntimeReadiness, TargetStatus } from "./types.ts";

export const MAX_CONNECTED_AGENT_DEPTH = 5;
const MAX_AGENT_FILES = 500;

export interface ConnectedReadinessNode {
  agent_name: string;
  depth: number;
  local_source: boolean;
  path: string[];
  source_path?: string;
  status?: TargetStatus;
  runtime_readiness?: TargetRuntimeReadiness;
  detail?: string;
}

export interface ConnectedReadinessEdge {
  from: string;
  to: string;
  depth: number;
  target: string;
}

export interface ConnectedReadinessIssue {
  kind: "source_unavailable" | "cycle" | "depth_limit" | "missing" | "runtime_not_ready";
  agent_name: string;
  depth: number;
  path: string[];
  detail: string;
}

export interface ConnectedAgentReadinessGraph {
  root_agent: string;
  max_depth: number;
  nodes: ConnectedReadinessNode[];
  edges: ConnectedReadinessEdge[];
  issues: ConnectedReadinessIssue[];
}

export async function discoverConnectedAgentGraph(
  rootAgentFile: string,
  maxDepth = MAX_CONNECTED_AGENT_DEPTH,
): Promise<ConnectedAgentReadinessGraph> {
  const files = await projectAgentFiles(rootAgentFile);
  const inspected = await Promise.all(
    files.map(async (file) => ({ file, inspect: await inspectFile(file) })),
  );
  const sources = new Map<
    string,
    { file: string; inspect: Awaited<ReturnType<typeof inspectFile>> }
  >();
  for (const item of inspected) {
    if (!item.inspect.ok) continue;
    const name = item.inspect.components?.config?.agent_name;
    if (typeof name === "string" && name) sources.set(name, item);
  }
  const rootInspect = inspected.find(
    (item) => path.resolve(item.file) === path.resolve(rootAgentFile),
  );
  const rootName =
    (rootInspect?.inspect.components?.config?.agent_name as string | undefined) ??
    path.basename(rootAgentFile, ".agent");
  const nodes = new Map<string, ConnectedReadinessNode>();
  const edges: ConnectedReadinessEdge[] = [];
  const issues: ConnectedReadinessIssue[] = [];
  const visitedDepth = new Map<string, number>();

  const visit = async (agentName: string, depth: number, ancestry: string[]): Promise<void> => {
    const source = sources.get(agentName);
    const existing = nodes.get(agentName);
    if (!existing || depth < existing.depth) {
      nodes.set(agentName, {
        agent_name: agentName,
        depth,
        local_source: !!source,
        path: ancestry,
        ...(source ? { source_path: source.file } : {}),
      });
    }
    if (!source) return;
    const previousDepth = visitedDepth.get(agentName);
    if (previousDepth !== undefined && previousDepth <= depth) return;
    visitedDepth.set(agentName, depth);
    const connected = [...(source.inspect.components?.connected_subagents ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    for (const target of connected) {
      if (!target.target) continue;
      const targetName = target.target.split("://", 2)[1];
      if (!targetName) continue;
      const nextDepth = depth + 1;
      edges.push({ from: agentName, to: targetName, depth: nextDepth, target: target.target });
      const nextPath = [...ancestry, targetName];
      if (ancestry.includes(targetName)) {
        issues.push({
          kind: "cycle",
          agent_name: targetName,
          depth: nextDepth,
          path: nextPath,
          detail: `Connected-agent cycle detected: ${nextPath.join(" → ")}.`,
        });
        continue;
      }
      if (nextDepth > maxDepth) {
        issues.push({
          kind: "depth_limit",
          agent_name: targetName,
          depth: nextDepth,
          path: nextPath,
          detail: `Connected-agent traversal stopped at depth ${maxDepth}.`,
        });
        continue;
      }
      const targetSource = sources.get(targetName);
      if (!targetSource) {
        nodes.set(targetName, {
          agent_name: targetName,
          depth: nextDepth,
          local_source: false,
          path: nextPath,
        });
        issues.push({
          kind: "source_unavailable",
          agent_name: targetName,
          depth: nextDepth,
          path: nextPath,
          detail: `Connected agent '${targetName}' has no Agent Script source in this local project; descendants are unverifiable.`,
        });
        continue;
      }
      await visit(targetName, nextDepth, nextPath);
    }
  };

  await visit(rootName, 0, [rootName]);
  return {
    root_agent: rootName,
    max_depth: maxDepth,
    nodes: [...nodes.values()].sort(
      (a, b) => a.depth - b.depth || a.agent_name.localeCompare(b.agent_name),
    ),
    edges: edges.sort(
      (a, b) => a.depth - b.depth || a.from.localeCompare(b.from) || a.to.localeCompare(b.to),
    ),
    issues,
  };
}

async function projectAgentFiles(rootAgentFile: string): Promise<string[]> {
  const projectRoot = await findProjectRoot(path.dirname(rootAgentFile));
  const files = new Set<string>([path.resolve(rootAgentFile)]);
  if (!projectRoot) return [...files];
  try {
    const project = JSON.parse(
      await readFile(path.join(projectRoot, "sfdx-project.json"), "utf8"),
    ) as {
      packageDirectories?: Array<{ path?: string }>;
    };
    for (const pkg of project.packageDirectories ?? []) {
      if (!pkg.path) continue;
      const bundles = path.join(projectRoot, pkg.path, "main", "default", "aiAuthoringBundles");
      await collectAgentFiles(bundles, files);
      if (files.size >= MAX_AGENT_FILES) break;
    }
  } catch {
    return [...files];
  }
  return [...files].sort();
}

async function findProjectRoot(start: string): Promise<string | undefined> {
  let current = path.resolve(start);
  while (true) {
    try {
      await access(path.join(current, "sfdx-project.json"));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) return undefined;
      current = parent;
    }
  }
}

async function collectAgentFiles(dir: string, files: Set<string>): Promise<void> {
  if (files.size >= MAX_AGENT_FILES) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (files.size >= MAX_AGENT_FILES) return;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await collectAgentFiles(full, files);
    else if (entry.isFile() && entry.name.endsWith(".agent")) files.add(path.resolve(full));
  }
}
