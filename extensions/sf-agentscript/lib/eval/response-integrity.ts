/* SPDX-License-Identifier: Apache-2.0 */
/** Advisory aggregate of per-turn LLM response-sequence evidence. */

import { buildLlmResponseSequence } from "../llm-response-sequence.ts";
import type {
  EvalApiResponse,
  EvalSpec,
  EvalTest,
  PlannerResponse,
  TurnResponseIntegrityPolicy,
} from "./types.ts";

export interface ResponseIntegrityObservation {
  test_id: string;
  turn_id: string;
  plan_id?: string;
  status: "pass" | "warning" | "unavailable";
  llm_call_count: number;
  non_empty_content_count: number;
  raw_llm_event_count?: number;
  physical_llm_call_count?: number;
  raw_non_empty_content_count?: number;
  physical_non_empty_content_count?: number;
  mirrored_alias_count?: number;
  surface_repeat_count?: number;
  surface_repeat_preview?: string;
  message?: string;
}

export interface EvalResponseIntegritySummary {
  turns_total: number;
  turns_pass: number;
  turns_warning: number;
  turns_unavailable: number;
  max_non_empty_content_count: number;
  surface_repeated_turns?: number;
  mirrored_aliases?: number;
  observations: ResponseIntegrityObservation[];
}

export function responseIntegrityScenarioIssues(
  test: EvalTest,
  policy: TurnResponseIntegrityPolicy | undefined,
): string[] {
  if (!policy || policy.severity !== "error") return [];
  const issues: string[] = [];
  let currentTurn: string | undefined;
  let stateCount = 0;
  const finishTurn = (): void => {
    if (currentTurn !== undefined && stateCount !== 1) {
      issues.push(
        `Strict response integrity requires exactly one agent.get_state after turn '${currentTurn}'; found ${stateCount}.`,
      );
    }
  };
  for (const step of test.steps ?? []) {
    if (step.type === "agent.send_message") {
      finishTurn();
      currentTurn = String(step.id ?? "");
      stateCount = 0;
    } else if (step.type === "agent.get_state" && currentTurn !== undefined) {
      stateCount++;
    }
  }
  finishTurn();
  return issues;
}

export function evalResponseIntegrityPolicyIssues(spec: EvalSpec): string[] {
  const policy = spec.sf_pi?.turn_response_integrity;
  if (!policy) return [];
  const issues: string[] = [];
  if (
    !Number.isInteger(policy.max_nonempty_llm_contents) ||
    policy.max_nonempty_llm_contents < 1 ||
    policy.max_nonempty_llm_contents > 100
  ) {
    issues.push(
      "sf_pi.turn_response_integrity.max_nonempty_llm_contents must be an integer from 1 through 100.",
    );
  }
  if (policy.severity !== "warning" && policy.severity !== "error") {
    issues.push("sf_pi.turn_response_integrity.severity must be 'warning' or 'error'.");
  }
  if (issues.length === 0) {
    for (const test of spec.tests ?? []) {
      issues.push(
        ...responseIntegrityScenarioIssues(test, policy).map(
          (issue) => `${String(test.id ?? "?")}/${issue}`,
        ),
      );
    }
  }
  return issues;
}

export function hasStrictResponseIntegrity(spec: EvalSpec | undefined): boolean {
  const policy = spec?.sf_pi?.turn_response_integrity;
  return policy?.severity === "error" && policy.max_nonempty_llm_contents === 1;
}

export function designatedVoiceReleaseIntegrityIssue(
  generated: EvalSpec,
  designated: EvalSpec | undefined,
): string | undefined {
  if (!hasStrictResponseIntegrity(generated) || !designated) return undefined;
  if (hasStrictResponseIntegrity(designated)) return undefined;
  return "Designated Voice release spec must declare strict turn response integrity.";
}

export function validateEvalResponseIntegrityPolicy(spec: EvalSpec): void {
  const issues = evalResponseIntegrityPolicyIssues(spec);
  if (issues.length > 0) {
    throw new Error(`Eval response-integrity policy invalid:\n- ${issues.join("\n- ")}`);
  }
}

export function extractEvalTurnResponseSequences(
  response: EvalApiResponse,
  options: { maxNonEmptyContents?: number } = {},
): Map<string, ReturnType<typeof buildLlmResponseSequence>> {
  const sequences = new Map<string, ReturnType<typeof buildLlmResponseSequence>>();
  for (const test of response.results ?? []) {
    const outputs = test.outputs ?? [];
    const stateAfter = pairSendAndState(outputs);
    for (let index = 0; index < outputs.length; index++) {
      const send = outputs[index];
      if (send.type !== "agent.send_message") continue;
      const stateIndex = stateAfter.get(index);
      const state = stateIndex === undefined ? undefined : outputs[stateIndex];
      const plannerResponse = (
        state?.response as { planner_response?: PlannerResponse } | undefined
      )?.planner_response;
      const lastExecution = plannerResponse?.lastExecution;
      sequences.set(
        `${String(test.id ?? "?")}::${String(send.id ?? "")}`,
        buildLlmResponseSequence(
          lastExecution?.llmEvents,
          finalResponse(send.response) ?? lastExecution?.agentResponse,
          options,
        ),
      );
    }
  }
  return sequences;
}

export function summarizeEvalResponseIntegrity(
  response: EvalApiResponse,
  options: { maxNonEmptyContents?: number } = {},
): EvalResponseIntegritySummary {
  const observations: ResponseIntegrityObservation[] = [];
  const sequences = extractEvalTurnResponseSequences(response, options);
  for (const test of response.results ?? []) {
    const outputs = test.outputs ?? [];
    const stateAfter = pairSendAndState(outputs);
    for (let index = 0; index < outputs.length; index++) {
      const send = outputs[index];
      if (send.type !== "agent.send_message") continue;
      const stateIndex = stateAfter.get(index);
      const state = stateIndex === undefined ? undefined : outputs[stateIndex];
      const plannerResponse = (
        state?.response as { planner_response?: PlannerResponse } | undefined
      )?.planner_response;
      const lastExecution = plannerResponse?.lastExecution;
      const surface = finalResponse(send.response) ?? lastExecution?.agentResponse;
      const sequence =
        sequences.get(`${String(test.id ?? "?")}::${String(send.id ?? "")}`) ??
        buildLlmResponseSequence(undefined, surface, options);
      const repeated = repeatedSurfaceSegments(surface);
      const status =
        sequence.integrity.status === "unavailable"
          ? "unavailable"
          : repeated.count > 0
            ? "warning"
            : sequence.integrity.status;
      const messages = [
        sequence.integrity.message,
        repeated.count > 0
          ? `${repeated.count} repeated surface segment${repeated.count === 1 ? "" : "s"} detected.`
          : undefined,
      ].filter((message): message is string => Boolean(message));
      observations.push({
        test_id: String(test.id ?? "?"),
        turn_id: String(send.id ?? ""),
        ...((plannerResponse?.sessionProperties as { planId?: string } | undefined)?.planId
          ? {
              plan_id: (plannerResponse?.sessionProperties as { planId?: string }).planId,
            }
          : {}),
        status,
        llm_call_count: sequence.llm_call_count,
        non_empty_content_count: sequence.non_empty_content_count,
        ...(sequence.mirrored_alias_count > 0
          ? {
              raw_llm_event_count: sequence.raw_llm_event_count,
              physical_llm_call_count: sequence.physical_llm_call_count,
              raw_non_empty_content_count: sequence.raw_non_empty_content_count,
              physical_non_empty_content_count: sequence.physical_non_empty_content_count,
              mirrored_alias_count: sequence.mirrored_alias_count,
            }
          : {}),
        ...(repeated.count > 0
          ? {
              surface_repeat_count: repeated.count,
              surface_repeat_preview: repeated.preview,
            }
          : {}),
        ...(messages.length > 0
          ? { message: messages.join(" ") }
          : sequence.integrity.status === "unavailable" && repeated.count === 0
            ? { message: sequence.integrity.message }
            : {}),
      });
    }
  }

  const mirroredAliases = observations.reduce(
    (sum, row) => sum + (row.mirrored_alias_count ?? 0),
    0,
  );

  return {
    turns_total: observations.length,
    turns_pass: observations.filter((row) => row.status === "pass").length,
    turns_warning: observations.filter((row) => row.status === "warning").length,
    turns_unavailable: observations.filter((row) => row.status === "unavailable").length,
    max_non_empty_content_count: observations.reduce(
      (maximum, row) => Math.max(maximum, row.non_empty_content_count),
      0,
    ),
    surface_repeated_turns: observations.filter((row) => (row.surface_repeat_count ?? 0) > 0)
      .length,
    ...(mirroredAliases > 0 ? { mirrored_aliases: mirroredAliases } : {}),
    observations,
  };
}

function repeatedSurfaceSegments(value: string | undefined): {
  count: number;
  preview?: string;
} {
  if (!value) return { count: 0 };
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  const rawSegments = [...segmenter.segment(value)].map((row) => row.segment);
  const seen = new Map<string, { count: number; preview: string }>();
  for (const raw of rawSegments) {
    const preview = raw.normalize("NFKC").replace(/\s+/g, " ").trim();
    if (!preview) continue;
    const key = preview;
    const current = seen.get(key) ?? { count: 0, preview };
    current.count++;
    seen.set(key, current);
  }
  const repeated = [...seen.values()]
    .filter((row) => row.count > 1)
    .sort((a, b) => b.count - a.count || b.preview.length - a.preview.length);
  return {
    count: repeated.reduce((sum, row) => sum + row.count - 1, 0),
    ...(repeated[0] ? { preview: repeated[0].preview } : {}),
  };
}

function pairSendAndState(outputs: Array<{ type?: string }>): Map<number, number> {
  const stateAfter = new Map<number, number>();
  let lastSendIndex = -1;
  for (let index = 0; index < outputs.length; index++) {
    const output = outputs[index];
    if (output.type === "agent.send_message") {
      lastSendIndex = index;
    } else if (
      output.type === "agent.get_state" &&
      lastSendIndex !== -1 &&
      !stateAfter.has(lastSendIndex)
    ) {
      stateAfter.set(lastSendIndex, index);
    }
  }
  return stateAfter;
}

function finalResponse(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("messages" in value)) return undefined;
  const messages = (value as { messages?: Array<{ message?: string }> }).messages;
  return messages?.[0]?.message;
}
