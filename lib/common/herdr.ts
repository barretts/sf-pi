/* SPDX-License-Identifier: Apache-2.0 */
/** Small cross-extension vocabulary for SF Herdr plans and handoffs. */

export const HERDR_WORKFLOWS = [
  "generic",
  "apex",
  "agentscript",
  "data360",
  "browser",
  "uiBundle",
] as const;
export type HerdrWorkflow = (typeof HERDR_WORKFLOWS)[number];

export const HERDR_PLAN_INTENTS = [
  "run-tests",
  "tail-logs",
  "deploy-validate",
  "preview",
  "eval",
  "server",
  "review",
  "verify",
] as const;
export type HerdrPlanIntent = (typeof HERDR_PLAN_INTENTS)[number];

export interface HerdrWorkflowHandoff {
  label: string;
  reason: string;
  commandSource: "owning-extension";
  plan: {
    intent: HerdrPlanIntent;
    primaryWorkflow: HerdrWorkflow;
  };
}
