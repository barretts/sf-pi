/* SPDX-License-Identifier: Apache-2.0 */
/** Exact-version Agent Script release-eval evidence and activation preflight. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { EvalApiResponse, EvalSpec } from "./eval/types.ts";
import { deriveEvalVerdict, EVAL_VERDICT_SEMANTICS_VERSION } from "./eval/verdict.ts";
import { evalProjectRoot, writeJsonAtomic } from "./eval/persist.ts";

export const AGENT_SCRIPT_RELEASE_BASELINE_ID = "sf-agentscript-generated-baseline-v1";
export type ReleaseContractKind = "generated_baseline" | "designated";

export interface ReleaseContractEvidence {
  run_id: string;
  kind: ReleaseContractKind;
  spec_digest: string;
}

export interface ActivationEvidenceResult {
  proceed: boolean;
  required: ReleaseContractKind[];
  missing: ReleaseContractKind[];
  evidence: ReleaseContractEvidence[];
  designated_spec_path?: string;
  designated_spec_digest?: string;
}

export async function evaluateActivationEvidence(input: {
  cwd: string;
  orgId: string;
  agentApiName: string;
  botVersionId: string;
  releaseSpecPath?: string;
}): Promise<ActivationEvidenceResult> {
  const cwd = evalProjectRoot(input.cwd);
  const requestedDesignatedPath = input.releaseSpecPath
    ? path.resolve(cwd, input.releaseSpecPath)
    : defaultReleaseSpecPath(cwd, input.agentApiName);
  const designatedPath = await existingFile(requestedDesignatedPath);
  const designatedDigest = designatedPath
    ? hashEvalSpec(JSON.parse(await readFile(designatedPath, "utf8")) as EvalSpec)
    : undefined;
  const baselinePath = path.join(
    cwd,
    ".pi",
    "state",
    "sf-agentscript",
    "release-contracts",
    `${input.agentApiName.replace(/[^A-Za-z0-9._-]/g, "_")}.generated.eval.json`,
  );
  const currentBaselinePath = await existingFile(baselinePath);
  const baselineDigest = currentBaselinePath
    ? hashEvalSpec(JSON.parse(await readFile(currentBaselinePath, "utf8")) as EvalSpec)
    : undefined;
  const designatedRequired = !!input.releaseSpecPath || !!designatedPath;
  const required: ReleaseContractKind[] = designatedRequired
    ? ["generated_baseline", "designated"]
    : ["generated_baseline"];
  const metadata = await readReleaseMetadata(
    cwd,
    {
      org_id: input.orgId,
      agent_api_name: input.agentApiName,
      bot_version_id: input.botVersionId,
    },
    required.map((kind) => ({
      kind,
      digest: kind === "generated_baseline" ? baselineDigest : designatedDigest,
    })),
  );
  const evidence: ReleaseContractEvidence[] = [];

  for (const kind of required) {
    const match = metadata.find((candidate) => {
      const contract = candidate.release_contract;
      if (!contract || contract.kind !== kind) return false;
      if (candidate.org_id !== input.orgId) return false;
      if (candidate.agent_api_name !== input.agentApiName) return false;
      if (candidate.bot_version_id !== input.botVersionId) return false;
      if (!isCompletePassingRun(candidate)) return false;
      if (contract.baseline_id !== AGENT_SCRIPT_RELEASE_BASELINE_ID) return false;
      return kind === "generated_baseline"
        ? contract.spec_digest === baselineDigest
        : contract.spec_digest === designatedDigest;
    });
    if (match?.release_contract) {
      evidence.push({
        run_id: match.run_id,
        kind,
        spec_digest: match.release_contract.spec_digest,
      });
    }
  }

  const found = new Set(evidence.map((item) => item.kind));
  const missing = required.filter((kind) => !found.has(kind));
  return {
    proceed: missing.length === 0,
    required,
    missing,
    evidence,
    ...(designatedRequired ? { designated_spec_path: requestedDesignatedPath } : {}),
    ...(designatedDigest ? { designated_spec_digest: designatedDigest } : {}),
  };
}

export function hashEvalSpec(spec: unknown): string {
  return createHash("sha256").update(stableStringify(spec)).digest("hex");
}

export function rewriteReleaseSpecForLatest(spec: EvalSpec): EvalSpec {
  return rewriteValue(spec) as EvalSpec;
}

export function defaultReleaseSpecPath(cwd: string, agentApiName: string): string {
  return path.join(cwd, "tests", "agentforce", `${agentApiName}.eval.json`);
}

interface StoredRunEvidence {
  run_id: string;
  manifest_schema_version: 2;
  scope: "suite";
  org_id: string;
  agent_api_name: string;
  bot_version_id: string;
  release_contract: {
    kind: ReleaseContractKind;
    spec_digest: string;
    baseline_id: string;
    spec_path?: string;
  };
  evidence_verdict?: string;
  verdict_semantics_version?: number;
  execution_state?: string;
  terminal_complete: boolean;
  current_verdict?: string;
  tests_count?: number;
  returned_tests_count?: number;
  failed_batches?: number;
  totals?: { test_fail?: number; errors?: number };
}

async function existingFile(candidate: string): Promise<string | undefined> {
  try {
    await readFile(candidate, "utf8");
    return candidate;
  } catch {
    return undefined;
  }
}

interface ReleaseEvidenceIndexEntry {
  run_id: string;
  org_id: string;
  agent_api_name: string;
  bot_version_id: string;
  kind: ReleaseContractKind;
  spec_digest: string;
  baseline_id: string;
}

interface ReleaseEvidenceIndex {
  schema_version: 1;
  entries: ReleaseEvidenceIndexEntry[];
}

const RELEASE_INDEX_FILE = "_release-evidence.json";
const RELEASE_INDEX_LOCK = "_release-evidence.lock";

async function readStoredRun(base: string, runId: string): Promise<StoredRunEvidence | undefined> {
  try {
    const metadata = JSON.parse(
      await readFile(path.join(base, runId, "metadata.json"), "utf8"),
    ) as Omit<
      StoredRunEvidence,
      | "manifest_schema_version"
      | "scope"
      | "org_id"
      | "agent_api_name"
      | "bot_version_id"
      | "release_contract"
      | "terminal_complete"
      | "current_verdict"
    >;
    const manifest = JSON.parse(
      await readFile(path.join(base, runId, "manifest.json"), "utf8"),
    ) as Partial<StoredRunEvidence> & {
      schema_version?: number;
      source_snapshot?: string;
      executed_snapshot?: string;
      source_digest?: string;
      executed_digest?: string;
    };
    if (
      metadata.run_id !== runId ||
      manifest.run_id !== runId ||
      manifest.schema_version !== 2 ||
      manifest.scope !== "suite" ||
      typeof manifest.org_id !== "string" ||
      typeof manifest.agent_api_name !== "string" ||
      typeof manifest.bot_version_id !== "string" ||
      !manifest.release_contract ||
      typeof manifest.source_digest !== "string" ||
      typeof manifest.executed_digest !== "string"
    ) {
      return undefined;
    }
    const status = JSON.parse(await readFile(path.join(base, runId, "status.json"), "utf8")) as {
      run_id?: string;
      status?: string;
    };
    const [sourceSnapshot, executedSpec, raw] = await Promise.all([
      readFile(
        path.join(base, runId, manifest.source_snapshot ?? "spec.source.snapshot.json"),
        "utf8",
      ),
      readFile(
        path.join(base, runId, manifest.executed_snapshot ?? "spec.executed.snapshot.json"),
        "utf8",
      ),
      readFile(path.join(base, runId, "raw.json"), "utf8"),
    ]);
    const sourceSpec = JSON.parse(sourceSnapshot) as EvalSpec;
    const executedSnapshot = JSON.parse(executedSpec) as EvalSpec;
    if (
      hashEvalSpec(sourceSpec) !== manifest.source_digest ||
      hashEvalSpec(executedSnapshot) !== manifest.executed_digest
    ) {
      return undefined;
    }
    const currentVerdict = deriveEvalVerdict(executedSnapshot, JSON.parse(raw) as EvalApiResponse, {
      failedBatches: metadata.failed_batches,
    }).verdict;
    return {
      ...metadata,
      run_id: runId,
      manifest_schema_version: 2,
      scope: "suite",
      org_id: manifest.org_id,
      agent_api_name: manifest.agent_api_name,
      bot_version_id: manifest.bot_version_id,
      release_contract: manifest.release_contract,
      terminal_complete:
        status.run_id === runId &&
        status.status === "completed" &&
        metadata.execution_state === "completed" &&
        sourceSnapshot.length > 0,
      current_verdict: currentVerdict,
    };
  } catch {
    return undefined;
  }
}

function indexEntry(row: StoredRunEvidence): ReleaseEvidenceIndexEntry {
  return {
    run_id: row.run_id,
    org_id: row.org_id,
    agent_api_name: row.agent_api_name,
    bot_version_id: row.bot_version_id,
    kind: row.release_contract.kind,
    spec_digest: row.release_contract.spec_digest,
    baseline_id: row.release_contract.baseline_id,
  };
}

async function readReleaseIndex(base: string): Promise<ReleaseEvidenceIndex | undefined> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(base, RELEASE_INDEX_FILE), "utf8"),
    ) as ReleaseEvidenceIndex;
    return parsed.schema_version === 1 && Array.isArray(parsed.entries) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function allRunIds(base: string): Promise<string[]> {
  try {
    return (await readdir(base, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function rebuildReleaseIndex(base: string): Promise<ReleaseEvidenceIndex> {
  const rows: StoredRunEvidence[] = [];
  for (const runId of await allRunIds(base)) {
    const row = await readStoredRun(base, runId);
    if (row) rows.push(row);
  }
  const index: ReleaseEvidenceIndex = {
    schema_version: 1,
    entries: rows.filter((row) => row.terminal_complete).map(indexEntry),
  };
  await writeJsonAtomic(path.join(base, RELEASE_INDEX_FILE), index);
  return index;
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function withReleaseIndexLock<T>(base: string, fn: () => Promise<T>): Promise<T> {
  await mkdir(base, { recursive: true, mode: 0o700 });
  const lock = path.join(base, RELEASE_INDEX_LOCK);
  let acquired = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await writeFile(lock, `${process.pid}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
      acquired = true;
      break;
    } catch {
      try {
        const owner = Number((await readFile(lock, "utf8")).trim());
        if (Number.isInteger(owner) && !processAlive(owner)) await rm(lock, { force: true });
      } catch {
        // Another process may have released the lock between attempts.
      }
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  if (!acquired) throw new Error("Timed out acquiring the release-evidence index lock.");
  try {
    return await fn();
  } finally {
    await rm(lock, { force: true });
  }
}

export async function recordReleaseEvidence(cwd: string, runId: string): Promise<void> {
  const base = path.join(evalProjectRoot(cwd), ".pi", "state", "sf-agentscript", "runs");
  const row = await readStoredRun(base, runId);
  if (!row || !row.terminal_complete) return;
  await withReleaseIndexLock(base, async () => {
    const index = (await readReleaseIndex(base)) ?? { schema_version: 1 as const, entries: [] };
    index.entries = [indexEntry(row), ...index.entries.filter((entry) => entry.run_id !== runId)];
    await writeJsonAtomic(path.join(base, RELEASE_INDEX_FILE), index);
  });
}

async function readReleaseMetadata(
  cwd: string,
  identity: { org_id: string; agent_api_name: string; bot_version_id: string },
  expected: Array<{ kind: ReleaseContractKind; digest?: string }>,
): Promise<StoredRunEvidence[]> {
  const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
  let index = await readReleaseIndex(base);
  const matchingEntries = () =>
    index?.entries.filter(
      (entry) =>
        entry.org_id === identity.org_id &&
        entry.agent_api_name === identity.agent_api_name &&
        entry.bot_version_id === identity.bot_version_id,
    ) ?? [];
  let entries = matchingEntries();
  let ids = entries.map((entry) => entry.run_id);
  const missingExpected = () =>
    expected.some(
      (contract) =>
        !entries.some(
          (entry) =>
            entry.kind === contract.kind &&
            entry.spec_digest === contract.digest &&
            entry.baseline_id === AGENT_SCRIPT_RELEASE_BASELINE_ID,
        ),
    );
  if (!index || ids.length === 0 || missingExpected()) {
    index = await withReleaseIndexLock(base, async () => await rebuildReleaseIndex(base));
    entries = matchingEntries();
    ids = entries.map((entry) => entry.run_id);
  }
  const rows = await Promise.all(ids.map(async (runId) => await readStoredRun(base, runId)));
  return rows.filter((row): row is StoredRunEvidence => !!row);
}

function isCompletePassingRun(metadata: StoredRunEvidence): boolean {
  return (
    metadata.manifest_schema_version === 2 &&
    metadata.scope === "suite" &&
    metadata.terminal_complete &&
    metadata.execution_state === "completed" &&
    metadata.evidence_verdict === "passed" &&
    metadata.current_verdict === "passed" &&
    metadata.verdict_semantics_version === EVAL_VERDICT_SEMANTICS_VERSION &&
    (metadata.tests_count ?? 0) > 0 &&
    metadata.returned_tests_count === metadata.tests_count &&
    (metadata.failed_batches ?? 0) === 0 &&
    (metadata.totals?.test_fail ?? 0) === 0 &&
    (metadata.totals?.errors ?? 0) === 0
  );
}

function rewriteValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(rewriteValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, child]) => [
        key,
        rewriteValue(child),
      ]),
    );
  }
  if (typeof value !== "string") return value;
  if (value === "$active_planner_id") return "$latest_planner_id";
  if (value === "$active_bot_id") return "$latest_bot_id";
  if (value === "$active_bot_version_id") return "$latest_bot_version_id";
  return value;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
