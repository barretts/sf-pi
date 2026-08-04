/* SPDX-License-Identifier: Apache-2.0 */
/** Resolve source-only SOQL seed profiles into wire-ready EvalSpec context_variables. */

import { createHash } from "node:crypto";
import type {
  EvalSeedContextVariable,
  EvalSeedProfile,
  EvalSpec,
  EvalStep,
  EvalTest,
} from "./types.ts";

export interface EvalSeedQueryRunner {
  query(soql: string): Promise<{ records: Array<Record<string, unknown>> }>;
}

export interface EvalSeedProvenance {
  profile: string;
  scenario_ids: string[];
  variable_names: string[];
  sensitive_variable_names: string[];
  query_digest: string;
}

export interface ResolveEvalSeedsResult {
  spec: EvalSpec;
  provenance: EvalSeedProvenance[];
}

export function applyGeneratedBaselineSeedConfig(
  baseline: EvalSpec,
  designated: EvalSpec,
): EvalSpec {
  const config = designated.generated_baseline;
  if (!config) return baseline;
  const profiles = designated.seed_profiles ?? {};
  const knownTests = new Set(baseline.tests.map((test) => test.id));
  const skipped = new Set(config.skip_tests ?? []);
  for (const testId of skipped) {
    if (!knownTests.has(testId)) {
      throw new Error(`Generated baseline skip references unknown test '${testId}'.`);
    }
  }
  for (const testId of Object.keys(config.overrides ?? {})) {
    if (!knownTests.has(testId)) {
      throw new Error(`Generated baseline seed override references unknown test '${testId}'.`);
    }
  }
  const referencedProfiles = new Set<string>();
  const tests = baseline.tests.flatMap((source) => {
    if (skipped.has(source.id)) return [];
    const test = structuredClone(source);
    const profileName = config.overrides?.[test.id] ?? config.default_seed_profile;
    if (profileName) referencedProfiles.add(profileName);
    return [profileName ? { ...test, seed_profile: profileName } : test];
  });
  for (const profileName of referencedProfiles) {
    if (!profiles[profileName]) {
      throw new Error(`Generated baseline references unknown eval seed profile '${profileName}'.`);
    }
  }
  const selectedProfiles = Object.fromEntries(
    [...referencedProfiles].map((profileName) => [
      profileName,
      structuredClone(profiles[profileName] as EvalSeedProfile),
    ]),
  );
  return {
    ...(designated.sf_pi ? { sf_pi: structuredClone(designated.sf_pi) } : {}),
    ...(referencedProfiles.size > 0 ? { seed_profiles: selectedProfiles } : {}),
    tests,
  };
}

export async function resolveEvalSeedProfiles(
  source: EvalSpec,
  runner: EvalSeedQueryRunner,
): Promise<ResolveEvalSeedsResult> {
  validateEvalIds(source.tests);
  const profiles = source.seed_profiles ?? {};
  const scenariosByProfile = referencedProfiles(source.tests);
  const valuesByProfile = new Map<string, Array<Record<string, unknown>>>();
  const provenance: EvalSeedProvenance[] = [];

  for (const [profileName, scenarioIds] of scenariosByProfile) {
    const profile = profiles[profileName];
    if (!profile) throw new Error(`Unknown eval seed profile '${profileName}'.`);
    const prepared = prepareSeedSoql(profile.soql, profileName);
    const records = (await runner.query(prepared)).records;
    if (records.length !== 1) {
      throw new Error(
        `Eval seed profile '${profileName}' must resolve exactly one row; received ${records.length}.`,
      );
    }
    const values = resolveBindings(profileName, profile, records[0] ?? {});
    valuesByProfile.set(profileName, values);
    provenance.push({
      profile: profileName,
      scenario_ids: scenarioIds,
      variable_names: values.map((row) => String(row.name)),
      sensitive_variable_names: profile.context_variables
        .filter((binding) => typeof binding.field === "string")
        .map((binding) => binding.name),
      query_digest: createHash("sha256").update(profile.soql.trim()).digest("hex"),
    });
  }

  const tests = source.tests.map((test) => resolveTest(test, valuesByProfile));
  return {
    spec: {
      ...(source.sf_pi ? { sf_pi: structuredClone(source.sf_pi) } : {}),
      tests,
    },
    provenance,
  };
}

export function redactResolvedSeedValues<T>(
  value: T,
  spec: EvalSpec,
  provenance: EvalSeedProvenance[],
): T {
  const names = new Set(provenance.flatMap((entry) => entry.sensitive_variable_names));
  if (names.size === 0) return value;
  const sensitiveValues = new Set<string>();
  for (const test of spec.tests) {
    for (const step of test.steps) {
      if (!Array.isArray(step.context_variables)) continue;
      for (const candidate of step.context_variables) {
        if (!candidate || typeof candidate !== "object") continue;
        const row = candidate as Record<string, unknown>;
        if (!names.has(String(row.name ?? ""))) continue;
        if (["string", "number", "boolean"].includes(typeof row.value)) {
          sensitiveValues.add(String(row.value));
        }
      }
    }
  }
  return redactSeedValue(value, names, sensitiveValues) as T;
}

function redactSeedValue(
  value: unknown,
  names: ReadonlySet<string>,
  sensitiveValues: ReadonlySet<string>,
  key = "",
): unknown {
  if (names.has(key)) return "[REDACTED]";
  if (typeof value === "string") return redactSensitiveLiterals(value, sensitiveValues);
  if (Array.isArray(value)) {
    return value.map((entry) => redactSeedValue(entry, names, sensitiveValues));
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
      childKey,
      redactSeedValue(child, names, sensitiveValues, childKey),
    ]),
  );
}

export function redactSensitiveLiterals(
  text: string,
  sensitiveValues: ReadonlySet<string>,
): string {
  let output = text;
  const ordered = [...sensitiveValues].filter(Boolean).sort((a, b) => b.length - a.length);
  for (const sensitive of ordered) {
    if (/^[A-Za-z0-9_]+$/.test(sensitive)) {
      const escaped = sensitive.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      output = output.replace(
        new RegExp(`(^|[^A-Za-z0-9_])${escaped}(?=$|[^A-Za-z0-9_])`, "g"),
        "$1[REDACTED]",
      );
    } else {
      output = output.split(sensitive).join("[REDACTED]");
    }
  }
  return output;
}

function validateEvalIds(tests: EvalTest[]): void {
  const scenarios = new Set<string>();
  for (const test of tests) {
    if (!test.id || scenarios.has(test.id)) {
      throw new Error(`Duplicate eval scenario id '${test.id}'.`);
    }
    scenarios.add(test.id);
    const steps = new Set<string>();
    for (const step of test.steps) {
      if (!step.id || steps.has(step.id)) {
        throw new Error(`Duplicate step id '${step.id}' in eval scenario '${test.id}'.`);
      }
      steps.add(step.id);
    }
  }
}

function referencedProfiles(tests: EvalTest[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const test of tests) {
    if (!test.seed_profile) continue;
    const ids = out.get(test.seed_profile) ?? [];
    ids.push(test.id);
    out.set(test.seed_profile, ids);
  }
  return out;
}

function prepareSeedSoql(raw: string, profileName: string): string {
  const soql = raw.trim();
  if (!/^select\b/i.test(soql)) {
    throw new Error(`Eval seed profile '${profileName}' must use a read-only SELECT query.`);
  }
  if (/[;{}]/.test(soql) || /\$\{/.test(soql)) {
    throw new Error(`Eval seed profile '${profileName}' contains unsupported query syntax.`);
  }
  const queryShape = maskQuotedLiterals(soql, profileName);
  if (/(\/\*|\*\/|\/\/|--)/.test(queryShape)) {
    throw new Error(`Eval seed profile '${profileName}' contains unsupported comments.`);
  }
  const forbidden = [
    /\bALL\s+ROWS\b/i,
    /\bFOR\s+UPDATE\b/i,
    /\bOFFSET\b/i,
    /\bTYPEOF\b/i,
    /\bGROUP\s+BY\b/i,
    /\bHAVING\b/i,
    /\(\s*SELECT\b/i,
    /\b(COUNT|SUM|AVG|MIN|MAX|GROUPING)\s*\(/i,
  ];
  if (forbidden.some((pattern) => pattern.test(queryShape))) {
    throw new Error(`Eval seed profile '${profileName}' uses a query feature outside seed v1.`);
  }
  if (!/\bLIMIT\s+1\s*$/i.test(queryShape)) {
    throw new Error(`Eval seed profile '${profileName}' must end with LIMIT 1.`);
  }
  return soql.replace(/\bLIMIT\s+1\s*$/i, "LIMIT 2");
}

function maskQuotedLiterals(soql: string, profileName: string): string {
  let masked = "";
  let quoted = false;
  let escaped = false;
  for (const char of soql) {
    if (quoted) {
      masked += " ";
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "'") quoted = false;
    } else if (char === "'") {
      quoted = true;
      masked += " ";
    } else {
      masked += char;
    }
  }
  if (quoted) throw new Error(`Eval seed profile '${profileName}' has an unterminated string.`);
  return masked;
}

function resolveBindings(
  profileName: string,
  profile: EvalSeedProfile,
  record: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const seen = new Set<string>();
  return profile.context_variables.map((binding) => {
    if (!binding.name || seen.has(binding.name)) {
      throw new Error(
        `Eval seed profile '${profileName}' has a missing or duplicate context variable name '${binding.name}'.`,
      );
    }
    seen.add(binding.name);
    const value = bindingValue(profileName, binding, record);
    validateWireValue(profileName, binding, value);
    return { name: binding.name, type: binding.type ?? inferWireType(value), value };
  });
}

function bindingValue(
  profileName: string,
  binding: EvalSeedContextVariable,
  record: Record<string, unknown>,
): string | number | boolean {
  const hasField = typeof binding.field === "string" && binding.field.length > 0;
  const hasValue = binding.value !== undefined;
  if (hasField === hasValue) {
    throw new Error(
      `Eval seed profile '${profileName}' variable '${binding.name}' must declare exactly one of field or value.`,
    );
  }
  const value = hasField ? record[binding.field as string] : binding.value;
  if (value === null || value === undefined || !isScalar(value)) {
    throw new Error(
      `Eval seed profile '${profileName}' variable '${binding.name}' did not resolve a non-null scalar value.`,
    );
  }
  return value;
}

function isScalar(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function validateWireValue(
  profileName: string,
  binding: EvalSeedContextVariable,
  value: string | number | boolean,
): void {
  if (!binding.type) return;
  const normalized = binding.type.toLowerCase();
  const expected =
    normalized === "boolean"
      ? "boolean"
      : normalized === "number" || normalized === "integer" || normalized === "long"
        ? "number"
        : normalized === "text" || normalized === "string" || normalized === "id"
          ? "string"
          : undefined;
  if (!expected) {
    throw new Error(
      `Eval seed profile '${profileName}' variable '${binding.name}' uses unsupported type '${binding.type}'.`,
    );
  }
  if (typeof value !== expected) {
    throw new Error(
      `Eval seed profile '${profileName}' variable '${binding.name}' expected ${binding.type} but resolved ${typeof value}.`,
    );
  }
}

function inferWireType(value: string | number | boolean): string {
  if (typeof value === "boolean") return "Boolean";
  if (typeof value === "number") return "Number";
  return "Text";
}

function resolveTest(
  source: EvalTest,
  valuesByProfile: Map<string, Array<Record<string, unknown>>>,
): EvalTest {
  const { seed_profile: profileName, ...test } = structuredClone(source);
  if (!profileName) return test;
  const profileValues = valuesByProfile.get(profileName);
  if (!profileValues) throw new Error(`Unknown eval seed profile '${profileName}'.`);
  const firstSend = test.steps.find((step) => step.type === "agent.send_message");
  if (!firstSend) {
    throw new Error(
      `Eval scenario '${test.id}' uses seed profile '${profileName}' but has no send step.`,
    );
  }
  firstSend.context_variables = mergeContextVariables(firstSend, profileValues);
  return test;
}

function mergeContextVariables(
  step: EvalStep,
  profileValues: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const authored = Array.isArray(step.context_variables)
    ? structuredClone(step.context_variables as Array<Record<string, unknown>>)
    : [];
  const names = new Set(authored.map((row) => String(row.name ?? "")));
  return [...authored, ...profileValues.filter((row) => !names.has(String(row.name)))];
}
