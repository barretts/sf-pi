/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { evaluateInstructionBehaviorScenario } from "../../../scripts/e2e/instruction-behavior/evaluate.ts";

describe("Instruction Behavior Eval", () => {
  it("reports observable routing facts without assigning a quality score", () => {
    const result = evaluateInstructionBehaviorScenario(
      {
        id: "apex-fix",
        prompt: "Fix Apex behavior.",
        expected_first_tools: ["sf_apex"],
        forbidden_tools: ["bash"],
      },
      { calls: [{ tool: "sf_apex", action: "test.plan" }] },
    );

    expect(result).toEqual({
      id: "apex-fix",
      status: "passed",
      first_tool: "sf_apex",
      observed_tools: ["sf_apex"],
      expected_first_tools: ["sf_apex"],
      forbidden_tools_observed: [],
      facts: ["First tool matched the expected capability owner."],
    });
    expect(result).not.toHaveProperty("score");
  });

  it("treats leading local context reads as preparation for a Salesforce capability call", () => {
    const result = evaluateInstructionBehaviorScenario(
      {
        id: "docs",
        prompt: "Find official docs.",
        expected_first_tools: ["sf_docs"],
      },
      {
        calls: [
          { tool: "bash", context_only: true },
          { tool: "read" },
          { tool: "sf_docs", action: "search" },
        ],
      },
    );

    expect(result).toMatchObject({
      status: "passed",
      first_tool: "sf_docs",
      observed_tools: ["bash", "read", "sf_docs"],
    });
    expect(result.facts).toContain(
      "Ignored 2 leading local context tools before capability routing.",
    );
  });
});
