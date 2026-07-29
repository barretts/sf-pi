/* SPDX-License-Identifier: Apache-2.0 */
/** Exact-version Agent Script release-eval evidence and activation preflight. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalSpec } from "./eval/types.ts";

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
  const requestedDesignatedPath = input.releaseSpecPath
    ? path.resolve(input.cwd, input.releaseSpecPath)
    : defaultReleaseSpecPath(input.cwd, input.agentApiName);
  const designatedPath = await existingFile(requestedDesignatedPath);
  const designatedDigest = designatedPath
    ? hashEvalSpec(JSON.parse(await readFile(designatedPath, "utf8")) as EvalSpec)
    : undefined;
  const designatedRequired = !!input.releaseSpecPath || !!designatedPath;
  const required: ReleaseContractKind[] = designatedRequired
    ? ["generated_baseline", "designated"]
    : ["generated_baseline"];
  const metadata = await readRecentMetadata(input.cwd);
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
      return kind !== "designated" || contract.spec_digest === designatedDigest;
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

interface StoredRunMetadata {
  run_id: string;
  org_id?: string;
  agent_api_name?: string;
  bot_version_id?: string;
  tests_count?: number;
  returned_tests_count?: number;
  failed_batches?: number;
  totals?: { test_fail?: number; errors?: number };
  release_contract?: {
    kind: ReleaseContractKind;
    spec_digest: string;
    baseline_id: string;
    spec_path?: string;
  };
}

async function existingFile(candidate: string): Promise<string | undefined> {
  try {
    await readFile(candidate, "utf8");
    return candidate;
  } catch {
    return undefined;
  }
}

async function readRecentMetadata(cwd: string): Promise<StoredRunMetadata[]> {
  const base = path.join(cwd, ".pi", "state", "sf-agentscript", "runs");
  let ids: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(path.join(base, "_index.json"), "utf8"));
    if (Array.isArray(parsed))
      ids = parsed.filter((value): value is string => typeof value === "string");
  } catch {
    return [];
  }
  const rows = await Promise.all(
    ids.slice(0, 50).map(async (runId) => {
      try {
        return JSON.parse(
          await readFile(path.join(base, runId, "metadata.json"), "utf8"),
        ) as StoredRunMetadata;
      } catch {
        return undefined;
      }
    }),
  );
  return rows.filter((row): row is StoredRunMetadata => !!row);
}

function isCompletePassingRun(metadata: StoredRunMetadata): boolean {
  return (
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
