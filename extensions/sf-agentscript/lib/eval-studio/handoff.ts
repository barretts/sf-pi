/* SPDX-License-Identifier: Apache-2.0 */
/** Compact authoring brief and editor-prefill handoff. */

import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

export type AuthoringAction = "new_suite" | "new_scenario" | "edit" | "diagnose";

export interface EvalAuthoringBrief {
  action: AuthoringAction;
  purpose: string;
  example_turns: string;
  proof_goals: string;
  seed_assumptions: string;
  suite_path?: string;
  scenario_id?: string;
}

export async function collectAuthoringBrief(
  ctx: ExtensionCommandContext,
  input: { action: AuthoringAction; suite_path?: string; scenario_id?: string },
): Promise<EvalAuthoringBrief | undefined> {
  const purpose = (
    await ctx.ui.input("Eval authoring · purpose", "What behavior should this prove?")
  )?.trim();
  if (!purpose) return undefined;
  const exampleTurns = (
    await ctx.ui.input("Example user turns", "Separate multiple turns with ->")
  )?.trim();
  if (exampleTurns === undefined) return undefined;
  const proofGoals = (
    await ctx.ui.input("Proof goals", "Expected behavior, topic, action, or state checkpoints")
  )?.trim();
  if (proofGoals === undefined) return undefined;
  const seeds = (
    await ctx.ui.input("Seed assumptions", "Scenario context variables or 'none'")
  )?.trim();
  if (seeds === undefined) return undefined;
  return {
    ...input,
    purpose,
    example_turns: exampleTurns,
    proof_goals: proofGoals,
    seed_assumptions: seeds,
  };
}

export function authoringHandoffPrompt(brief: EvalAuthoringBrief): string {
  const action = {
    new_suite: "Create a new Agent Script Eval Suite",
    new_scenario: "Add a new Scenario to the existing Agent Script Eval Suite",
    edit: "Edit the existing Agent Script Eval Suite",
    diagnose:
      "Diagnose the selected Agent Script Eval Suite or Scenario using its local Run evidence",
  }[brief.action];
  return [
    `${action}.`,
    "",
    "Use EvalSpec JSON as the only source-controlled format. Preserve unrelated Scenarios and source order. Compile one shared session with one or more ordered user turns and at least one live-proven evaluator. Do not fabricate expected Agent utterances; encode expected behavior as evaluator intent. Validate Studio projectability and run focused tests after editing.",
    "",
    "Authoring brief:",
    `- Purpose: ${brief.purpose}`,
    `- Example turns: ${brief.example_turns || "not supplied"}`,
    `- Proof goals: ${brief.proof_goals || "not supplied"}`,
    `- Seed assumptions: ${brief.seed_assumptions || "none"}`,
    ...(brief.suite_path ? [`- Suite path: ${brief.suite_path}`] : []),
    ...(brief.scenario_id ? [`- Scenario: ${brief.scenario_id}`] : []),
    "",
    brief.action === "diagnose"
      ? "Read the selected Run artifacts, distinguish execution state from evidence verdict, and propose the smallest source change. Do not execute or mutate live Salesforce data without a separate explicit request."
      : "Make the smallest source edit that satisfies this brief.",
  ].join("\n");
}

export async function handoffAuthoringBrief(
  ctx: ExtensionCommandContext,
  brief: EvalAuthoringBrief,
): Promise<void> {
  ctx.ui.setEditorText(authoringHandoffPrompt(brief));
  ctx.ui.notify(
    "Eval authoring brief is ready in the editor. Send it when ready; reopen Eval Studio manually afterward.",
    "info",
  );
}
