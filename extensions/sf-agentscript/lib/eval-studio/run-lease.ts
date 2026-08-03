/* SPDX-License-Identifier: Apache-2.0 */
/** Cross-process lease for the single Studio-owned Run allowed per project. */

import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { defaultRunBase, writeRunStatus } from "../eval/persist.ts";

interface LeaseArtifact {
  schema_version: 1;
  owner_pid: number;
  owner_token: string;
  run_id: string;
  acquired: string;
}

export interface StudioRunLease {
  run_id: string;
  owner_token: string;
  release(): Promise<void>;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function readLease(file: string): Promise<LeaseArtifact | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as LeaseArtifact;
  } catch {
    return undefined;
  }
}

async function markInterrupted(base: string, lease: LeaseArtifact): Promise<void> {
  let runDirs = [path.join(base, lease.run_id)];
  if (lease.run_id.startsWith("release-contract-")) {
    try {
      const names = (await readdir(base, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
      const releaseDirs: string[] = [];
      for (const name of names) {
        const candidate = path.join(base, name);
        try {
          const manifest = JSON.parse(
            await readFile(path.join(candidate, "manifest.json"), "utf8"),
          ) as {
            created?: string;
            release_contract?: unknown;
            coordinator?: { kind?: string; owner_token?: string };
          };
          if (
            manifest.release_contract &&
            manifest.coordinator?.kind === "studio" &&
            manifest.coordinator.owner_token === lease.owner_token &&
            typeof manifest.created === "string" &&
            manifest.created >= lease.acquired
          ) {
            releaseDirs.push(candidate);
          }
        } catch {
          // Ignore unrelated or incomplete Run directories.
        }
      }
      runDirs = releaseDirs;
    } catch {
      runDirs = [];
    }
  }

  for (const runDir of runDirs) {
    let status: Record<string, unknown>;
    try {
      status = JSON.parse(await readFile(path.join(runDir, "status.json"), "utf8"));
    } catch {
      continue;
    }
    if (status.status !== "running") continue;
    const now = new Date().toISOString();
    await writeRunStatus(runDir, {
      ...(status as unknown as import("../eval/persist.ts").EvalRunStatusArtifact),
      schema_version: 1,
      run_id: path.basename(runDir),
      status: "interrupted",
      phase: "owner_lost",
      started: typeof status.started === "string" ? status.started : lease.acquired,
      updated: now,
      completed: now,
      error: { message: "Studio Run owner process is no longer available." },
    });
  }
}

export async function acquireStudioRunLease(cwd: string, runId: string): Promise<StudioRunLease> {
  const base = defaultRunBase(cwd);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const file = path.join(base, "_studio-lease.json");
  const token = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const artifact: LeaseArtifact = {
    schema_version: 1,
    owner_pid: process.pid,
    owner_token: token,
    run_id: runId,
    acquired: new Date().toISOString(),
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(file, `${JSON.stringify(artifact, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "wx",
      });
      return {
        run_id: runId,
        owner_token: token,
        release: async () => {
          const current = await readLease(file);
          if (current?.owner_token === token) await rm(file, { force: true });
        },
      };
    } catch (error) {
      const current = await readLease(file);
      if (current && processAlive(current.owner_pid)) {
        throw new Error(`Studio Run '${current.run_id}' is already active in this project.`, {
          cause: error,
        });
      }
      if (current) await markInterrupted(base, current);
      await rm(file, { force: true });
      if (attempt === 1) throw error;
    }
  }
  throw new Error("Unable to acquire the Eval Studio Run lease.");
}
