/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import {
  summarizeEvalResponseIntegrity,
  validateEvalResponseIntegrityPolicy,
} from "../lib/eval/response-integrity.ts";
import type { EvalApiResponse } from "../lib/eval/types.ts";

function promptResponse(content: string, tool?: string): string {
  return JSON.stringify({
    content,
    tool_invocations: tool ? [{ function: { name: tool } }] : [],
  });
}

describe("summarizeEvalResponseIntegrity", () => {
  test("strict policy requires exactly one get_state after every send_message", () => {
    expect(() =>
      validateEvalResponseIntegrityPolicy({
        sf_pi: {
          turn_response_integrity: {
            max_nonempty_llm_contents: 1,
            severity: "error",
          },
        },
        tests: [
          {
            id: "missing_state",
            steps: [
              { type: "agent.create_session", id: "session" },
              { type: "agent.send_message", id: "turn1", utterance: "hello" },
              { type: "evaluator.string_assertion", id: "ok" },
            ],
          },
        ],
      }),
    ).toThrow(
      "missing_state/Strict response integrity requires exactly one agent.get_state after turn 'turn1'",
    );

    expect(() =>
      validateEvalResponseIntegrityPolicy({
        sf_pi: {
          turn_response_integrity: {
            max_nonempty_llm_contents: 1,
            severity: "error",
          },
        },
        tests: [
          {
            id: "observed",
            steps: [
              { type: "agent.create_session", id: "session" },
              { type: "agent.send_message", id: "turn1", utterance: "hello" },
              { type: "agent.get_state", id: "state1" },
              { type: "evaluator.string_assertion", id: "ok" },
            ],
          },
        ],
      }),
    ).not.toThrow();
  });

  test("warning policy permits missing get_state and invalid policy values fail", () => {
    expect(() =>
      validateEvalResponseIntegrityPolicy({
        sf_pi: {
          turn_response_integrity: {
            max_nonempty_llm_contents: 1,
            severity: "warning",
          },
        },
        tests: [
          {
            id: "advisory",
            steps: [{ type: "agent.send_message", id: "turn1", utterance: "hello" }],
          },
        ],
      }),
    ).not.toThrow();

    expect(() =>
      validateEvalResponseIntegrityPolicy({
        sf_pi: {
          turn_response_integrity: {
            max_nonempty_llm_contents: 0,
            severity: "error",
          },
        },
        tests: [],
      }),
    ).toThrow("max_nonempty_llm_contents");
  });

  test("summarizes warnings, passes, and unavailable turns without changing verdicts", () => {
    const response: EvalApiResponse = {
      results: [
        {
          id: "voice_flow",
          outputs: [
            { type: "agent.send_message", id: "turn1", response: "Final one" },
            {
              type: "agent.get_state",
              id: "state1",
              response: {
                planner_response: {
                  sessionProperties: { planId: "plan-1" },
                  lastExecution: {
                    agentResponse: "Final one",
                    llmEvents: [
                      [
                        { prompt_response: promptResponse("", "continue") },
                        { prompt_response: promptResponse("Intermediate") },
                        { prompt_response: promptResponse("Final one") },
                      ],
                    ],
                  },
                },
              } as never,
            },
            { type: "agent.send_message", id: "turn2", response: "Final two" },
            {
              type: "agent.get_state",
              id: "state2",
              response: {
                planner_response: {
                  sessionProperties: { planId: "plan-2" },
                  lastExecution: {
                    agentResponse: "Final two",
                    llmEvents: [[{ prompt_response: promptResponse("Final two") }]],
                  },
                },
              } as never,
            },
            { type: "agent.send_message", id: "turn3", response: "No state" },
          ],
          evaluation_results: [],
          errors: [],
        },
      ],
    };

    expect(summarizeEvalResponseIntegrity(response)).toEqual({
      turns_total: 3,
      turns_pass: 1,
      turns_warning: 1,
      turns_unavailable: 1,
      max_non_empty_content_count: 2,
      observations: [
        {
          test_id: "voice_flow",
          turn_id: "turn1",
          plan_id: "plan-1",
          status: "warning",
          llm_call_count: 3,
          non_empty_content_count: 2,
          message: "2 non-empty LLM completions exceed the configured maximum of 1.",
        },
        {
          test_id: "voice_flow",
          turn_id: "turn2",
          plan_id: "plan-2",
          status: "pass",
          llm_call_count: 1,
          non_empty_content_count: 1,
        },
        {
          test_id: "voice_flow",
          turn_id: "turn3",
          status: "unavailable",
          llm_call_count: 0,
          non_empty_content_count: 0,
          message: "No lastExecution.llmEvents evidence was available for this turn.",
        },
      ],
    });
  });
});
