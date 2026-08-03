/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { projectEvalSuite, selectScenarioSpec } from "../lib/eval-studio/projectability.ts";

const valid = {
  tests: [
    {
      id: "refund_follow_up",
      steps: [
        { type: "agent.create_session", id: "session" },
        {
          type: "agent.send_message",
          id: "turn1",
          utterance: "I need a refund",
          context_variables: [{ name: "verified_check", type: "boolean", value: true }],
        },
        { type: "agent.get_state", id: "state1" },
        { type: "agent.send_message", id: "turn2", utterance: "What happens next?" },
        {
          type: "evaluator.string_assertion",
          id: "refund_guidance",
          actual: "{turn2.response}",
          expected: "explains next steps",
        },
        { type: "agent.end_session", id: "end" },
      ],
    },
  ],
};

describe("Eval Studio projectability", () => {
  it("projects a multi-turn shared-session scenario with evaluator scope and seeds", () => {
    const result = projectEvalSuite(valid);
    expect(result.projectable).toBe(true);
    expect(result.scenarios).toHaveLength(1);
    expect(result.scenarios[0]).toMatchObject({
      id: "refund_follow_up",
      turns: [
        { id: "turn1", utterance: "I need a refund" },
        { id: "turn2", utterance: "What happens next?" },
      ],
      evaluators: [
        { id: "refund_guidance", scope: "turn", turn_id: "turn2", expected: "explains next steps" },
      ],
      seeds: [{ name: "verified_check", value: true, provenance: "turn1" }],
    });
  });

  it("keeps unprojectable entries visible with blocking reasons", () => {
    const result = projectEvalSuite({
      tests: [
        { id: "empty", steps: [{ type: "agent.create_session", id: "session" }] },
        {
          id: "unknown",
          steps: [
            { type: "agent.create_session", id: "s" },
            { type: "agent.send_message", id: "t", utterance: "hello" },
            { type: "agent.magic", id: "magic" },
            { type: "evaluator.string_assertion", id: "e" },
          ],
        },
      ],
    });
    expect(result.projectable).toBe(false);
    expect(result.scenarios.map((scenario) => scenario.id)).toEqual(["empty", "unknown"]);
    expect(result.scenarios[0]?.blocking_issues).toContain(
      "Scenario requires at least one user turn.",
    );
    expect(result.scenarios[1]?.blocking_issues).toContain("Unsupported step type 'agent.magic'.");
  });

  it("rejects duplicate ids and malformed structural shapes without throwing", () => {
    const result = projectEvalSuite({
      tests: [
        { id: "dup", steps: [] },
        { id: "dup", steps: [] },
      ],
    });
    expect(result.projectable).toBe(false);
    expect(result.issues).toContain("Duplicate Scenario id 'dup'.");
    expect(projectEvalSuite({ nope: true }).issues).toContain(
      "EvalSpec must contain a tests array.",
    );
  });

  it("blocks missing step ids and ambiguous send/state pairing", () => {
    const result = projectEvalSuite({
      tests: [
        {
          id: "ambiguous",
          steps: [
            { type: "agent.create_session", id: "session" },
            { type: "agent.send_message", id: "turn", utterance: "hello" },
            { type: "agent.get_state", id: "state1" },
            { type: "agent.get_state", id: "state2" },
            { type: "evaluator.string_assertion", id: "" },
          ],
        },
      ],
    });
    expect(result.projectable).toBe(false);
    expect(result.scenarios[0]?.blocking_issues).toContain("Every step requires a non-empty id.");
    expect(result.scenarios[0]?.blocking_issues).toContain(
      "Turn 'turn' has ambiguous multiple agent.get_state steps.",
    );
  });

  it("selects one Scenario without mutating the source Suite", () => {
    const source = { ...valid, tests: [...valid.tests, { ...valid.tests[0], id: "other" }] };
    const selected = selectScenarioSpec(source, "other");
    expect(selected.tests.map((test) => test.id)).toEqual(["other"]);
    expect(source.tests).toHaveLength(2);
    expect(() => selectScenarioSpec(source, "missing")).toThrow("Scenario 'missing'");
  });
});
