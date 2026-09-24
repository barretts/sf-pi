/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { guardrailInputHash } from "../guardrail-identity.ts";

export const SOQL_ARTIFACT_PLAN_VERSION = 1;
const PLAN_TTL_MS = 10 * 60 * 1000;
const STORE_LIMIT = 256;
const FILE_NAMES = [
  "query.soql",
  "result.raw.json",
  "result.flattened.json",
  "result.flattened.csv",
  "summary.json",
] as const;

export interface SoqlArtifactPlanBinding {
  sessionId: string;
  toolCallId: string;
  toolName: "sf_soql";
  inputHash: string;
  cwd: string;
}

export interface SoqlArtifactPlan {
  version: 1;
  writerCwd: string;
  root: string;
  runDirectory: string;
  directories: readonly string[];
  files: readonly string[];
}

export interface PreparedSoqlArtifactPlan {
  binding: Readonly<SoqlArtifactPlanBinding>;
  plan: Readonly<SoqlArtifactPlan>;
  hash: string;
}

export interface SoqlArtifactLease {
  prepared: Readonly<PreparedSoqlArtifactPlan>;
  beforeWrite(): Promise<void>;
  check(): void;
  finish(): void;
}

type State = "prepared" | "authorized" | "consuming" | "consumed" | "finished" | "blocked";
type Planner = () => SoqlArtifactPlan;
interface Entry {
  prepared: Readonly<PreparedSoqlArtifactPlan>;
  expires: number;
  state: State;
  contextHash?: string;
  verify?: () => Promise<boolean>;
  isCurrent?: () => boolean;
}

let planner: Planner | undefined;
const entries = new Map<string, Entry>();
const leases = new WeakSet<object>();

function blocked(): never {
  throw new Error("SOQL artifact approval is missing or changed. Execution is blocked.");
}

function key(binding: SoqlArtifactPlanBinding): string {
  if (
    !binding.sessionId ||
    !binding.toolCallId ||
    binding.toolName !== "sf_soql" ||
    !/^[a-f0-9]{64}$/.test(binding.inputHash) ||
    !path.isAbsolute(binding.cwd)
  )
    blocked();
  return guardrailInputHash([binding.sessionId, binding.toolCallId]);
}

function sameBinding(a: SoqlArtifactPlanBinding, b: SoqlArtifactPlanBinding): boolean {
  return guardrailInputHash(a) === guardrailInputHash(b);
}

function validPlan(source: SoqlArtifactPlan): SoqlArtifactPlan {
  const plan: SoqlArtifactPlan = {
    version: source.version,
    writerCwd: source.writerCwd,
    root: source.root,
    runDirectory: source.runDirectory,
    directories: [...source.directories],
    files: [...source.files],
  };
  if (
    plan.version !== SOQL_ARTIFACT_PLAN_VERSION ||
    !path.isAbsolute(plan.writerCwd) ||
    !path.isAbsolute(plan.root) ||
    !path.isAbsolute(plan.runDirectory) ||
    path.dirname(plan.runDirectory) !== path.join(plan.root, "runs") ||
    !/^jev-[a-f0-9]{32}$/.test(path.basename(plan.runDirectory)) ||
    plan.files.length !== FILE_NAMES.length ||
    plan.files.some((file, i) => file !== path.join(plan.runDirectory, FILE_NAMES[i]))
  )
    blocked();
  const expected: string[] = [];
  let current = plan.runDirectory;
  for (;;) {
    expected.unshift(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  if (
    guardrailInputHash(plan.directories) !== guardrailInputHash(expected) ||
    plan.directories.length + plan.files.length > 32 ||
    [...plan.directories, ...plan.files].some((p) => Buffer.byteLength(p) > 4096)
  )
    blocked();
  Object.freeze(plan.directories);
  Object.freeze(plan.files);
  return Object.freeze(plan);
}

/** Registration comes from the actual SOQL tool producer. No hook order is required. */
export function registerSoqlArtifactPlanner(create: Planner): void {
  revokeAllSoqlArtifactPlans();
  planner = create;
}

export function prepareSoqlArtifactPlan(
  binding: SoqlArtifactPlanBinding,
): Readonly<PreparedSoqlArtifactPlan> {
  const id = key(binding);
  const existing = entries.get(id);
  if (existing) {
    if (
      existing.state !== "prepared" ||
      Date.now() >= existing.expires ||
      !sameBinding(existing.prepared.binding, binding)
    )
      blocked();
    return existing.prepared;
  }
  // Keep each call's Jev record for this process lifetime. A later engine change
  // must not let a finished, revoked, or expired call use the legacy writer.
  // At the bound, reject new plans instead of deleting callable identities.
  if (!planner || entries.size >= STORE_LIMIT) blocked();
  const plan = validPlan(planner());
  const snapshot = Object.freeze({ ...binding });
  const prepared = Object.freeze({
    binding: snapshot,
    plan,
    hash: guardrailInputHash({ binding: snapshot, plan }),
  });
  entries.set(id, { prepared, expires: Date.now() + PLAN_TTL_MS, state: "prepared" });
  return prepared;
}

function getExact(prepared: Readonly<PreparedSoqlArtifactPlan>): Entry {
  const entry = entries.get(key(prepared.binding));
  if (!entry || entry.prepared !== prepared || Date.now() >= entry.expires) blocked();
  return entry;
}

export function assertPreparedSoqlArtifactPlan(prepared: Readonly<PreparedSoqlArtifactPlan>): void {
  const entry = getExact(prepared);
  if (!["prepared", "authorized", "consuming", "consumed"].includes(entry.state)) blocked();
}

/** An engine change cannot reinterpret this same prepared call as legacy execution. */
export function wasSoqlArtifactPlanPrepared(
  sessionId: string | undefined,
  toolCallId: string,
): boolean {
  return !!sessionId && entries.has(guardrailInputHash([sessionId, toolCallId]));
}

/** The guard calls this only after its final context check and successful allow audit. */
export function authorizeSoqlArtifactPlan(
  prepared: Readonly<PreparedSoqlArtifactPlan>,
  contextHash: string,
  verify: () => Promise<boolean>,
  isCurrent: () => boolean,
): void {
  const entry = getExact(prepared);
  if (entry.state !== "prepared" || !/^[a-f0-9]{64}$/.test(contextHash) || !isCurrent()) blocked();
  entry.contextHash = contextHash;
  entry.verify = verify;
  entry.isCurrent = isCurrent;
  entry.state = "authorized";
}

/** State changes before the first await. Two consumers cannot claim one entry. */
export async function claimSoqlArtifactPlan(
  binding: SoqlArtifactPlanBinding,
  signal?: AbortSignal,
): Promise<SoqlArtifactLease> {
  const entry = entries.get(key(binding));
  if (
    !entry ||
    entry.state !== "authorized" ||
    Date.now() >= entry.expires ||
    !sameBinding(entry.prepared.binding, binding) ||
    signal?.aborted
  )
    blocked();
  entry.state = "consuming";
  const check = () => {
    if (
      (entry.state !== "consuming" && entry.state !== "consumed") ||
      Date.now() >= entry.expires ||
      signal?.aborted ||
      !entry.isCurrent?.()
    )
      blocked();
  };
  try {
    check();
    if (!(await entry.verify?.())) blocked();
    check();
    entry.state = "consumed";
    const lease: SoqlArtifactLease = Object.freeze({
      prepared: entry.prepared,
      check,
      async beforeWrite() {
        check();
        if (!(await entry.verify?.())) blocked();
        check();
      },
      finish() {
        entry.state = "finished";
      },
    });
    leases.add(lease);
    return lease;
  } catch {
    entry.state = "blocked";
    return blocked();
  }
}

export function assertSoqlArtifactLease(lease: SoqlArtifactLease): void {
  if (!leases.has(lease)) blocked();
  lease.check();
}

export function revokeSoqlArtifactPlan(prepared: Readonly<PreparedSoqlArtifactPlan>): void {
  const entry = entries.get(key(prepared.binding));
  if (entry?.prepared === prepared) entry.state = "blocked";
}

export function revokeAllSoqlArtifactPlans(): void {
  for (const entry of entries.values()) entry.state = "blocked";
}
