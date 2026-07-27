/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Public API for the pre-flight module.
 *
 * Two surfaces:
 *   - `checkBundleType(path)`             local file check (always runs)
 *   - `checkActionTargets(conn, actions)` registry-driven org check
 *
 * The registry implementation dispatches each parsed URI by scheme to a
 * TargetResolver. Schemes not in the registry classify as
 * `unverifiable` — the compiler owns scheme validity, while sf-pi claims org
 * existence only for schemes with an authoritative product-specific resolver.
 */

import type { Connection } from "@salesforce/core";
import type { ComponentSummary } from "../inspect.ts";
import {
  discoverConnectedAgentGraph,
  type ConnectedAgentReadinessGraph,
} from "./connected-graph.ts";
import { extractActionTargets } from "./parse.ts";
import { resolverForScheme } from "./registry.ts";
import type {
  ActionTarget,
  ActionTargetCheck,
  CheckActionTargetsResult,
  TargetResolution,
} from "./types.ts";

export { checkBundleType, type BundleTypeCheckResult } from "./bundle-type.ts";
export {
  MAX_CONNECTED_AGENT_DEPTH,
  type ConnectedAgentReadinessGraph,
  type ConnectedReadinessEdge,
  type ConnectedReadinessIssue,
  type ConnectedReadinessNode,
} from "./connected-graph.ts";
export { extractActionTargets } from "./parse.ts";
export { listResolvers, registeredSchemes } from "./registry.ts";
export type {
  ActionTarget,
  ActionTargetCheck,
  CheckActionTargetsResult,
  TargetResolver,
  TargetStatus,
} from "./types.ts";

/**
 * Verify every action's `target:` URI resolves in the target org. Walks
 * the registry, dispatching each URI by scheme. Resolvers that return a
 * Set tell us which names exist; resolvers that return null mean we
 * couldn't verify. Schemes without a registered resolver are reported
 * as `unverifiable` (publish proceeds, runtime is responsible).
 */
export async function checkActionTargets(
  conn: Connection,
  actions: readonly ComponentSummary[],
): Promise<CheckActionTargetsResult> {
  const targets = extractActionTargets(actions);
  const out: ActionTargetCheck[] = [];
  let resolved = 0;
  let missing = 0;
  let unverifiable = 0;

  // Bucket targets by resolver so we issue one query per resolver group
  // (rather than one per target).
  const buckets = new Map<
    string,
    {
      resolver: ReturnType<typeof resolverForScheme> | undefined;
      indices: number[];
    }
  >();
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i];
    const key = t.scheme;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { resolver: resolverForScheme(t.scheme), indices: [] };
      buckets.set(key, bucket);
    }
    bucket.indices.push(i);
  }

  // Pre-resolve each bucket; detailed resolvers can return a per-action
  // verdict while simple resolvers return a Set of ref_names that exist.
  const bucketResults = new Map<string, Set<string> | null>();
  const detailedResults = new Map<ActionTarget, TargetResolution>();
  for (const [scheme, bucket] of buckets) {
    if (!bucket.resolver) {
      bucketResults.set(scheme, null);
      continue;
    }
    const bucketTargets = bucket.indices.map((i) => targets[i]);
    if (bucket.resolver.resolveTargets) {
      const detailed = await bucket.resolver.resolveTargets(conn, bucketTargets);
      if (detailed === null) {
        bucketResults.set(scheme, null);
      } else {
        for (let i = 0; i < bucketTargets.length; i++) {
          const verdict = detailed[i];
          if (verdict) detailedResults.set(bucketTargets[i], verdict);
        }
      }
      continue;
    }
    const refNames = bucketTargets.map((t) => t.ref_name);
    const found = await bucket.resolver.resolve(conn, refNames, bucketTargets);
    bucketResults.set(scheme, found);
  }

  for (const t of targets) {
    const resolver = resolverForScheme(t.scheme);
    if (!resolver) {
      out.push({
        ...t,
        status: "unverifiable",
        detail: `Scheme '${t.scheme}' is not pre-flighted (no resolver registered).`,
      });
      unverifiable++;
      continue;
    }
    const detailed = detailedResults.get(t);
    if (detailed) {
      out.push({
        ...t,
        status: detailed.status,
        detail: detailed.detail,
        runtime_readiness: detailed.runtime_readiness,
        runtime_detail: detailed.runtime_detail,
        metadata_label: resolver.metadataLabel,
      });
      if (detailed.status === "ok") resolved++;
      else if (detailed.status === "missing") missing++;
      else unverifiable++;
      continue;
    }

    const result = bucketResults.get(t.scheme);
    if (result === null) {
      out.push({
        ...t,
        status: "unverifiable",
        detail: `${resolver.metadataLabel} query failed; cannot confirm '${t.ref_name}' exists.`,
        metadata_label: resolver.metadataLabel,
      });
      unverifiable++;
    } else if (result.has(t.ref_name)) {
      out.push({
        ...t,
        status: "ok",
        metadata_label: resolver.metadataLabel,
      });
      resolved++;
    } else {
      out.push({
        ...t,
        status: "missing",
        detail:
          resolver.missingDetail?.(t) ??
          `${resolver.metadataLabel} '${t.ref_name}' not found in org.`,
        metadata_label: resolver.metadataLabel,
      });
      missing++;
    }
  }

  return {
    ok: missing === 0,
    targets: out,
    total: targets.length,
    resolved,
    missing,
    unverifiable,
  };
}

export async function checkConnectedAgentReadinessGraph(
  conn: Connection,
  rootAgentFile: string,
): Promise<ConnectedAgentReadinessGraph> {
  const graph = await discoverConnectedAgentGraph(rootAgentFile);
  const targets = graph.nodes
    .filter((node) => node.depth > 0)
    .map((node) => ({
      name: node.agent_name,
      target: `agent://${node.agent_name}`,
    })) as ComponentSummary[];
  if (targets.length === 0) return graph;
  const readiness = await checkActionTargets(conn, targets);
  const byName = new Map(readiness.targets.map((target) => [target.ref_name, target]));
  for (const node of graph.nodes) {
    if (node.depth === 0) continue;
    const target = byName.get(node.agent_name);
    if (!target) continue;
    node.status = target.status;
    node.runtime_readiness = target.runtime_readiness;
    node.detail = target.runtime_detail ?? target.detail;
    if (target.status === "missing") {
      graph.issues.push({
        kind: "missing",
        agent_name: node.agent_name,
        depth: node.depth,
        path: node.path,
        detail: target.detail ?? `Connected agent '${node.agent_name}' is missing.`,
      });
    } else if (target.runtime_readiness === "not_ready") {
      graph.issues.push({
        kind: "runtime_not_ready",
        agent_name: node.agent_name,
        depth: node.depth,
        path: node.path,
        detail:
          target.runtime_detail ?? `Connected agent '${node.agent_name}' is not runtime-ready.`,
      });
    }
  }
  graph.issues.sort((a, b) => a.depth - b.depth || a.agent_name.localeCompare(b.agent_name));
  return graph;
}
