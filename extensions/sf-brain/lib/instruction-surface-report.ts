/* SPDX-License-Identifier: Apache-2.0 */
/** Pure, content-safe measurement for SF Pi's model-visible instruction surfaces. */
import path from "node:path";

export const INSTRUCTION_SURFACE_SCHEMA_VERSION = 1 as const;

export interface InstructionSurfaceTool {
  name: string;
  description?: string;
  parameters?: unknown;
  promptSnippet?: string;
  promptGuidelines?: readonly string[];
}

export interface InstructionSurfaceSkill {
  name: string;
  description: string;
  filePath: string;
  disableModelInvocation?: boolean;
}

export interface InstructionSurfaceContextMessage {
  customType: string;
  content: string | unknown[];
}

export interface InstructionSurfaceInput {
  mode: "current_session" | "bundled_baseline";
  systemPrompt: string;
  selectedTools: readonly string[];
  tools: readonly InstructionSurfaceTool[];
  skills: readonly InstructionSurfaceSkill[];
  contextMessages: readonly InstructionSurfaceContextMessage[];
  sfPiToolNames: readonly string[];
  sfPiPackageRoot: string;
  externalSalesforceSkillRoots: readonly string[];
  piRuntimeVersion?: string;
  sfPiVersion?: string;
}

export interface InstructionSurfaceSection {
  chars: number;
  approximate_tokens: number;
  items: number;
}

export interface InstructionSurfaceReport {
  schema_version: typeof INSTRUCTION_SURFACE_SCHEMA_VERSION;
  mode: InstructionSurfaceInput["mode"];
  pi_runtime_version?: string;
  sf_pi_version?: string;
  summary: {
    system_prompt_chars: number;
    sf_pi_owned_chars: number;
    sf_pi_tool_definition_chars: number;
    external_salesforce_skill_chars: number;
    effective_startup_estimate_chars: number;
    approximate_effective_startup_tokens: number;
  };
  sections: {
    sf_pi_tool_definitions: InstructionSurfaceSection;
    sf_pi_tool_guidance: InstructionSurfaceSection;
    sf_pi_hidden_context: InstructionSurfaceSection;
    bundled_extension_skills: InstructionSurfaceSection;
    external_salesforce_skills: InstructionSurfaceSection;
    excluded_other_skills: InstructionSurfaceSection;
    excluded_other_tool_definitions: InstructionSurfaceSection;
    excluded_other_context: InstructionSurfaceSection;
  };
  largest_contributors: Array<{
    kind: "tool_definition" | "tool_guidance" | "context" | "skill";
    id: string;
    chars: number;
  }>;
  exclusions: string[];
  limitations: string[];
}

export function buildInstructionSurfaceReport(
  input: InstructionSurfaceInput,
): InstructionSurfaceReport {
  const selected = new Set(input.selectedTools);
  const sfPiTools = new Set(input.sfPiToolNames);
  const packageRoot = normalizePath(input.sfPiPackageRoot);
  const externalRoots = input.externalSalesforceSkillRoots.map(normalizePath);
  const contributors: InstructionSurfaceReport["largest_contributors"] = [];

  let sfToolDefinitionChars = 0;
  let otherToolDefinitionChars = 0;
  let sfToolCount = 0;
  let otherToolCount = 0;
  let sfToolGuidanceChars = 0;
  let sfToolGuidanceItems = 0;

  for (const tool of input.tools) {
    if (!selected.has(tool.name)) continue;
    const definitionChars = stableStringify({
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.parameters ?? {},
    }).length;
    if (sfPiTools.has(tool.name)) {
      sfToolDefinitionChars += definitionChars;
      sfToolCount += 1;
      contributors.push({ kind: "tool_definition", id: tool.name, chars: definitionChars });

      const guidanceChars =
        (tool.promptSnippet?.length ?? 0) + (tool.promptGuidelines ?? []).join("\n").length;
      sfToolGuidanceChars += guidanceChars;
      sfToolGuidanceItems +=
        (tool.promptSnippet ? 1 : 0) + (tool.promptGuidelines?.filter(Boolean).length ?? 0);
      if (guidanceChars > 0) {
        contributors.push({ kind: "tool_guidance", id: tool.name, chars: guidanceChars });
      }
    } else {
      otherToolDefinitionChars += definitionChars;
      otherToolCount += 1;
    }
  }

  let sfContextChars = 0;
  let sfContextItems = 0;
  let otherContextChars = 0;
  let otherContextItems = 0;
  for (const message of input.contextMessages) {
    const chars = contentChars(message.content);
    if (message.customType.startsWith("sf-")) {
      sfContextChars += chars;
      sfContextItems += 1;
      contributors.push({ kind: "context", id: message.customType, chars });
    } else {
      otherContextChars += chars;
      otherContextItems += 1;
    }
  }

  let bundledSkillChars = 0;
  let bundledSkillItems = 0;
  let externalSkillChars = 0;
  let externalSkillItems = 0;
  let otherSkillChars = 0;
  let otherSkillItems = 0;

  for (const skill of input.skills) {
    if (skill.disableModelInvocation) continue;
    const skillChars = renderedSkillChars(skill);
    const skillPath = normalizePath(skill.filePath);
    if (isWithin(skillPath, packageRoot) && skillPath.includes("/extensions/")) {
      bundledSkillChars += skillChars;
      bundledSkillItems += 1;
      contributors.push({ kind: "skill", id: skill.name, chars: skillChars });
    } else if (externalRoots.some((root) => isWithin(skillPath, root))) {
      externalSkillChars += skillChars;
      externalSkillItems += 1;
      contributors.push({ kind: "skill", id: skill.name, chars: skillChars });
    } else {
      otherSkillChars += skillChars;
      otherSkillItems += 1;
    }
  }

  const sfPiOwnedChars =
    sfToolDefinitionChars + sfToolGuidanceChars + sfContextChars + bundledSkillChars;
  const effectiveStartupEstimateChars =
    input.systemPrompt.length +
    sfContextChars +
    otherContextChars +
    sfToolDefinitionChars +
    otherToolDefinitionChars;

  return {
    schema_version: INSTRUCTION_SURFACE_SCHEMA_VERSION,
    mode: input.mode,
    ...(input.piRuntimeVersion ? { pi_runtime_version: input.piRuntimeVersion } : {}),
    ...(input.sfPiVersion ? { sf_pi_version: input.sfPiVersion } : {}),
    summary: {
      system_prompt_chars: input.systemPrompt.length,
      sf_pi_owned_chars: sfPiOwnedChars,
      sf_pi_tool_definition_chars: sfToolDefinitionChars,
      external_salesforce_skill_chars: externalSkillChars,
      effective_startup_estimate_chars: effectiveStartupEstimateChars,
      approximate_effective_startup_tokens: approximateTokens(effectiveStartupEstimateChars),
    },
    sections: {
      sf_pi_tool_definitions: section(sfToolDefinitionChars, sfToolCount),
      sf_pi_tool_guidance: section(sfToolGuidanceChars, sfToolGuidanceItems),
      sf_pi_hidden_context: section(sfContextChars, sfContextItems),
      bundled_extension_skills: section(bundledSkillChars, bundledSkillItems),
      external_salesforce_skills: section(externalSkillChars, externalSkillItems),
      excluded_other_skills: section(otherSkillChars, otherSkillItems),
      excluded_other_tool_definitions: section(otherToolDefinitionChars, otherToolCount),
      excluded_other_context: section(otherContextChars, otherContextItems),
    },
    largest_contributors: contributors
      .filter((contributor) => contributor.chars > 0)
      .sort((a, b) => b.chars - a.chars || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id))
      .slice(0, 12),
    exclusions: [
      "User and project instruction contents are excluded from SF Pi ownership.",
      "Conversation history and tool results are not instruction-surface inputs.",
      "Non-Salesforce tools and skills are measured only as excluded effective-context contributors.",
    ],
    limitations: [
      "Token values are advisory character-count approximations, not provider billing measurements.",
      "Provider serialization and before_provider_request payload rewrites are not observable here.",
      "System prompt totals can include user/project context that this report does not expose.",
    ],
  };
}

function section(chars: number, items: number): InstructionSurfaceSection {
  return { chars, approximate_tokens: approximateTokens(chars), items };
}

function approximateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

function contentChars(content: string | unknown[]): number {
  if (typeof content === "string") return content.length;
  return stableStringify(content).length;
}

function renderedSkillChars(skill: InstructionSurfaceSkill): number {
  return (
    "<skill>\n<name></name>\n<description></description>\n<location></location>\n</skill>".length +
    skill.name.length +
    skill.description.length +
    normalizePath(skill.filePath).length
  );
}

function normalizePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/$/, "");
}

function isWithin(candidate: string, root: string): boolean {
  return candidate === root || candidate.startsWith(`${root}/`);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
