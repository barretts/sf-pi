/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public types for the pre-flight registry.
 *
 * The registry dispatches `target:` URIs by scheme to a TargetResolver,
 * which decides whether the referenced metadata exists in the org. The
 * shape is intentionally narrow so adding a new scheme is one resolver
 * file plus one registry line.
 */

import type { Connection } from "@salesforce/core";

/**
 * A parsed `target:` URI from an action declaration.
 */
export interface ActionTarget {
  /** Action declaration name (e.g. "log_event"). */
  name: string;
  /** Raw URI as it appeared in source (e.g. "flow://LogEvent"). */
  target: string;
  /** Scheme part — what comes before "://". */
  scheme: string;
  /** Reference name — what comes after "://". */
  ref_name: string;
  /** Declared action input names, when inspect can read them. */
  input_names?: string[];
  /** Declared action output names, when inspect can read them. */
  output_names?: string[];
}

/**
 * A status verdict for a single action target.
 *   - `ok`           — the metadata exists in the org.
 *   - `missing`      — we queried and it doesn't exist (publish would fail).
 *   - `unverifiable` — we don't pre-flight this scheme (intentionally) or
 *                      the query returned an error / the resolver is
 *                      missing. Publish proceeds; runtime is responsible.
 */
export type TargetStatus = "ok" | "missing" | "unverifiable";
export type TargetRuntimeReadiness = "ready" | "not_ready" | "unverifiable";

export interface ActionTargetCheck extends ActionTarget {
  status: TargetStatus;
  detail?: string;
  /** Runtime callability is separate from metadata existence. */
  runtime_readiness?: TargetRuntimeReadiness;
  runtime_detail?: string;
  /** Human-readable label for the metadata type (e.g. "Flow", "ApexClass"). */
  metadata_label?: string;
}

export interface CheckActionTargetsResult {
  /** True when no targets are `missing`. `unverifiable` does NOT make ok=false. */
  ok: boolean;
  targets: ActionTargetCheck[];
  total: number;
  resolved: number;
  missing: number;
  unverifiable: number;
}

export interface TargetResolution {
  status: TargetStatus;
  detail?: string;
  runtime_readiness?: TargetRuntimeReadiness;
  runtime_detail?: string;
  reason?: string;
  data?: Record<string, unknown>;
}

/**
 * One resolver per metadata type. The registry maps schemes to resolvers
 * 1:N — a single resolver may declare multiple schemes when the underlying
 * SOQL is the same (e.g. `apex://` and `apexRest://` both query
 * `ApexClass.Name`; we keep them in separate resolvers anyway for clarity
 * but the always-available resolver groups several similar schemes).
 */
export interface TargetResolver {
  /** Schemes this resolver handles. */
  readonly schemes: readonly string[];

  /** Friendly name shown in error / render output (e.g. "Flow", "ApexClass"). */
  readonly metadataLabel: string;

  /**
   * Verify a batch of names against the org. Returns the set of names
   * that exist. Resolvers may also indicate:
   *   - "always available" → return Set containing every queried name
   *   - "couldn't verify" → return null
   */
  resolve(
    conn: Connection,
    refNames: readonly string[],
    targets?: readonly ActionTarget[],
  ): Promise<Set<string> | null>;

  /**
   * Optional precise per-target verdicts. Resolvers should use this when the
   * same referenced name can pass for one action but fail for another (e.g.
   * Apex I/O exact-name matching).
   */
  resolveTargets?(
    conn: Connection,
    targets: readonly ActionTarget[],
  ): Promise<TargetResolution[] | null>;

  /**
   * Optional: resolver-specific explanation for a missing verdict. Use this
   * when "missing" also means present-but-not-ready (inactive Flow, Draft
   * Prompt Template, non-invocable Apex, I/O mismatch, etc.).
   */
  missingDetail?(target: ActionTarget): string;

  /**
   * Optional: a deploy command (or doc pointer) that fixes a missing
   * reference. Used in the LLM error envelope so the recover_via hint
   * is concrete.
   */
  fixHint?(refName: string): string;
}
