/* SPDX-License-Identifier: Apache-2.0 */
/** Canonical metadata for the native Agent Script quality rule catalog. */

export type AgentScriptQualitySeverity = "high" | "moderate" | "low" | "info" | "metric";
export type AgentScriptQualityCategory =
  "flow" | "actions" | "types" | "maintainability" | "metric";

export interface AgentScriptQualityRuleDefinition {
  id: string;
  name: string;
  description: string;
  severity: AgentScriptQualitySeverity;
  category: AgentScriptQualityCategory;
  defaultEnabled: boolean;
  maturity: "stable" | "experimental";
  runsAtEditTime: boolean;
  participatesInRepair: boolean;
  participatesInPublishGate: boolean;
  suppressible: boolean;
}

function rule(
  definition: Omit<AgentScriptQualityRuleDefinition, "defaultEnabled" | "maturity"> &
    Partial<Pick<AgentScriptQualityRuleDefinition, "defaultEnabled" | "maturity">>,
): AgentScriptQualityRuleDefinition {
  return { defaultEnabled: true, maturity: "stable", ...definition };
}

export const AGENT_SCRIPT_QUALITY_RULES = [
  rule({
    id: "unconditional-transition-cycle",
    name: "Endless Transition Loop",
    description:
      "Detects cycles composed entirely of unconditional deterministic one-way transitions.",
    severity: "high",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: true,
    suppressible: false,
  }),
  rule({
    id: "slot-filling-in-deterministic-action",
    name: "Deterministic Action Cannot Use Slot Filling",
    description:
      "Detects ellipsis slot filling in deterministic runs where no LLM step can supply a value.",
    severity: "high",
    category: "actions",
    runsAtEditTime: true,
    participatesInRepair: true,
    participatesInPublishGate: true,
    suppressible: false,
  }),
  rule({
    id: "deterministic-action-missing-input",
    name: "Required Action Input Is Missing",
    description: "Detects deterministic action calls that omit a required input without a default.",
    severity: "high",
    category: "actions",
    runsAtEditTime: true,
    participatesInRepair: true,
    participatesInPublishGate: true,
    suppressible: false,
  }),
  rule({
    id: "deterministic-action-unknown-input",
    name: "Unknown Action Input",
    description:
      "Detects deterministic with-bindings that do not exist in the scoped action signature.",
    severity: "high",
    category: "actions",
    runsAtEditTime: true,
    participatesInRepair: true,
    participatesInPublishGate: true,
    suppressible: false,
  }),
  rule({
    id: "action-chain-too-deep",
    name: "Action Chain Is Too Deep",
    description:
      "Detects action callback chains that exceed the supported one-level nesting limit.",
    severity: "high",
    category: "actions",
    runsAtEditTime: true,
    participatesInRepair: true,
    participatesInPublishGate: true,
    suppressible: false,
  }),
  rule({
    id: "unreachable-subagent",
    name: "Unreachable Subagent",
    description: "Detects non-start subagents with no supported incoming flow edge.",
    severity: "moderate",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "unused-action",
    name: "Unused Action",
    description: "Detects action definitions with no supported scoped invocation reference.",
    severity: "moderate",
    category: "maintainability",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "discarded-prompt-before-transition",
    name: "Discarded Prompt",
    description: "Detects prompt content guaranteed to be discarded by a deterministic transition.",
    severity: "moderate",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "list-element-type-mismatch",
    name: "Wrong Value Type in List",
    description: "Detects literal list values that conflict with the declared element type.",
    severity: "moderate",
    category: "types",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "non-numeric-list-index",
    name: "List Index Must Be a Number",
    description: "Detects statically known nonnumeric indexes applied to known lists.",
    severity: "moderate",
    category: "types",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "slot-filled-variable-missing-description",
    name: "Slot-Filled Variable Needs a Description",
    description:
      "Detects slot-filled variables that do not describe the value the LLM should capture.",
    severity: "moderate",
    category: "actions",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "deterministic-action-input-type-mismatch",
    name: "Wrong Action Input Type",
    description: "Detects known deterministic action inputs with incompatible types.",
    severity: "moderate",
    category: "types",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "deterministic-action-output-type-mismatch",
    name: "Wrong Action Output Type",
    description: "Detects known action outputs assigned to incompatible mutable variables.",
    severity: "moderate",
    category: "types",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "prompt-template-output-flags",
    name: "Prompt Template Output Flags",
    description:
      "Advises when an intermediate prompt response lacks the common planner-use and display flags.",
    severity: "moderate",
    category: "actions",
    runsAtEditTime: false,
    participatesInRepair: true,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "action-before-transition",
    name: "Action Before Transition",
    description: "Advises when an action executes before a guaranteed transition.",
    severity: "low",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: false,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "conditional-transition-cycle",
    name: "Conditional Transition Loop",
    description: "Reports transition cycles that contain one or more conditions.",
    severity: "info",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: false,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "subagent-delegation-cycle",
    name: "Subagent Call Cycle",
    description: "Reports recursive topology through returning direct subagent calls.",
    severity: "info",
    category: "flow",
    runsAtEditTime: false,
    participatesInRepair: false,
    participatesInPublishGate: false,
    suppressible: true,
  }),
  rule({
    id: "cyclomatic-complexity",
    name: "Cyclomatic Complexity",
    description: "Measures deterministic decision complexity per Agent Script procedure.",
    severity: "metric",
    category: "metric",
    runsAtEditTime: false,
    participatesInRepair: false,
    participatesInPublishGate: false,
    suppressible: false,
  }),
] as const satisfies readonly AgentScriptQualityRuleDefinition[];

export type AgentScriptQualityRuleId = (typeof AGENT_SCRIPT_QUALITY_RULES)[number]["id"];

export const AGENT_SCRIPT_QUALITY_RULE_IDS = AGENT_SCRIPT_QUALITY_RULES.map(
  (definition) => definition.id,
) as AgentScriptQualityRuleId[];

const RULE_BY_ID = new Map(
  AGENT_SCRIPT_QUALITY_RULES.map((definition) => [definition.id, definition]),
);

export function qualityRuleById(
  id: string,
): (typeof AGENT_SCRIPT_QUALITY_RULES)[number] | undefined {
  return RULE_BY_ID.get(id as AgentScriptQualityRuleId);
}

export function isAgentScriptQualityRuleId(id: string): id is AgentScriptQualityRuleId {
  return RULE_BY_ID.has(id as AgentScriptQualityRuleId);
}
