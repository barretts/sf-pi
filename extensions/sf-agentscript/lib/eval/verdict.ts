/* SPDX-License-Identifier: Apache-2.0 */
/** Strict, total interpretation of expected EvalSpec evidence. */

import { evaluatorCatalogEntry, type EvaluatorCapability } from "./evaluator-catalog.ts";
import { applyScoreThreshold } from "./threshold.ts";
import {
  summarizeEvalResponseIntegrity,
  type EvalResponseIntegritySummary,
} from "./response-integrity.ts";
import type { EvalApiResponse, EvalResult, EvalSpec, EvalTest, TestResult } from "./types.ts";

export const EVAL_VERDICT_SEMANTICS_VERSION = 2;

export type EvidenceVerdict = "passed" | "failed" | "incomplete" | "unverified";
export type EvalExecutionState =
  "running" | "completed" | "cancelled" | "interrupted" | "infrastructure_failed";

export interface EvaluatorEvidence {
  id: string;
  member_ids: string[];
  type?: string;
  capability: EvaluatorCapability;
  verdict: EvidenceVerdict;
  is_pass?: boolean | null;
  score?: number | null;
  expected_value?: string;
  actual_value?: string;
  error_message?: string;
  explainability?: string;
}

export interface ScenarioEvidence {
  id: string;
  verdict: EvidenceVerdict;
  evaluators: EvaluatorEvidence[];
  issues: string[];
}

export interface ResponseIntegrityEvidence {
  policy: NonNullable<NonNullable<EvalSpec["sf_pi"]>["turn_response_integrity"]>;
  verdict: EvidenceVerdict;
  summary: EvalResponseIntegritySummary;
  issues: string[];
}

export interface EvalVerdictResult {
  semantics_version: number;
  verdict: EvidenceVerdict;
  scenarios: ScenarioEvidence[];
  issues: string[];
  response_integrity?: ResponseIntegrityEvidence;
}

interface VerdictOptions {
  failedBatches?: number;
}

interface ExpectedEvaluator {
  id: string;
  type: string;
}

const OPT_RE = /^(.+)__opt\d+$/;

function verdictPrecedence(verdicts: Iterable<EvidenceVerdict>): EvidenceVerdict {
  const values = new Set(verdicts);
  if (values.has("incomplete")) return "incomplete";
  if (values.has("failed")) return "failed";
  if (values.has("unverified")) return "unverified";
  return "passed";
}

function expectedEvaluators(test: EvalTest): ExpectedEvaluator[] {
  return (test.steps ?? [])
    .filter((step) => step.type.startsWith("evaluator."))
    .map((step) => ({ id: String(step.id ?? ""), type: step.type }));
}

function classifyMember(
  expected: ExpectedEvaluator,
  actual: EvalResult | undefined,
): EvaluatorEvidence {
  const catalog = evaluatorCatalogEntry(expected.type || actual?.type);
  if (!actual) {
    return {
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type,
      capability: catalog.capability,
      verdict: "incomplete",
      error_message: "Expected evaluator result was not returned.",
    };
  }
  if (actual.error_message) {
    return {
      ...actual,
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type || actual.type,
      capability: catalog.capability,
      verdict: "incomplete",
    };
  }

  const thresholded = applyScoreThreshold({ ...actual, type: expected.type || actual.type });
  if (thresholded.error_message) {
    return {
      ...thresholded,
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type || actual.type,
      capability: catalog.capability,
      verdict: "incomplete",
    };
  }
  if (thresholded.is_pass === false) {
    return {
      ...thresholded,
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type || actual.type,
      capability: catalog.capability,
      verdict: "failed",
    };
  }
  if (catalog.capability !== "live_proven") {
    return {
      ...thresholded,
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type || actual.type,
      capability: catalog.capability,
      verdict: "unverified",
    };
  }
  if (thresholded.is_pass === true) {
    return {
      ...thresholded,
      id: expected.id,
      member_ids: [expected.id],
      type: expected.type || actual.type,
      capability: catalog.capability,
      verdict: "passed",
    };
  }
  return {
    ...thresholded,
    id: expected.id,
    member_ids: [expected.id],
    type: expected.type || actual.type,
    capability: catalog.capability,
    verdict: "unverified",
  };
}

function collapseAnyOf(evidence: EvaluatorEvidence[]): EvaluatorEvidence[] {
  const groups = new Map<string, EvaluatorEvidence[]>();
  const singles: EvaluatorEvidence[] = [];
  for (const item of evidence) {
    const match = OPT_RE.exec(item.id);
    if (!match) {
      singles.push(item);
      continue;
    }
    const members = groups.get(match[1]) ?? [];
    members.push(item);
    groups.set(match[1], members);
  }

  for (const [id, members] of groups) {
    let verdict: EvidenceVerdict;
    if (members.some((member) => member.verdict === "passed")) verdict = "passed";
    else if (members.some((member) => member.verdict === "incomplete")) verdict = "incomplete";
    else if (members.some((member) => member.verdict === "unverified")) verdict = "unverified";
    else verdict = "failed";
    const capability = members.every((member) => member.capability === "live_proven")
      ? "live_proven"
      : members.some((member) => member.capability === "candidate")
        ? "candidate"
        : "client_recognized";
    singles.push({
      id,
      member_ids: members.map((member) => member.id),
      type: "evaluator.any_of",
      capability,
      verdict,
      is_pass: verdict === "passed" ? true : verdict === "failed" ? false : null,
      score: verdict === "passed" ? 1 : verdict === "failed" ? 0 : null,
      explainability: `Any-of: ${members.map((member) => `${member.id}=${member.verdict}`).join(", ")}`,
    });
  }
  return singles;
}

function scenarioEvidence(expected: EvalTest, returned: TestResult | undefined): ScenarioEvidence {
  const issues: string[] = [];
  if (!returned) {
    return {
      id: expected.id,
      verdict: "incomplete",
      evaluators: [],
      issues: ["Expected scenario result was not returned."],
    };
  }

  const expectedRows = expectedEvaluators(expected);
  const expectedIds = expectedRows.map((entry) => entry.id);
  if (expectedRows.length === 0) issues.push("Scenario has no expected evaluator.");
  if (new Set(expectedIds).size !== expectedIds.length)
    issues.push("Duplicate expected evaluator id.");

  const actualRows = returned.evaluation_results ?? [];
  const actualById = new Map<string, EvalResult[]>();
  for (const actual of actualRows) {
    const id = String(actual.id ?? "");
    const rows = actualById.get(id) ?? [];
    rows.push(actual);
    actualById.set(id, rows);
  }
  for (const [id, rows] of actualById) {
    if (rows.length > 1) issues.push(`Duplicate evaluator result '${id}'.`);
    if (!expectedIds.includes(id)) issues.push(`Unexpected evaluator result '${id}'.`);
  }
  for (const error of returned.errors ?? []) {
    issues.push(
      `Step error${error.id ? ` '${error.id}'` : ""}: ${error.error_message ?? "unknown"}`,
    );
  }

  const members = expectedRows.map((entry) => classifyMember(entry, actualById.get(entry.id)?.[0]));
  const evaluators = collapseAnyOf(members);
  const verdict =
    issues.length > 0
      ? "incomplete"
      : verdictPrecedence(evaluators.map((evaluator) => evaluator.verdict));
  return { id: expected.id, verdict, evaluators, issues };
}

function responseIntegrityEvidence(
  spec: EvalSpec,
  response: EvalApiResponse,
): ResponseIntegrityEvidence | undefined {
  const policy = spec.sf_pi?.turn_response_integrity;
  if (!policy) return undefined;
  const summary = summarizeEvalResponseIntegrity(response, {
    maxNonEmptyContents: policy.max_nonempty_llm_contents,
  });
  const issues = summary.observations
    .filter((observation) => observation.status !== "pass")
    .map(
      (observation) =>
        `${observation.test_id}/${observation.turn_id}: ${observation.message ?? observation.status}`,
    );
  const verdict: EvidenceVerdict =
    summary.turns_unavailable > 0 ? "incomplete" : summary.turns_warning > 0 ? "failed" : "passed";
  return { policy, verdict, summary, issues };
}

export function deriveEvalVerdict(
  spec: EvalSpec,
  response: EvalApiResponse,
  options: VerdictOptions = {},
): EvalVerdictResult {
  const issues: string[] = [];
  if ((options.failedBatches ?? 0) > 0) issues.push(`${options.failedBatches} batch(es) failed.`);

  const expectedIds = (spec.tests ?? []).map((test) => test.id);
  if (new Set(expectedIds).size !== expectedIds.length)
    issues.push("Duplicate expected scenario id.");
  const actualById = new Map<string, TestResult[]>();
  for (const actual of response.results ?? []) {
    const id = String(actual.id ?? "");
    const rows = actualById.get(id) ?? [];
    rows.push(actual);
    actualById.set(id, rows);
  }
  for (const [id, rows] of actualById) {
    if (rows.length > 1) issues.push(`Duplicate scenario result '${id}'.`);
    if (!expectedIds.includes(id)) issues.push(`Unexpected scenario result '${id}'.`);
  }

  const scenarios = (spec.tests ?? []).map((test) =>
    scenarioEvidence(test, actualById.get(test.id)?.[0]),
  );
  const scenarioVerdict =
    issues.length > 0
      ? "incomplete"
      : verdictPrecedence(scenarios.map((scenario) => scenario.verdict));
  const responseIntegrity = responseIntegrityEvidence(spec, response);
  const verdict =
    responseIntegrity?.policy.severity === "error"
      ? verdictPrecedence([scenarioVerdict, responseIntegrity.verdict])
      : scenarioVerdict;
  return {
    semantics_version: EVAL_VERDICT_SEMANTICS_VERSION,
    verdict,
    scenarios,
    issues,
    ...(responseIntegrity ? { response_integrity: responseIntegrity } : {}),
  };
}
