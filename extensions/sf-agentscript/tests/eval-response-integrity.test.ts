/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import {
  designatedVoiceReleaseIntegrityIssue,
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
  test("Voice release contracts refuse a weak designated suite", () => {
    const generated = {
      sf_pi: {
        turn_response_integrity: {
          max_nonempty_llm_contents: 1,
          severity: "error" as const,
        },
      },
      tests: [],
    };
    expect(designatedVoiceReleaseIntegrityIssue(generated, { tests: [] })).toMatch(
      /must declare strict turn response integrity/,
    );
    expect(designatedVoiceReleaseIntegrityIssue(generated, generated)).toBeUndefined();
    expect(
      designatedVoiceReleaseIntegrityIssue(generated, {
        sf_pi: {
          turn_response_integrity: {
            max_nonempty_llm_contents: 2,
            severity: "error",
          },
        },
        tests: [],
      }),
    ).toMatch(/must declare strict/);
    expect(designatedVoiceReleaseIntegrityIssue({ tests: [] }, { tests: [] })).toBeUndefined();
  });

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

  test("detects exact repeated surface sentences even when llmEvents are unavailable", () => {
    const repeated =
      "I can connect you with a specialist — would you like that? " +
      "I can connect you with a specialist — would you like that?";
    const response: EvalApiResponse = {
      results: [
        {
          id: "voice_repeat",
          outputs: [{ type: "agent.send_message", id: "turn1", response: repeated }],
          evaluation_results: [],
          errors: [],
        },
      ],
    };

    expect(summarizeEvalResponseIntegrity(response)).toMatchObject({
      turns_total: 1,
      turns_pass: 0,
      turns_warning: 0,
      turns_unavailable: 1,
      surface_repeated_turns: 1,
      observations: [
        {
          test_id: "voice_repeat",
          turn_id: "turn1",
          status: "unavailable",
          llm_call_count: 0,
          non_empty_content_count: 0,
          surface_repeat_count: 1,
          surface_repeat_preview: "I can connect you with a specialist — would you like that?",
        },
      ],
    });
  });

  test("surface repeat detection is exact and supports short sentences", () => {
    const summarize = (response: string) =>
      summarizeEvalResponseIntegrity({
        results: [
          {
            id: "surface",
            outputs: [{ type: "agent.send_message", id: "turn1", response }],
          },
        ],
      });
    expect(summarize("Yes. Yes.").surface_repeated_turns).toBe(1);
    expect(summarize("No, thank you. No thank you?").surface_repeated_turns).toBe(0);
    expect(summarize("The value is 1.5. The value is 1.6.").surface_repeated_turns).toBe(0);
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
      surface_repeated_turns: 0,
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
