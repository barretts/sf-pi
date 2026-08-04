/* SPDX-License-Identifier: Apache-2.0 */
/** Conservative inverse projection from raw EvalSpec JSON into Studio concepts. */

import { evaluatorCatalogEntry } from "../eval/evaluator-catalog.ts";
import type {
  EvalSeedProfile,
  EvalSpec,
  EvalStep,
  EvalTest,
  TurnResponseIntegrityPolicy,
} from "../eval/types.ts";
import {
  evalResponseIntegrityPolicyIssues,
  responseIntegrityScenarioIssues,
} from "../eval/response-integrity.ts";
import type {
  StudioEvaluator,
  StudioScenario,
  StudioSeed,
  StudioSuiteProjection,
  StudioTurn,
} from "./types.ts";

const SUPPORTED_AGENT_STEPS = new Set([
  "agent.create_session",
  "agent.send_message",
  "agent.get_state",
  "agent.end_session",
]);
const REF_RE = /\{([^{}.]+)(?:\.[^{}]+)?\}/g;

function asSpec(value: unknown): EvalSpec | undefined {
  if (!value || typeof value !== "object" || !Array.isArray((value as { tests?: unknown }).tests)) {
    return undefined;
  }
  return value as EvalSpec;
}

function stepReferences(step: EvalStep): string[] {
  const refs = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(REF_RE)) if (match[1]) refs.add(match[1]);
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) walk(child);
      return;
    }
    if (value && typeof value === "object") {
      for (const child of Object.values(value as Record<string, unknown>)) walk(child);
    }
  };
  walk(step);
  return [...refs];
}

function expectedText(step: EvalStep): string | undefined {
  for (const key of ["expected", "expected_value", "reference_answer", "criteria"]) {
    const value = step[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function seedRows(step: EvalStep): StudioSeed[] {
  const raw = step.context_variables;
  if (!Array.isArray(raw)) return [];
  const out: StudioSeed[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.name !== "string" || !("value" in row)) continue;
    out.push({
      name: row.name,
      ...(typeof row.type === "string" ? { type: row.type } : {}),
      value: row.value,
      provenance: step.id,
    });
  }
  return out;
}

function projectScenario(
  test: EvalTest,
  sourceIndex: number,
  seedProfiles: Record<string, EvalSeedProfile>,
  responseIntegrityPolicy?: TurnResponseIntegrityPolicy,
): StudioScenario {
  const blocking: string[] = [];
  const profileName = test.seed_profile;
  const profile = profileName ? seedProfiles[profileName] : undefined;
  if (profileName && !profile) blocking.push(`Unknown seed profile '${profileName}'.`);
  const steps = Array.isArray(test.steps) ? test.steps : [];
  const ids = steps.map((step) => step.id).filter(Boolean);
  if (steps.some((step) => !step.id?.trim())) blocking.push("Every step requires a non-empty id.");
  if (new Set(ids).size !== ids.length) blocking.push("Step ids must be unique within a Scenario.");

  const createCount = steps.filter((step) => step.type === "agent.create_session").length;
  if (createCount !== 1)
    blocking.push("Scenario requires exactly one shared agent.create_session step.");

  const stepIdSet = new Set(ids);
  for (const step of steps) {
    for (const reference of stepReferences(step)) {
      if (!stepIdSet.has(reference)) blocking.push(`Unresolved step reference '${reference}'.`);
    }
    if (step.type.startsWith("agent.") && !SUPPORTED_AGENT_STEPS.has(step.type)) {
      blocking.push(`Unsupported step type '${step.type}'.`);
    }
    if (!step.type.startsWith("agent.") && !step.type.startsWith("evaluator.")) {
      blocking.push(`Unsupported step type '${step.type}'.`);
    }
  }

  const turns: StudioTurn[] = steps
    .filter((step) => step.type === "agent.send_message")
    .map((step) => ({
      id: step.id,
      utterance: typeof step.utterance === "string" ? step.utterance : "",
    }));
  if (turns.length === 0) blocking.push("Scenario requires at least one user turn.");
  if (turns.some((turn) => !turn.utterance.trim()))
    blocking.push("Every user turn requires an utterance.");

  const turnIds = new Set(turns.map((turn) => turn.id));
  const stateToTurn = new Map<string, string>();
  const stateCountByTurn = new Map<string, number>();
  let previousTurn: string | undefined;
  for (const step of steps) {
    if (step.type === "agent.send_message") previousTurn = step.id;
    else if (step.type === "agent.get_state" && previousTurn) {
      stateToTurn.set(step.id, previousTurn);
      const count = (stateCountByTurn.get(previousTurn) ?? 0) + 1;
      stateCountByTurn.set(previousTurn, count);
      if (count > 1) {
        blocking.push(`Turn '${previousTurn}' has ambiguous multiple agent.get_state steps.`);
      }
    }
  }
  blocking.push(...responseIntegrityScenarioIssues(test, responseIntegrityPolicy));

  const evaluators: StudioEvaluator[] = steps
    .filter((step) => step.type.startsWith("evaluator."))
    .map((step) => {
      const referencedTurns = stepReferences(step)
        .map((id) => (turnIds.has(id) ? id : stateToTurn.get(id)))
        .filter((id): id is string => !!id);
      const turnId = referencedTurns.length === 1 ? referencedTurns[0] : undefined;
      const catalog = evaluatorCatalogEntry(step.type);
      return {
        id: step.id,
        type: step.type,
        label: catalog.label,
        capability: catalog.capability,
        scope: turnId ? "turn" : "scenario",
        ...(turnId ? { turn_id: turnId } : {}),
        ...(expectedText(step) ? { expected: expectedText(step) } : {}),
      };
    });
  if (evaluators.length === 0) blocking.push("Scenario requires at least one evaluator.");

  const checkpoints = steps
    .filter((step) => step.type.startsWith("evaluator."))
    .flatMap((step) => {
      const actual = typeof step.actual === "string" ? step.actual : "";
      const match = /stateVariables\.([A-Za-z0-9_]+)/.exec(actual);
      if (!match) return [];
      const stateRef = stepReferences(step)[0];
      return [
        {
          name: match[1],
          ...(expectedText(step) ? { expected: expectedText(step) } : {}),
          ...(stateRef && stateToTurn.get(stateRef) ? { turn_id: stateToTurn.get(stateRef) } : {}),
        },
      ];
    });

  const byName = new Map<string, StudioSeed>();
  if (profileName && profile) {
    for (const binding of profile.context_variables) {
      byName.set(binding.name, {
        name: binding.name,
        ...(binding.type ? { type: binding.type } : {}),
        value: "[RESOLVED AT RUN]",
        provenance: `seed_profile:${profileName}`,
      });
    }
  }
  for (const step of steps.filter((candidate) => candidate.type === "agent.send_message")) {
    for (const seed of seedRows(step)) byName.set(seed.name, seed);
  }

  return {
    id: String(test.id ?? ""),
    name: String(test.id ?? ""),
    source_index: sourceIndex,
    projectable: blocking.length === 0,
    blocking_issues: [...new Set(blocking)],
    turns,
    evaluators,
    seeds: [...byName.values()],
    checkpoints,
  };
}

export function projectEvalSuite(value: unknown): StudioSuiteProjection {
  const spec = asSpec(value);
  if (!spec) {
    return {
      projectable: false,
      issues: ["EvalSpec must contain a tests array."],
      scenarios: [],
    };
  }
  const issues: string[] = evalResponseIntegrityPolicyIssues(spec).filter((issue) =>
    issue.startsWith("sf_pi.turn_response_integrity"),
  );
  const ids = spec.tests.map((test) => String(test?.id ?? ""));
  for (const id of new Set(ids)) {
    if (!id) issues.push("Every Scenario requires a non-empty id.");
    if (ids.filter((candidate) => candidate === id).length > 1) {
      issues.push(`Duplicate Scenario id '${id}'.`);
    }
  }
  const scenarios = spec.tests.map((test, index) =>
    projectScenario(test, index, spec.seed_profiles ?? {}, spec.sf_pi?.turn_response_integrity),
  );
  return {
    projectable:
      issues.length === 0 && scenarios.length > 0 && scenarios.every((row) => row.projectable),
    issues,
    scenarios,
  };
}

export function selectScenarioSpec(spec: EvalSpec, scenarioId: string): EvalSpec {
  const scenario = spec.tests.find((test) => test.id === scenarioId);
  if (!scenario) throw new Error(`Scenario '${scenarioId}' does not exist in this Eval Suite.`);
  const profileName = scenario.seed_profile;
  const profile = profileName ? spec.seed_profiles?.[profileName] : undefined;
  if (profileName && !profile) {
    throw new Error(`Scenario '${scenarioId}' references unknown seed profile '${profileName}'.`);
  }
  return {
    ...(spec.sf_pi ? { sf_pi: structuredClone(spec.sf_pi) } : {}),
    ...(profileName && profile
      ? { seed_profiles: { [profileName]: structuredClone(profile) } }
      : {}),
    tests: [structuredClone(scenario)],
  };
}
