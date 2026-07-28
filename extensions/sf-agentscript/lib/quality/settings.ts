/* SPDX-License-Identifier: Apache-2.0 */
/** Global-only Agent Script quality automation and per-rule preferences. */
import {
  globalSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../../lib/common/sf-pi-settings.ts";
import {
  AGENT_SCRIPT_QUALITY_RULES,
  isAgentScriptQualityRuleId,
  qualityRuleById,
  type AgentScriptQualityRuleId,
} from "./catalog.ts";

export interface EffectiveAgentScriptQualitySettings {
  autoRun: boolean;
  autoRunSource: "global" | "default";
  rules: Record<AgentScriptQualityRuleId, boolean>;
  sources: Record<AgentScriptQualityRuleId, "global" | "default">;
  disabledRules: Array<{
    id: AgentScriptQualityRuleId;
    name: string;
    source: "global" | "default";
  }>;
}

const DEFAULT_AUTO_RUN = true;

export function readEffectiveAgentScriptQualitySettings(): EffectiveAgentScriptQualitySettings {
  const root = readJsonFile(globalSettingsPath());
  const quality = qualityRecord(root);
  const rawRules = objectValue(quality.rules);
  const rules = {} as Record<AgentScriptQualityRuleId, boolean>;
  const sources = {} as Record<AgentScriptQualityRuleId, "global" | "default">;

  for (const definition of AGENT_SCRIPT_QUALITY_RULES) {
    const value = rawRules[definition.id];
    rules[definition.id] = typeof value === "boolean" ? value : definition.defaultEnabled;
    sources[definition.id] = typeof value === "boolean" ? "global" : "default";
  }

  return {
    autoRun: typeof quality.autoRun === "boolean" ? quality.autoRun : DEFAULT_AUTO_RUN,
    autoRunSource: typeof quality.autoRun === "boolean" ? "global" : "default",
    rules,
    sources,
    disabledRules: AGENT_SCRIPT_QUALITY_RULES.filter((definition) => !rules[definition.id]).map(
      (definition) => ({
        id: definition.id,
        name: definition.name,
        source: sources[definition.id],
      }),
    ),
  };
}

/**
 * Persist only disabled overrides. Turning a v1 rule on restores its catalog
 * default and removes the key, keeping global settings sparse.
 */
export function setGlobalAgentScriptQualityRule(
  ruleId: AgentScriptQualityRuleId,
  enabled: boolean,
): EffectiveAgentScriptQualitySettings {
  const definition = qualityRuleById(ruleId);
  if (!definition) throw new Error(`Unknown Agent Script quality rule: ${ruleId}`);
  mutateQuality((quality) => {
    const rules = objectValue(quality.rules);
    if (enabled === definition.defaultEnabled) delete rules[ruleId];
    else rules[ruleId] = enabled;
    quality.rules = rules;
  });
  return readEffectiveAgentScriptQualitySettings();
}

export function setGlobalAgentScriptQualityAutoRun(
  enabled: boolean,
): EffectiveAgentScriptQualitySettings {
  mutateQuality((quality) => {
    if (enabled === DEFAULT_AUTO_RUN) delete quality.autoRun;
    else quality.autoRun = enabled;
  });
  return readEffectiveAgentScriptQualitySettings();
}

export function enabledAgentScriptQualityRuleIds(
  options: { editTimeOnly?: boolean } = {},
): AgentScriptQualityRuleId[] {
  const settings = readEffectiveAgentScriptQualitySettings();
  return AGENT_SCRIPT_QUALITY_RULES.filter(
    (definition) =>
      settings.rules[definition.id] && (!options.editTimeOnly || definition.runsAtEditTime),
  ).map((definition) => definition.id);
}

export function normalizeQualityRuleOverrides(
  input: unknown,
): Partial<Record<AgentScriptQualityRuleId, boolean>> {
  const raw = objectValue(input);
  const output: Partial<Record<AgentScriptQualityRuleId, boolean>> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (isAgentScriptQualityRuleId(id) && typeof value === "boolean") output[id] = value;
  }
  return output;
}

function mutateQuality(mutate: (quality: Record<string, unknown>) => void): void {
  const file = globalSettingsPath();
  const root = readJsonFile(file);
  const sfPi = objectValue(root.sfPi);
  const agentScript = objectValue(sfPi.agentScript);
  const quality = objectValue(agentScript.quality);
  mutate(quality);
  agentScript.quality = quality;
  sfPi.agentScript = agentScript;
  root.sfPi = sfPi;
  writeJsonFile(file, root);
}

function qualityRecord(root: Record<string, unknown>): Record<string, unknown> {
  return objectValue(objectValue(objectValue(root.sfPi).agentScript).quality);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
