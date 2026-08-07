/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { buildEvalConversationSummaries } from "../lib/eval/conversation-summary.ts";
import type { EvalApiResponse, EvalSpec } from "../lib/eval/types.ts";

const spec: EvalSpec = {
  sf_pi: {
    turn_response_integrity: {
      max_nonempty_llm_contents: 1,
      severity: "error",
    },
  },
  tests: [
    {
      id: "voice_loop",
      steps: [
        { type: "agent.send_message", id: "turn1", utterance: "Weekend appointments?" },
        { type: "agent.get_state", id: "state1" },
      ],
    },
  ],
};

const response: EvalApiResponse = {
  results: [
    {
      id: "voice_loop",
      outputs: [
        { type: "agent.send_message", id: "turn1", response: "Repeated. Repeated." },
        {
          type: "agent.get_state",
          id: "state1",
          response: {
            planner_response: {
              lastExecution: {
                topic: "transfer",
                latency: 1200,
                agentResponse: "Repeated. Repeated.",
                llmEvents: [
                  [
                    {
                      agent_name: "Transfer",
                      prompt_response: JSON.stringify({ content: "Repeated." }),
                    },
                    {
                      agent_name: "Agent Router",
                      prompt_response: JSON.stringify({ content: "" }),
                    },
                    {
                      agent_name: "Transfer",
                      prompt_response: JSON.stringify({ content: "Repeated." }),
                    },
                  ],
                ],
              },
            },
          },
        },
      ],
      evaluation_results: [{ id: "surface", is_pass: true }],
      errors: [],
    },
  ],
};

describe("buildEvalConversationSummaries", () => {
  test("uses canonical strict integrity evidence for replay verdicts and paths", () => {
    const summaries = buildEvalConversationSummaries(response, spec, {
      turns_total: 1,
      turns_pass: 0,
      turns_warning: 1,
      turns_unavailable: 0,
      max_non_empty_content_count: 2,
      surface_repeated_turns: 1,
      observations: [
        {
          test_id: "voice_loop",
          turn_id: "turn1",
          status: "warning",
          llm_call_count: 3,
          non_empty_content_count: 2,
          surface_repeat_count: 1,
          message: "2 non-empty completions; repeated surface segment.",
        },
      ],
    });
    expect(summaries).toEqual([
      expect.objectContaining({
        test_id: "voice_loop",
        verdict: "failed",
        turns: [
          expect.objectContaining({
            turn: 1,
            user: "Weekend appointments?",
            agent: "Repeated. Repeated.",
            path: ["Transfer", "Agent Router", "Transfer"],
            integrity: "warning",
            integrity_message: "2 non-empty completions; repeated surface segment.",
          }),
        ],
      }),
    ]);
  });
});
