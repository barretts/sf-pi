/* SPDX-License-Identifier: Apache-2.0 */
/** Resolve and persist managed-library invocation policy. */
import {
  globalSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../../lib/common/sf-pi-settings.ts";
import { SKILL_PACKS, type SkillInvocationMode, type SkillInvocationPolicy } from "./types.ts";

export function assignSkillPack(name: string): string {
  for (const pack of SKILL_PACKS) {
    if (pack.prefix && name.startsWith(pack.prefix)) return pack.id;
  }
  return "other";
}

export function normalizeInvocationPolicy(value: unknown): SkillInvocationPolicy {
  const candidate = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  return {
    default: candidate.default === "agent-invocable" ? "agent-invocable" : "manual-only",
    packs: normalizeModeMap(candidate.packs),
    skills: normalizeModeMap(candidate.skills),
  };
}

export function resolveInvocationMode(input: {
  name: string;
  authorDisabled: boolean;
  origin?: "salesforce" | "community";
  policy: SkillInvocationPolicy;
}): SkillInvocationMode {
  if (input.authorDisabled) return "manual-only";
  const skill = input.policy.skills[input.name];
  if (skill) return skill;
  if (input.origin === "community") return "agent-invocable";
  const pack = input.policy.packs[assignSkillPack(input.name)];
  if (pack) return pack;
  return input.policy.default;
}

export function readGlobalInvocationPolicy(): SkillInvocationPolicy {
  const root = readJsonFile(globalSettingsPath());
  const sfPi = nestedRecord(root, "sfPi");
  return normalizeInvocationPolicy(sfPi.skillInvocation);
}

export function writeGlobalInvocationPolicy(policy: SkillInvocationPolicy): SkillInvocationPolicy {
  const normalized = normalizeInvocationPolicy(policy);
  const filePath = globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = nestedRecord(root, "sfPi");
  sfPi.skillInvocation = normalized;
  root.sfPi = sfPi;
  writeJsonFile(filePath, root);
  return normalized;
}

export function setPackMode(
  policy: SkillInvocationPolicy,
  packId: string,
  mode: SkillInvocationMode,
): SkillInvocationPolicy {
  return {
    ...policy,
    packs: { ...policy.packs, [packId]: mode },
  };
}

export function setSkillMode(
  policy: SkillInvocationPolicy,
  skillName: string,
  mode: SkillInvocationMode,
): SkillInvocationPolicy {
  return {
    ...policy,
    skills: { ...policy.skills, [skillName]: mode },
  };
}

function normalizeModeMap(value: unknown): Record<string, SkillInvocationMode> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, SkillInvocationMode> = {};
  for (const [key, mode] of Object.entries(value as Record<string, unknown>)) {
    if (mode === "agent-invocable" || mode === "manual-only") out[key] = mode;
  }
  return out;
}

function nestedRecord(parent: Record<string, unknown>, key: string): Record<string, unknown> {
  const value = parent[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
