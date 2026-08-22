/* SPDX-License-Identifier: Apache-2.0 */
/** Invocation-mode types for managed Salesforce skills. */

export type SkillInvocationMode = "agent-invocable" | "manual-only";

export interface SkillInvocationPolicy {
  /** Default for managed-library skills with no pack/skill override. */
  default: SkillInvocationMode;
  packs: Record<string, SkillInvocationMode>;
  skills: Record<string, SkillInvocationMode>;
}

export interface SkillPackDefinition {
  id: string;
  label: string;
  /** Longest-prefix match. Empty means fallback pack. */
  prefix: string;
}

export const DEFAULT_INVOCATION_POLICY: SkillInvocationPolicy = {
  default: "manual-only",
  packs: {},
  skills: {},
};

export const SKILL_PACKS: readonly SkillPackDefinition[] = [
  { id: "ui-bundle", label: "UI Bundle", prefix: "experience-ui-bundle" },
  { id: "experience", label: "Experience / LWC", prefix: "experience-" },
  { id: "design-systems", label: "SLDS", prefix: "design-systems-" },
  { id: "agentforce", label: "Agentforce", prefix: "agentforce-" },
  { id: "data360", label: "Data 360", prefix: "data360-" },
  { id: "omnistudio", label: "OmniStudio", prefix: "omnistudio-" },
  { id: "automation", label: "Automation", prefix: "automation-" },
  { id: "integration", label: "Integration", prefix: "integration-" },
  { id: "commerce", label: "Commerce", prefix: "commerce-" },
  { id: "mobile", label: "Mobile", prefix: "mobile-" },
  { id: "service", label: "Service", prefix: "service-" },
  { id: "sales", label: "Sales", prefix: "sales-" },
  { id: "dx", label: "DX / DevOps", prefix: "dx-" },
  { id: "platform", label: "Platform", prefix: "platform-" },
  { id: "other", label: "Other", prefix: "" },
];
