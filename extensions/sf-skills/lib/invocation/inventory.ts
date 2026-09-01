/* SPDX-License-Identifier: Apache-2.0 */
/** Toggle inventory: managed Salesforce skills plus other loaded community skills. */
import { accessSync, constants, readFileSync, writeFileSync } from "node:fs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { applyInvocationMode, hasDisableModelInvocation, parseFrontmatter } from "./frontmatter.ts";
import { assignSkillPack, resolveInvocationMode } from "./policy.ts";
import { SKILL_PACKS, type SkillInvocationMode, type SkillInvocationPolicy } from "./types.ts";
import type { EffectiveSkillRecord } from "./effective-tree.ts";

export type SkillOrigin = "salesforce" | "community";

export interface ToggleSkill {
  name: string;
  description: string;
  filePath: string;
  origin: SkillOrigin;
  packId: string;
  packLabel: string;
  authorDisabled: boolean;
  writable: boolean;
}

export function classifySkillOrigin(filePath: string): SkillOrigin {
  const normalized = filePath.replace(/\\/g, "/");
  if (
    normalized.includes("/sf-skills/forcedotcom/") ||
    normalized.includes("/sf-skills/effective/")
  ) {
    return "salesforce";
  }
  return "community";
}

export function packLabelFor(packId: string): string {
  if (packId === "community") return "Community";
  return SKILL_PACKS.find((pack) => pack.id === packId)?.label ?? packId;
}

export function scannedSkillsForToggle(
  sources: ReadonlyArray<{
    gate: string;
    skills: ReadonlyArray<{ name: string; filePath: string; description?: string }>;
  }>,
): Array<Pick<Skill, "name" | "description" | "filePath" | "disableModelInvocation">> {
  return sources.flatMap((source) =>
    source.gate === "off"
      ? []
      : source.skills.map((skill) => ({
          name: skill.name,
          description: skill.description ?? "",
          filePath: skill.filePath,
          disableModelInvocation: fileHasDisable(skill.filePath),
        })),
  );
}

export function buildToggleInventory(
  managed: readonly EffectiveSkillRecord[],
  loaded: readonly Pick<Skill, "name" | "description" | "filePath" | "disableModelInvocation">[],
): ToggleSkill[] {
  const seen = new Set<string>();
  const out: ToggleSkill[] = [];

  for (const skill of managed) {
    const name = skill.name;
    if (seen.has(name)) continue;
    seen.add(name);
    const packId = assignSkillPack(name);
    out.push({
      name,
      description: skill.description,
      filePath: skill.effectiveFile,
      origin: "salesforce",
      packId,
      packLabel: packLabelFor(packId),
      authorDisabled: skill.authorDisabled,
      writable: isWritable(skill.effectiveFile),
    });
  }

  for (const skill of loaded) {
    if (seen.has(skill.name)) continue;
    if (classifySkillOrigin(skill.filePath) === "salesforce") continue;
    seen.add(skill.name);
    out.push({
      name: skill.name,
      description: skill.description,
      filePath: skill.filePath,
      origin: "community",
      packId: "community",
      packLabel: "Community",
      authorDisabled: skill.disableModelInvocation || fileHasDisable(skill.filePath),
      writable: isWritable(skill.filePath),
    });
  }

  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function modeForToggleSkill(
  skill: ToggleSkill,
  policy: SkillInvocationPolicy,
): SkillInvocationMode {
  return resolveInvocationMode({
    name: skill.name,
    authorDisabled: skill.authorDisabled,
    origin: skill.origin,
    policy,
  });
}

export function stampToggleSkills(
  skills: readonly ToggleSkill[],
  policy: SkillInvocationPolicy,
): { stamped: number; skipped: number } {
  let stamped = 0;
  let skipped = 0;
  for (const skill of skills) {
    if (skill.authorDisabled || !skill.writable) {
      skipped += 1;
      continue;
    }
    const desired = modeForToggleSkill(skill, policy);
    let current: string;
    try {
      current = readFileSync(skill.filePath, "utf8");
    } catch {
      skipped += 1;
      continue;
    }
    const next = applyInvocationMode(current, desired);
    if (next === current) continue;
    writeFileSync(skill.filePath, next, "utf8");
    stamped += 1;
  }
  return { stamped, skipped };
}

function isWritable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.R_OK | constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function fileHasDisable(filePath: string): boolean {
  try {
    return hasDisableModelInvocation(parseFrontmatter(readFileSync(filePath, "utf8")));
  } catch {
    return false;
  }
}
