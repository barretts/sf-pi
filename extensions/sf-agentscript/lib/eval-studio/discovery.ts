/* SPDX-License-Identifier: Apache-2.0 */
/** Explicit local inventory discovery for Agent Script Eval Studio. */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { detectProject } from "../../../../lib/common/sf-environment/detect.ts";
import { defaultRunBase, evalProjectRoot } from "../eval/persist.ts";
import { hashEvalSpec } from "../release-contract.ts";
import { readEvalRunArtifact } from "./artifact-reader.ts";
import { projectEvalSuite } from "./projectability.ts";
import { redactStudioValue } from "./redaction.ts";
import type { StudioInventory, StudioRunSummary, StudioSuiteSummary } from "./types.ts";

const CANONICAL_SUITE_RE = /^([A-Za-z][A-Za-z0-9_]*)(?:\.([a-z0-9][a-z0-9-]*))?\.eval\.json$/;

interface LocalAgentSource {
  path: string;
  file_name: string;
  configured_name?: string;
}

async function fileNames(dir: string): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function discoverAgentSources(cwd: string): Promise<LocalAgentSource[]> {
  const project = detectProject(cwd);
  const roots = project.packageDirectories?.map((entry) => path.resolve(cwd, entry.path)) ?? [];
  const files: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 8 || files.length >= 500) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= 500) break;
      const candidate = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(candidate, depth + 1);
      else if (entry.isFile() && entry.name.endsWith(".agent")) files.push(candidate);
    }
  };
  await Promise.all(roots.map((root) => walk(root, 0)));
  return await Promise.all(
    files.map(async (file) => {
      const source = await readFile(file, "utf8");
      const configured = /\bagent_name\s*:\s*["']([^"']+)["']/.exec(source)?.[1];
      return {
        path: file,
        file_name: path.basename(file, ".agent"),
        ...(configured ? { configured_name: configured } : {}),
      };
    }),
  );
}

async function runDirs(base: string): Promise<string[]> {
  try {
    const names = (await readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort()
      .reverse();
    let indexed: string[] = [];
    try {
      const parsed = JSON.parse(await readFile(path.join(base, "_index.json"), "utf8"));
      if (Array.isArray(parsed))
        indexed = parsed.filter((value): value is string => typeof value === "string");
    } catch {
      // The rebuildable display index is optional.
    }
    const existing = new Set(names);
    return [
      ...new Set([...indexed.filter((name) => existing.has(name)), ...names.slice(0, 250)]),
    ].map((name) => path.join(base, name));
  } catch {
    return [];
  }
}

function suiteIdentity(fileName: string): {
  agentApiName?: string;
  displayName: string;
  designated: boolean;
} {
  const match = CANONICAL_SUITE_RE.exec(fileName);
  if (!match) {
    return { displayName: fileName.replace(/\.json$/i, ""), designated: false };
  }
  return {
    agentApiName: match[1],
    displayName: match[2] ?? match[1],
    designated: !match[2],
  };
}

function resolveSpecPath(cwd: string, candidate: string | undefined): string | undefined {
  if (!candidate) return undefined;
  return path.normalize(path.isAbsolute(candidate) ? candidate : path.resolve(cwd, candidate));
}

export async function discoverEvalStudio(
  cwd: string,
  options: { branch_specs?: Array<{ spec_path: string; agent_file?: string }> } = {},
): Promise<StudioInventory> {
  cwd = evalProjectRoot(cwd);
  const issues: string[] = [];
  const suiteDir = path.join(cwd, "tests", "agentforce");
  const suites: StudioSuiteSummary[] = [];

  for (const name of await fileNames(suiteDir)) {
    if (!name.endsWith(".json")) continue;
    const fullPath = path.join(suiteDir, name);
    try {
      const raw = await readFile(fullPath, "utf8");
      const spec = JSON.parse(raw) as unknown;
      const identity = suiteIdentity(name);
      const info = await stat(fullPath);
      suites.push({
        id: path.relative(cwd, fullPath),
        path: fullPath,
        agent_api_name: identity.agentApiName,
        canonical_agent_api_name: identity.agentApiName,
        display_name: identity.displayName,
        designated: identity.designated,
        source_digest: hashEvalSpec(spec),
        modified_at: info.mtime.toISOString(),
        source_preview: JSON.stringify(redactStudioValue(spec), null, 2).slice(0, 6000),
        projection: projectEvalSuite(spec),
        runs: [],
      });
    } catch (error) {
      issues.push(
        `${path.relative(cwd, fullPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const pointer of options.branch_specs ?? []) {
    const fullPath = path.isAbsolute(pointer.spec_path)
      ? pointer.spec_path
      : path.resolve(cwd, pointer.spec_path);
    const existingSuite = suites.find(
      (suite) => path.normalize(suite.path) === path.normalize(fullPath),
    );
    if (existingSuite) {
      if (pointer.agent_file) {
        try {
          const agentPath = path.isAbsolute(pointer.agent_file)
            ? pointer.agent_file
            : path.resolve(cwd, pointer.agent_file);
          const source = await readFile(agentPath, "utf8");
          const configured = /\bagent_name\s*:\s*["']([^"']+)["']/.exec(source)?.[1];
          if (
            configured &&
            existingSuite.canonical_agent_api_name &&
            configured !== existingSuite.canonical_agent_api_name
          ) {
            existingSuite.identity_conflict =
              `Canonical Suite Agent '${existingSuite.canonical_agent_api_name}' conflicts with ` +
              `branch Agent '${configured}'.`;
            issues.push(existingSuite.identity_conflict);
          } else if (configured && !existingSuite.agent_api_name) {
            existingSuite.agent_api_name = configured;
          }
        } catch {
          // Keep the filename-derived identity when the branch Agent pointer is stale.
        }
      }
      continue;
    }
    try {
      const spec = JSON.parse(await readFile(fullPath, "utf8")) as unknown;
      const info = await stat(fullPath);
      let agentApiName: string | undefined;
      if (pointer.agent_file) {
        const agentPath = path.isAbsolute(pointer.agent_file)
          ? pointer.agent_file
          : path.resolve(cwd, pointer.agent_file);
        const source = await readFile(agentPath, "utf8");
        agentApiName = /\bagent_name\s*:\s*["']([^"']+)["']/.exec(source)?.[1];
      }
      suites.push({
        id: `branch:${path.relative(cwd, fullPath)}`,
        path: fullPath,
        agent_api_name: agentApiName,
        display_name: path.basename(fullPath).replace(/\.json$/i, ""),
        designated: false,
        source_digest: hashEvalSpec(spec),
        modified_at: info.mtime.toISOString(),
        source_preview: JSON.stringify(redactStudioValue(spec), null, 2).slice(0, 6000),
        projection: projectEvalSuite(spec),
        runs: [],
      });
    } catch (error) {
      issues.push(
        `Branch EvalSpec ${pointer.spec_path}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const generatedDir = path.join(cwd, ".pi", "state", "sf-agentscript", "release-contracts");
  for (const name of await fileNames(generatedDir)) {
    const match = /^(.+)\.generated\.eval\.json$/.exec(name);
    if (!match) continue;
    const fullPath = path.join(generatedDir, name);
    try {
      const spec = JSON.parse(await readFile(fullPath, "utf8")) as unknown;
      const info = await stat(fullPath);
      suites.push({
        id: `generated:${match[1]}`,
        path: fullPath,
        agent_api_name: match[1],
        display_name: "Generated Baseline",
        designated: false,
        generated: true,
        source_digest: hashEvalSpec(spec),
        modified_at: info.mtime.toISOString(),
        source_preview: JSON.stringify(redactStudioValue(spec), null, 2).slice(0, 6000),
        projection: projectEvalSuite(spec),
        runs: [],
      });
    } catch (error) {
      issues.push(
        `${path.relative(cwd, fullPath)}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  const agentSources = await discoverAgentSources(cwd);
  for (const suite of suites) {
    if (!suite.agent_api_name) continue;
    const matches = agentSources.filter(
      (source) =>
        source.configured_name === suite.agent_api_name ||
        source.file_name === suite.agent_api_name,
    );
    suite.agent_source_paths = matches.map((source) => source.path);
    const conflicts = matches.filter(
      (source) => source.configured_name && source.configured_name !== suite.agent_api_name,
    );
    if (matches.length > 1 || conflicts.length > 0) {
      suite.identity_conflict =
        conflicts.length > 0
          ? `Suite Agent '${suite.agent_api_name}' conflicts with configured Agent '${conflicts[0].configured_name}'.`
          : `Multiple local Agent sources match '${suite.agent_api_name}'.`;
      issues.push(suite.identity_conflict);
    }
  }

  const unassignedRuns: StudioRunSummary[] = [];
  for (const runDir of await runDirs(defaultRunBase(cwd))) {
    const artifact = await readEvalRunArtifact(runDir, { source: true, evidence: true });
    const summary = artifact.summary;
    const resolved = resolveSpecPath(cwd, summary.suite_path);
    let matches = resolved ? suites.filter((suite) => path.normalize(suite.path) === resolved) : [];
    if (matches.length === 0 && artifact.manifest?.source_digest && summary.agent_api_name) {
      matches = suites.filter(
        (suite) =>
          suite.agent_api_name === summary.agent_api_name &&
          suite.source_digest === artifact.manifest?.source_digest,
      );
    }
    if (matches.length === 1 && summary.classification !== "ad_hoc") {
      const suite = matches[0];
      suite.runs.push({
        ...summary,
        stale_source: artifact.manifest
          ? artifact.manifest.source_digest !== suite.source_digest
          : undefined,
      });
    } else {
      unassignedRuns.push({
        ...summary,
        classification:
          summary.classification === "current" && matches.length !== 1
            ? "unassigned"
            : summary.classification,
      });
    }
  }

  for (const suite of suites) {
    suite.runs.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
    const latest = suite.runs[0];
    if (latest) {
      const detail = await readEvalRunArtifact(latest.run_dir, { details: true });
      suite.runs[0] = { ...detail.summary, stale_source: latest.stale_source };
    }
  }
  unassignedRuns.sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
  return { suites, unassigned_runs: unassignedRuns, issues };
}

export function renderInventorySummary(inventory: StudioInventory): string {
  const scenarioCount = inventory.suites.reduce(
    (sum, suite) => sum + suite.projection.scenarios.length,
    0,
  );
  const runCount =
    inventory.unassigned_runs.length +
    inventory.suites.reduce((sum, suite) => sum + suite.runs.length, 0);
  return [
    `Agent Script Eval Studio`,
    `Suites: ${inventory.suites.length}`,
    `Scenarios: ${scenarioCount}`,
    `Runs: ${runCount}`,
    ...(inventory.issues.length ? [`Issues: ${inventory.issues.length}`] : []),
  ].join("\n");
}
