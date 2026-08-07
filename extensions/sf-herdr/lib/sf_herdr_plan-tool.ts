/* SPDX-License-Identifier: Apache-2.0 */
/** Minimal non-mutating planner for the current split Herdr tools. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";

import {
  HERDR_PLAN_INTENTS,
  HERDR_WORKFLOWS,
  type HerdrPlanIntent,
  type HerdrWorkflow,
} from "../../../lib/common/herdr.ts";
import { readSfHerdrSettings, type HerdrLifecycle, type SfHerdrSettings } from "./settings.ts";

export const SF_HERDR_PLAN_TOOL_NAME = "sf_herdr_plan";

export const SfHerdrPlanParams = Type.Object({
  intent: StringEnum(HERDR_PLAN_INTENTS, {
    description: "Explicit workflow intent to run in a Herdr pane.",
  }),
  primaryWorkflow: StringEnum(HERDR_WORKFLOWS, {
    description: "Owning Salesforce workflow. Required; SF Herdr does not infer workflows.",
  }),
});

export interface SfHerdrPlanInput {
  intent: HerdrPlanIntent;
  primaryWorkflow: HerdrWorkflow;
}

interface ResultReference {
  stepId: "split";
  path: "details.pane.pane_id";
}

interface PlanStepBase {
  id: string;
  arguments: Record<string, string | boolean | number>;
  argumentBindings?: Partial<Record<"pane" | "target", ResultReference>>;
  callerSupplies?: string[];
  purpose: string;
  when?: "observed_success_only";
}

type HerdrPlanStep =
  | (PlanStepBase & { tool: "herdr_layout"; action: "pane_split" })
  | (PlanStepBase & {
      tool: "herdr_pane";
      action: "run" | "wait_output" | "read" | "close";
    })
  | (PlanStepBase & {
      tool: "herdr_agent";
      action: "start" | "prompt" | "read";
    });

export interface SfHerdrPlan {
  intent: HerdrPlanIntent;
  primaryWorkflow: HerdrWorkflow;
  lifecycle: HerdrLifecycle;
  steps: HerdrPlanStep[];
  failureOrTimeout: "leave_open_for_inspection";
}

const PANE_RESULT: ResultReference = { stepId: "split", path: "details.pane.pane_id" };

export function registerSfHerdrPlanTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: SF_HERDR_PLAN_TOOL_NAME,
    label: "SF Herdr Plan",
    description:
      "Return a non-mutating plan using the current herdr_layout, herdr_pane, and herdr_agent tools. The owning workflow supplies commands or agent inputs.",
    promptSnippet:
      "Plan current split Herdr tool calls without constructing pane IDs or generating shell commands",
    promptGuidelines: [
      "Execute the returned steps explicitly and pass the opaque pane ID from herdr_layout.pane_split to later steps.",
      "Leave failed or timed-out panes open for inspection. Close only fresh ephemeral panes after observed success.",
      "Use herdr_pane for ordinary commands and herdr_agent for review or coding-agent work.",
    ],
    parameters: SfHerdrPlanParams,
    async execute(_toolCallId, params) {
      const input = params as SfHerdrPlanInput;
      const plan = buildSfHerdrPlan(readSfHerdrSettings(), input);
      return {
        content: [{ type: "text", text: renderSfHerdrPlan(plan) }],
        details: { plan },
      };
    },
  });
}

export function buildSfHerdrPlan(settings: SfHerdrSettings, input: SfHerdrPlanInput): SfHerdrPlan {
  const lifecycle = settings.lifecycleByIntent[input.intent];
  const splitArguments: Record<string, string | boolean | number> = { focus: false };
  if (settings.splitDirection !== "auto") splitArguments.direction = settings.splitDirection;

  const steps: HerdrPlanStep[] = [
    {
      id: "split",
      tool: "herdr_layout",
      action: "pane_split",
      arguments: splitArguments,
      purpose: "Create the workflow pane and observe its returned opaque pane ID.",
    },
    ...(input.intent === "review" ? agentSteps() : commandSteps()),
  ];
  if (lifecycle === "ephemeral") {
    steps.push({
      id: "close",
      tool: "herdr_pane",
      action: "close",
      arguments: {},
      argumentBindings: { pane: PANE_RESULT },
      purpose: "Close the fresh ephemeral pane after its workflow succeeds.",
      when: "observed_success_only",
    });
  }

  return {
    intent: input.intent,
    primaryWorkflow: input.primaryWorkflow,
    lifecycle,
    steps,
    failureOrTimeout: "leave_open_for_inspection",
  };
}

function commandSteps(): HerdrPlanStep[] {
  return [
    {
      id: "run",
      tool: "herdr_pane",
      action: "run",
      arguments: {},
      argumentBindings: { pane: PANE_RESULT },
      callerSupplies: ["command"],
      purpose: "Run the command chosen by the owning workflow.",
    },
    {
      id: "wait",
      tool: "herdr_pane",
      action: "wait_output",
      arguments: { source: "recent-unwrapped" },
      argumentBindings: { pane: PANE_RESULT },
      callerSupplies: ["match", "timeout"],
      purpose:
        "Wait for the owning workflow's success marker and use the returned bounded output snapshot.",
    },
  ];
}

function agentSteps(): HerdrPlanStep[] {
  return [
    {
      id: "start-agent",
      tool: "herdr_agent",
      action: "start",
      arguments: {},
      argumentBindings: { pane: PANE_RESULT },
      callerSupplies: ["name", "kind"],
      purpose: "Start the caller-selected coding agent in the new pane.",
    },
    {
      id: "prompt-agent",
      tool: "herdr_agent",
      action: "prompt",
      arguments: { wait: true },
      argumentBindings: { target: PANE_RESULT },
      callerSupplies: ["prompt", "timeout"],
      purpose: "Submit the review task and wait for lifecycle settlement.",
    },
    {
      id: "read-agent",
      tool: "herdr_agent",
      action: "read",
      arguments: { source: "recent-unwrapped" },
      argumentBindings: { target: PANE_RESULT },
      purpose: "Read the agent result and inspect blocked or uncertain states.",
    },
  ];
}

export function renderSfHerdrPlan(plan: SfHerdrPlan): string {
  const cleanup =
    plan.lifecycle === "ephemeral"
      ? "close only after observed success"
      : `${plan.lifecycle} lifecycle; leave open until explicit cleanup`;
  return [
    `SF Herdr plan · ${plan.primaryWorkflow} · ${plan.intent} · ${plan.lifecycle}`,
    ...plan.steps.map((step, index) => `${index + 1}. ${renderStep(step)}`),
    `Cleanup: ${cleanup}; failure or timeout stays open for inspection.`,
  ].join("\n");
}

function renderStep(step: HerdrPlanStep): string {
  const values = Object.entries(step.arguments).map(([name, value]) => `${name}=${value}`);
  for (const [name, reference] of Object.entries(step.argumentBindings ?? {})) {
    values.push(`${name}←${reference.stepId}.${reference.path}`);
  }
  if (step.callerSupplies?.length) values.push(`caller supplies ${step.callerSupplies.join(", ")}`);
  if (step.when === "observed_success_only") values.push("after observed success only");
  const suffix = values.length ? ` · ${values.join(" · ")}` : "";
  return `${step.tool}.${step.action}${suffix}`;
}
