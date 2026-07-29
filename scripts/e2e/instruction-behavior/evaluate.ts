/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic observable-fact evaluator for opt-in Instruction Behavior runs. */
export interface InstructionBehaviorScenario {
  id: string;
  prompt: string;
  expected_first_tools: string[];
  forbidden_tools?: string[];
}

export interface InstructionBehaviorObservation {
  calls: Array<{ tool: string; action?: string; context_only?: boolean }>;
}

export interface InstructionBehaviorScenarioResult {
  id: string;
  status: "passed" | "failed";
  first_tool?: string;
  observed_tools: string[];
  expected_first_tools: string[];
  forbidden_tools_observed: string[];
  facts: string[];
}

export function evaluateInstructionBehaviorScenario(
  scenario: InstructionBehaviorScenario,
  observation: InstructionBehaviorObservation,
): InstructionBehaviorScenarioResult {
  const observedTools = observation.calls.map((call) => call.tool);
  const localContextTools = new Set(["read", "grep", "find", "ls", "bash"]);
  const expectedLocalTool = scenario.expected_first_tools.some((tool) =>
    localContextTools.has(tool),
  );
  let ignoredPrefixCount = 0;
  if (!expectedLocalTool) {
    while (ignoredPrefixCount < observation.calls.length) {
      const call = observation.calls[ignoredPrefixCount];
      if (!call || (!call.context_only && !localContextTools.has(call.tool))) break;
      ignoredPrefixCount += 1;
    }
  }
  const firstTool = observedTools[ignoredPrefixCount];
  const forbidden = new Set(scenario.forbidden_tools ?? []);
  const forbiddenObserved = [
    ...new Set(
      observation.calls
        .filter((call) => !call.context_only && forbidden.has(call.tool))
        .map((call) => call.tool),
    ),
  ];
  const firstMatched = !!firstTool && scenario.expected_first_tools.includes(firstTool);
  const facts: string[] = [];
  if (ignoredPrefixCount > 0) {
    facts.push(
      `Ignored ${ignoredPrefixCount} leading local context tool${ignoredPrefixCount === 1 ? "" : "s"} before capability routing.`,
    );
  }
  if (firstMatched) facts.push("First tool matched the expected capability owner.");
  else if (!firstTool) facts.push("No tool call was observed.");
  else facts.push(`First tool '${firstTool}' did not match the expected capability owner.`);
  if (forbiddenObserved.length > 0) {
    facts.push(`Forbidden tools were observed: ${forbiddenObserved.join(", ")}.`);
  }

  return {
    id: scenario.id,
    status: firstMatched && forbiddenObserved.length === 0 ? "passed" : "failed",
    ...(firstTool ? { first_tool: firstTool } : {}),
    observed_tools: observedTools,
    expected_first_tools: [...scenario.expected_first_tools],
    forbidden_tools_observed: forbiddenObserved,
    facts,
  };
}
