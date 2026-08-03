/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { authoringHandoffPrompt } from "../lib/eval-studio/handoff.ts";

describe("Eval Studio conversational handoff", () => {
  it("prefills a compact source-safe brief without becoming a second eval format", () => {
    const prompt = authoringHandoffPrompt({
      action: "new_scenario",
      purpose: "Prove a multi-turn clarification",
      example_turns: "I need help -> Here is the missing detail",
      proof_goals: "route correctly and preserve state",
      seed_assumptions: "verified=true",
      suite_path: "/project/tests/agentforce/Demo.eval.json",
      scenario_id: "clarification",
    });
    expect(prompt).toContain("EvalSpec JSON as the only source-controlled format");
    expect(prompt).toContain("one shared session");
    expect(prompt).toContain("Do not fabricate expected Agent utterances");
    expect(prompt).not.toContain("reopen Eval Studio manually");
    expect(prompt).not.toContain("YAML");
  });
});
