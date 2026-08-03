/* SPDX-License-Identifier: Apache-2.0 */
/** Schema-discriminating readers for current and legacy Eval Run artifacts. */

import { readFile } from "node:fs/promises";
import path from "node:path";
import type { EvalRunManifest, EvalRunStatusArtifact } from "../eval/persist.ts";
import type { EvalApiResponse, EvalSpec, RunMetadata } from "../eval/types.ts";
import {
  deriveEvalVerdict,
  EVAL_VERDICT_SEMANTICS_VERSION,
  type EvalExecutionState,
  type EvidenceVerdict,
} from "../eval/verdict.ts";
import { redactStudioValue, type StudioRedactionContext } from "./redaction.ts";
import type { StudioRunSummary } from "./types.ts";

export interface ReadRunArtifact {
  summary: StudioRunSummary;
  manifest?: EvalRunManifest;
  metadata?: RunMetadata;
  status?: EvalRunStatusArtifact;
}

async function json<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

async function sourcePreview(
  file: string,
  redaction: StudioRedactionContext,
): Promise<string | undefined> {
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return JSON.stringify(redactStudioValue(parsed, "", redaction), null, 2).slice(0, 6000);
  } catch {
    return undefined;
  }
}

async function currentVerdict(
  runDir: string,
  metadata: RunMetadata | undefined,
): Promise<EvidenceVerdict | undefined> {
  if (
    metadata?.verdict_semantics_version === EVAL_VERDICT_SEMANTICS_VERSION &&
    metadata.evidence_verdict
  ) {
    return metadata.evidence_verdict;
  }
  try {
    const [spec, response] = await Promise.all([
      json<EvalSpec>(path.join(runDir, "spec.executed.snapshot.json")),
      json<EvalApiResponse>(path.join(runDir, "raw.json")),
    ]);
    if (!spec || !response) return undefined;
    return deriveEvalVerdict(spec, response, {
      failedBatches: metadata?.failed_batches,
    }).verdict;
  } catch {
    return undefined;
  }
}

async function evaluatorRows(
  runDir: string,
  allowRaw: boolean,
  redaction: StudioRedactionContext,
): Promise<StudioRunSummary["evaluators"]> {
  try {
    const evidence = JSON.parse(await readFile(path.join(runDir, "evidence.json"), "utf8")) as {
      scenarios?: Array<{
        id?: string;
        evaluators?: Array<Record<string, unknown>>;
      }>;
    };
    return (evidence.scenarios ?? []).flatMap((scenario) =>
      (scenario.evaluators ?? []).map((entry) => {
        const row = redactStudioValue(entry, "", redaction) as Record<string, unknown>;
        return {
          scenario_id: String(scenario.id ?? ""),
          id: String(row.id ?? ""),
          ...(typeof row.is_pass === "boolean" || row.is_pass === null
            ? { is_pass: row.is_pass as boolean | null }
            : {}),
          ...(typeof row.score === "number" || row.score === null
            ? { score: row.score as number | null }
            : {}),
          ...(typeof row.actual_value === "string" ? { actual_value: row.actual_value } : {}),
          ...(typeof row.expected_value === "string" ? { expected_value: row.expected_value } : {}),
          ...(typeof row.error_message === "string" ? { error_message: row.error_message } : {}),
        };
      }),
    );
  } catch {
    // Legacy/current-before-evidence artifacts fall back to raw only on explicit detail reads.
  }
  if (!allowRaw) return undefined;
  try {
    const raw = JSON.parse(await readFile(path.join(runDir, "raw.json"), "utf8")) as {
      results?: Array<{
        id?: string;
        evaluation_results?: Array<Record<string, unknown>>;
      }>;
    };
    return (raw.results ?? []).flatMap((scenario) =>
      (scenario.evaluation_results ?? []).slice(0, 100).map((entry) => {
        const row = redactStudioValue(entry, "", redaction) as Record<string, unknown>;
        return {
          scenario_id: String(scenario.id ?? ""),
          id: String(row.id ?? ""),
          ...(typeof row.is_pass === "boolean" || row.is_pass === null
            ? { is_pass: row.is_pass as boolean | null }
            : {}),
          ...(typeof row.score === "number" || row.score === null
            ? { score: row.score as number | null }
            : {}),
          ...(typeof row.actual_value === "string" ? { actual_value: row.actual_value } : {}),
          ...(typeof row.expected_value === "string" ? { expected_value: row.expected_value } : {}),
          ...(typeof row.error_message === "string" ? { error_message: row.error_message } : {}),
        };
      }),
    );
  } catch {
    return undefined;
  }
}

async function transcript(
  runDir: string,
  redaction: StudioRedactionContext,
): Promise<StudioRunSummary["turns"]> {
  try {
    const raw = await readFile(path.join(runDir, "transcript.jsonl"), "utf8");
    return raw
      .split("\n")
      .filter(Boolean)
      .slice(0, 200)
      .map((line) => {
        const row = redactStudioValue(JSON.parse(line), "", redaction) as Record<string, unknown>;
        return {
          scenario_id: String(row.test_id ?? ""),
          turn_id: String(row.turn_id ?? ""),
          ...(typeof row.utterance === "string" ? { utterance: row.utterance } : {}),
          ...(typeof row.agent_response === "string" ? { agent_response: row.agent_response } : {}),
          ...(typeof row.topic === "string" ? { topic: row.topic } : {}),
          ...(Array.isArray(row.invoked_actions)
            ? { invoked_actions: row.invoked_actions.map(String) }
            : {}),
          ...(row.state_variables && typeof row.state_variables === "object"
            ? { state_variables: row.state_variables as Record<string, unknown> }
            : {}),
        };
      });
  } catch {
    return undefined;
  }
}

async function seedRedactionContext(
  runDir: string,
  manifestValue: unknown,
): Promise<StudioRedactionContext> {
  const manifest = manifestValue as Partial<EvalRunManifest> | undefined;
  const names = new Set(
    (manifest?.seed_provenance ?? []).flatMap(
      (entry) => entry.sensitive_names ?? entry.names ?? [],
    ),
  );
  if (names.size === 0) return {};
  const values = new Set<string>();
  const executed = await json<EvalSpec>(path.join(runDir, "spec.executed.snapshot.json"));
  for (const test of executed?.tests ?? []) {
    for (const step of test.steps) {
      if (!Array.isArray(step.context_variables)) continue;
      for (const candidate of step.context_variables) {
        if (!candidate || typeof candidate !== "object") continue;
        const row = candidate as Record<string, unknown>;
        if (!names.has(String(row.name ?? ""))) continue;
        if (["string", "number", "boolean"].includes(typeof row.value)) {
          values.add(String(row.value));
        }
      }
    }
  }
  return { sensitiveNames: names, sensitiveValues: values };
}

function statusState(status: EvalRunStatusArtifact | undefined): EvalExecutionState | undefined {
  if (!status) return undefined;
  if (status.status === "running") return "running";
  if (status.status === "completed") return "completed";
  if (status.status === "cancelled") return "cancelled";
  if (status.status === "interrupted") return "interrupted";
  return "infrastructure_failed";
}

function legacyVerdict(metadata: RunMetadata | undefined): EvidenceVerdict | undefined {
  if (!metadata?.totals) return undefined;
  if ((metadata.failed_batches ?? 0) > 0 || (metadata.missing_test_ids?.length ?? 0) > 0) {
    return "incomplete";
  }
  if (metadata.totals.errors > 0) return "incomplete";
  if (metadata.totals.test_fail > 0 || metadata.totals.ev_fail > 0) return "failed";
  return "unverified";
}

export async function readEvalRunArtifact(
  runDir: string,
  options: { details?: boolean; source?: boolean; evidence?: boolean } = {},
): Promise<ReadRunArtifact> {
  const runId = path.basename(runDir);
  const [manifestValue, metadata, status] = await Promise.all([
    json<unknown>(path.join(runDir, "manifest.json")),
    json<RunMetadata>(path.join(runDir, "metadata.json")),
    json<EvalRunStatusArtifact>(path.join(runDir, "status.json")),
  ]);
  const redaction = await seedRedactionContext(runDir, manifestValue);
  const [turns, evaluators, interpretedVerdict, sourceSnapshot, executedSnapshot] =
    await Promise.all([
      options.details ? transcript(runDir, redaction) : Promise.resolve(undefined),
      options.details || options.evidence
        ? evaluatorRows(runDir, options.details === true, redaction)
        : Promise.resolve(undefined),
      currentVerdict(runDir, metadata),
      options.details || options.source
        ? sourcePreview(path.join(runDir, "spec.source.snapshot.json"), redaction)
        : Promise.resolve(undefined),
      options.details || options.source
        ? sourcePreview(path.join(runDir, "spec.executed.snapshot.json"), redaction)
        : Promise.resolve(undefined),
    ]);

  if (manifestValue !== undefined) {
    const manifest = manifestValue as Partial<EvalRunManifest>;
    if (manifest.schema_version !== 2 || manifest.run_id !== runId || !manifest.scope) {
      return {
        summary: {
          run_id: runId,
          run_dir: runDir,
          classification: "unavailable",
          scope: "ad_hoc",
          error: "Run manifest is corrupt or unsupported.",
        },
      };
    }
    const currentManifest = manifest as EvalRunManifest;
    return {
      manifest: currentManifest,
      metadata,
      status,
      summary: {
        run_id: runId,
        run_dir: runDir,
        classification: currentManifest.scope === "ad_hoc" ? "ad_hoc" : "current",
        scope: currentManifest.scope,
        scenario_id: currentManifest.scenario_id,
        suite_path: currentManifest.spec_path,
        agent_api_name: currentManifest.agent_api_name,
        target_org: currentManifest.org,
        started: metadata?.started ?? currentManifest.created,
        completed: metadata?.completed ?? status?.completed,
        execution_state: metadata?.execution_state ?? statusState(status),
        recorded_verdict: metadata?.evidence_verdict,
        current_verdict: interpretedVerdict,
        source_digest: currentManifest.source_digest,
        executed_digest: currentManifest.executed_digest,
        bot_version_number: metadata?.bot_version_number,
        result_summary: metadata?.totals
          ? `${metadata.totals.test_pass}/${metadata.totals.tests}`
          : undefined,
        errors: metadata?.totals?.errors,
        p95_ms: metadata?.latency_summary?.p95_ms,
        duration_ms: metadata?.duration_ms,
        evaluators,
        source_snapshot_preview: sourceSnapshot,
        executed_snapshot_preview: executedSnapshot,
        turns,
      },
    };
  }

  if (metadata || status) {
    return {
      metadata,
      status,
      summary: {
        run_id: runId,
        run_dir: runDir,
        classification: metadata?.spec_path ? "legacy" : "ad_hoc",
        scope: metadata?.spec_path ? "suite" : "ad_hoc",
        suite_path: metadata?.spec_path,
        agent_api_name: metadata?.agent_api_name,
        target_org: metadata?.org ?? status?.org,
        started: metadata?.started ?? status?.started,
        completed: metadata?.completed ?? status?.completed,
        execution_state: metadata?.execution_state ?? statusState(status),
        recorded_verdict: metadata?.evidence_verdict ?? legacyVerdict(metadata),
        current_verdict: interpretedVerdict,
        bot_version_number: metadata?.bot_version_number,
        result_summary: metadata?.totals
          ? `${metadata.totals.test_pass}/${metadata.totals.tests}`
          : undefined,
        errors: metadata?.totals?.errors,
        p95_ms: metadata?.latency_summary?.p95_ms,
        duration_ms: metadata?.duration_ms,
        evaluators,
        source_snapshot_preview: sourceSnapshot,
        executed_snapshot_preview: executedSnapshot,
        turns,
      },
    };
  }

  return {
    summary: {
      run_id: runId,
      run_dir: runDir,
      classification: "unavailable",
      scope: "ad_hoc",
      error: "No readable Run manifest, metadata, or status artifact.",
    },
  };
}
