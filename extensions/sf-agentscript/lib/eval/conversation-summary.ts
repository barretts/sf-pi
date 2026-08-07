/* SPDX-License-Identifier: Apache-2.0 */
/** Compact human replay model built from the complete Eval API response. */

import { buildLlmResponseSequence } from "../llm-response-sequence.ts";
import type { ConversationReplayScenario, ConversationReplayTurn } from "../render/conversation.ts";
import { buildUtteranceIndex } from "./persist.ts";
import type { EvalResponseIntegritySummary } from "./response-integrity.ts";
import type { EvalApiResponse, EvalOutput, EvalSpec, PlannerResponse } from "./types.ts";

export function buildEvalConversationSummaries(
  response: EvalApiResponse,
  spec: EvalSpec,
  integritySummary?: EvalResponseIntegritySummary,
): ConversationReplayScenario[] {
  const utterances = buildUtteranceIndex(spec);
  const integrityByTurn = new Map(
    (integritySummary?.observations ?? []).map((observation) => [
      `${observation.test_id}::${observation.turn_id}`,
      observation,
    ]),
  );
  const strict = spec.sf_pi?.turn_response_integrity?.severity === "error";
  return (response.results ?? []).map((test) => {
    const testId = String(test.id ?? "?");
    const outputs = test.outputs ?? [];
    const stateAfter = pairSendAndState(outputs);
    const turns: ConversationReplayTurn[] = [];
    let turnNumber = 0;
    for (let index = 0; index < outputs.length; index++) {
      const send = outputs[index];
      if (send.type !== "agent.send_message") continue;
      turnNumber++;
      const stateIndex = stateAfter.get(index);
      const state = stateIndex === undefined ? undefined : outputs[stateIndex];
      const plannerResponse = (
        state?.response as { planner_response?: PlannerResponse } | undefined
      )?.planner_response;
      const lastExecution = plannerResponse?.lastExecution;
      const agentResponse = finalResponse(send.response) ?? lastExecution?.agentResponse;
      const sequence = buildLlmResponseSequence(lastExecution?.llmEvents, agentResponse);
      const observed = integrityByTurn.get(`${testId}::${String(send.id ?? "")}`);
      turns.push({
        turn: turnNumber,
        user:
          (typeof send.utterance === "string" ? send.utterance : undefined) ??
          utterances.get(`${testId}::${String(send.id ?? "")}`),
        agent: agentResponse,
        topic: lastExecution?.topic,
        path: responsePath(
          sequence.events.map((event) => event.agent_name),
          lastExecution?.topic,
        ),
        latency_ms: lastExecution?.latency,
        integrity: observed?.status ?? sequence.integrity.status,
        llm_call_count: observed?.llm_call_count ?? sequence.llm_call_count,
        non_empty_content_count:
          observed?.non_empty_content_count ?? sequence.non_empty_content_count,
        ...((observed?.message ?? sequence.integrity.message)
          ? { integrity_message: observed?.message ?? sequence.integrity.message }
          : {}),
      });
    }
    const failed = (test.evaluation_results ?? []).some((result) => result.is_pass === false);
    const incomplete =
      (test.errors ?? []).length > 0 || turns.some((turn) => turn.integrity === "unavailable");
    const integrityFailed = strict && turns.some((turn) => turn.integrity === "warning");
    return {
      test_id: testId,
      verdict: failed || integrityFailed ? "failed" : incomplete ? "incomplete" : "passed",
      turns,
    };
  });
}

function pairSendAndState(outputs: EvalOutput[]): Map<number, number> {
  const stateAfter = new Map<number, number>();
  let lastSend = -1;
  for (let index = 0; index < outputs.length; index++) {
    if (outputs[index].type === "agent.send_message") lastSend = index;
    else if (
      outputs[index].type === "agent.get_state" &&
      lastSend !== -1 &&
      !stateAfter.has(lastSend)
    ) {
      stateAfter.set(lastSend, index);
    }
  }
  return stateAfter;
}

function finalResponse(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object" || !("messages" in value)) return undefined;
  return (value as { messages?: Array<{ message?: string }> }).messages?.[0]?.message;
}

function responsePath(agentNames: Array<string | undefined>, topic?: string): string[] {
  const path: string[] = [];
  for (const name of agentNames) {
    if (!name || path[path.length - 1] === name) continue;
    path.push(name);
  }
  if (topic && path.length === 0) path.push(topic);
  return path;
}
