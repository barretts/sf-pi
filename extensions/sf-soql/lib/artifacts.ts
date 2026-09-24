/* SPDX-License-Identifier: Apache-2.0 */
/** Artifact persistence for SOQL runs, plans, schema, and flattened results. */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import {
  assertSoqlArtifactLease,
  type SoqlArtifactLease,
  type SoqlArtifactPlan,
} from "../../../lib/common/sf-soql-artifact-plan/store.ts";
import type { SoqlArtifact } from "./types.ts";
import type { FlattenedRows } from "./flattener.ts";
import { toCsv } from "./flattener.ts";

const ROOT = globalAgentPath("sf-pi", "sf-soql");

/** This uses the same captured root as the writer and makes no local effect. */
export function planSoqlRunBundle(): SoqlArtifactPlan {
  const writerCwd = process.cwd();
  const root = path.resolve(writerCwd, ROOT);
  const runDirectory = path.join(root, "runs", `jev-${randomBytes(16).toString("hex")}`);
  const directories: string[] = [];
  let current = runDirectory;
  for (;;) {
    directories.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return {
    version: 1,
    writerCwd,
    root,
    runDirectory,
    directories,
    files: [
      "query.soql",
      "result.raw.json",
      "result.flattened.json",
      "result.flattened.csv",
      "summary.json",
    ].map((name) => path.join(runDirectory, name)),
  };
}

export async function writeSoqlArtifact(
  kind: string,
  filename: string,
  content: unknown,
): Promise<SoqlArtifact> {
  const dir = path.join(ROOT, kind);
  await mkdir(dir, { recursive: true });
  const fullPath = path.join(dir, safeName(filename));
  await writeFile(fullPath, toText(content), "utf8");
  return { path: fullPath, kind };
}

export async function writeRunBundle(
  params: {
    slug: string;
    query: string;
    raw: unknown;
    flattened: FlattenedRows;
    summary: unknown;
  },
  lease?: SoqlArtifactLease,
): Promise<SoqlArtifact[]> {
  if (lease) return writePlannedRunBundle(params, lease);
  const dir = path.join(ROOT, "runs", `${artifactTimestamp()}-${safeName(params.slug)}`);
  await mkdir(dir, { recursive: true });
  const files: Array<[string, string, unknown]> = [
    ["query", "query.soql", params.query],
    ["raw", "result.raw.json", params.raw],
    ["flattened-json", "result.flattened.json", params.flattened.rawRows],
    ["flattened-csv", "result.flattened.csv", toCsv(params.flattened)],
    ["summary", "summary.json", params.summary],
  ];
  const artifacts: SoqlArtifact[] = [];
  for (const [kind, filename, content] of files) {
    const fullPath = path.join(dir, filename);
    await writeFile(fullPath, toText(content), "utf8");
    artifacts.push({ path: fullPath, kind });
  }
  return artifacts;
}

async function writePlannedRunBundle(
  params: Parameters<typeof writeRunBundle>[0],
  lease: SoqlArtifactLease,
): Promise<SoqlArtifact[]> {
  assertSoqlArtifactLease(lease);
  const plan = lease.prepared.plan;
  if (plan.writerCwd !== process.cwd() || plan.root !== path.resolve(plan.writerCwd, ROOT)) {
    throw new Error("SOQL artifact writer context changed. Execution is blocked.");
  }
  // Recheck external facts before our own mkdir changes their existence.
  await lease.beforeWrite();
  const contents = [
    params.query,
    params.raw,
    params.flattened.rawRows,
    toCsv(params.flattened),
    params.summary,
  ];
  const kinds = ["query", "raw", "flattened-json", "flattened-csv", "summary"];
  const artifacts: SoqlArtifact[] = [];
  try {
    for (const directory of plan.directories) {
      lease.check();
      if (directory === plan.runDirectory) {
        await mkdir(directory, { mode: 0o700 });
      } else {
        try {
          await mkdir(directory, { mode: 0o700 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          lease.check();
          if (!(await stat(directory)).isDirectory()) throw error;
        }
      }
      lease.check();
    }
    for (let i = 0; i < plan.files.length; i++) {
      lease.check();
      await writeFile(plan.files[i], toText(contents[i]), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      lease.check();
      artifacts.push({ path: plan.files[i], kind: kinds[i] });
    }
    return artifacts;
  } catch {
    // Preserve partial owned output. Never remove or overwrite another path.
    throw new Error(
      "SOQL artifact write failed. Partial output can remain in the planned directory.",
    );
  }
}

export function artifactTimestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function safeName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function toText(content: unknown): string {
  return typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
}
