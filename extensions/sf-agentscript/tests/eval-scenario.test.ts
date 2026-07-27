/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { compileEvalScenario } from "../lib/eval/scenario.ts";

describe("compileEvalScenario", () => {
  test("compiles ordered same-session turns with typed state checkpoints", () => {
    const testCase = compileEvalScenario(
      {
        id: "connected_after_response",
        turns: [
          {
            utterance: "Run the connected helper.",
            state: [
              { id: "completed_turn1", variable: "completed", expected: true },
              { id: "attempts_turn1", variable: "attempts", expected: 1 },
              { id: "status_turn1", variable: "status", expected: "done" },
            ],
          },
          {
            utterance: "What is the status now?",
            response: {
              id: "second_turn_branch",
              rubric: "Report that the helper already completed.",
            },
            state: [{ id: "attempts_turn2", variable: "attempts", expected: 1 }],
          },
        ],
      },
      [{ name: "verified", type: "Boolean", value: "true" }],
    );

    expect(testCase.id).toBe("connected_after_response");
    expect(testCase.steps.map((step) => step.type)).toEqual([
      "agent.create_session",
      "agent.send_message",
      "agent.get_state",
      "evaluator.numeric_assertion",
      "evaluator.numeric_assertion",
      "evaluator.string_assertion",
      "agent.send_message",
      "agent.get_state",
      "evaluator.bot_response_rating",
      "evaluator.numeric_assertion",
    ]);
    expect(testCase.steps[1]).toMatchObject({
      id: "turn1",
      session_id: "$.outputs[0].session_id",
      context_variables: [{ name: "verified", type: "Boolean", value: "true" }],
    });
    expect(testCase.steps[3]).toMatchObject({
      actual: "{state1.response.planner_response.sessionContext.stateVariables.completed}",
      expected: 1,
    });
    expect(testCase.steps[5]).toMatchObject({ expected: "done" });
    expect(testCase.steps[6]).toMatchObject({ id: "turn2", session_id: "$.outputs[0].session_id" });
    expect(testCase.steps[8]).toMatchObject({ actual: "{turn2.response}" });
  });
});
