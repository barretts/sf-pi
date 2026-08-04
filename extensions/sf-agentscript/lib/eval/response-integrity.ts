/* SPDX-License-Identifier: Apache-2.0 */
/** Advisory aggregate of per-turn LLM response-sequence evidence. */

import { buildLlmResponseSequence } from "../llm-response-sequence.ts";
import type { EvalApiResponse, PlannerResponse } from "./types.ts";

export interface ResponseIntegrityObservation {
  test_id: string;
  turn_id: string;
  plan_id?: string;
  status: "pass" | "warning" | "unavailable";
  llm_call_count: number;
  non_empty_content_count: number;
  message?: string;
}

export interface EvalResponseIntegritySummary {
  turns_total: number;
  turns_pass: number;
  turns_warning: number;
  turns_unavailable: number;
  max_non_empty_content_count: number;
  observations: ResponseIntegrityObservation[];
}

export function extractEvalTurnResponseSequences(
  response: EvalApiResponse,
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
        ),
      );
    }
  }
  return sequences;
}

export function summarizeEvalResponseIntegrity(
  response: EvalApiResponse,
): EvalResponseIntegritySummary {
  const observations: ResponseIntegrityObservation[] = [];
  const sequences = extractEvalTurnResponseSequences(response);
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
      const sequence =
        sequences.get(`${String(test.id ?? "?")}::${String(send.id ?? "")}`) ??
        buildLlmResponseSequence(undefined, finalResponse(send.response));
      observations.push({
        test_id: String(test.id ?? "?"),
        turn_id: String(send.id ?? ""),
        ...((plannerResponse?.sessionProperties as { planId?: string } | undefined)?.planId
          ? {
              plan_id: (plannerResponse?.sessionProperties as { planId?: string }).planId,
            }
          : {}),
        status: sequence.integrity.status,
        llm_call_count: sequence.llm_call_count,
        non_empty_content_count: sequence.non_empty_content_count,
        ...(sequence.integrity.message ? { message: sequence.integrity.message } : {}),
      });
    }
  }

  return {
    turns_total: observations.length,
    turns_pass: observations.filter((row) => row.status === "pass").length,
    turns_warning: observations.filter((row) => row.status === "warning").length,
    turns_unavailable: observations.filter((row) => row.status === "unavailable").length,
    max_non_empty_content_count: observations.reduce(
      (maximum, row) => Math.max(maximum, row.non_empty_content_count),
      0,
    ),
    observations,
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
