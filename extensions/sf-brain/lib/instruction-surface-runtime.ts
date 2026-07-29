/* SPDX-License-Identifier: Apache-2.0 */
/** Public-Pi runtime adapter for the pure Instruction Surface Report module. */
import {
  buildInstructionSurfaceReport,
  type InstructionSurfaceContextMessage,
  type InstructionSurfaceReport,
  type InstructionSurfaceSkill,
  type InstructionSurfaceTool,
} from "./instruction-surface-report.ts";

interface RuntimeTool extends InstructionSurfaceTool {
  sourceInfo?: { source?: string };
}

interface RuntimeSkill extends InstructionSurfaceSkill {
  sourceInfo?: { source?: string };
}

export interface InstructionSurfaceRuntimePi {
  getAllTools(): RuntimeTool[];
}

export interface InstructionSurfaceRuntimeContext {
  cwd: string;
  getSystemPrompt(): string;
  getSystemPromptOptions(): {
    selectedTools?: string[];
    toolSnippets?: Record<string, string>;
    skills?: RuntimeSkill[];
  };
  sessionManager: {
    buildContextEntries(): unknown[];
  };
}

export interface CaptureInstructionSurfaceOptions {
  sfPiPackageRoot: string;
  sfPiToolNames: readonly string[];
  externalSalesforceSkillRoots?: readonly string[];
  piRuntimeVersion?: string;
  sfPiVersion?: string;
  mode?: "current_session" | "bundled_baseline";
  supplementalContextMessages?: readonly InstructionSurfaceContextMessage[];
}

export function captureInstructionSurfaceReport(
  pi: InstructionSurfaceRuntimePi,
  ctx: InstructionSurfaceRuntimeContext,
  options: CaptureInstructionSurfaceOptions,
): InstructionSurfaceReport {
  const promptOptions = ctx.getSystemPromptOptions();
  const snippets = promptOptions.toolSnippets ?? {};
  const tools = pi.getAllTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
    promptSnippet: tool.promptSnippet ?? snippets[tool.name],
    promptGuidelines: tool.promptGuidelines,
  }));
  const skills = promptOptions.skills ?? [];

  return buildInstructionSurfaceReport({
    mode: options.mode ?? "current_session",
    systemPrompt: ctx.getSystemPrompt(),
    selectedTools: promptOptions.selectedTools ?? [],
    tools,
    skills,
    contextMessages: latestMessagesByType([
      ...(options.supplementalContextMessages ?? []),
      ...latestContextMessages(ctx.sessionManager.buildContextEntries()),
    ]),
    sfPiToolNames: options.sfPiToolNames,
    sfPiPackageRoot: options.sfPiPackageRoot,
    externalSalesforceSkillRoots:
      options.externalSalesforceSkillRoots ?? inferExternalSalesforceSkillRoots(skills),
    piRuntimeVersion: options.piRuntimeVersion,
    sfPiVersion: options.sfPiVersion,
  });
}

export function inferExternalSalesforceSkillRoots(
  skills: readonly Pick<InstructionSurfaceSkill, "filePath">[],
): string[] {
  const roots = new Set<string>();
  for (const skill of skills) {
    const normalized = skill.filePath.replace(/\\/g, "/");
    const marker = "/afv-library/skills/";
    const index = normalized.indexOf(marker);
    if (index >= 0) roots.add(normalized.slice(0, index + marker.length - 1));
  }
  return [...roots].sort();
}

function latestMessagesByType(
  messages: readonly InstructionSurfaceContextMessage[],
): InstructionSurfaceContextMessage[] {
  const latest = new Map<string, InstructionSurfaceContextMessage>();
  for (const message of messages) latest.set(message.customType, message);
  return [...latest.values()];
}

function latestContextMessages(entries: readonly unknown[]): InstructionSurfaceContextMessage[] {
  const latest = new Map<string, InstructionSurfaceContextMessage>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const candidate = entry as {
      type?: unknown;
      customType?: unknown;
      content?: unknown;
    };
    if (
      candidate.type !== "custom_message" ||
      typeof candidate.customType !== "string" ||
      (typeof candidate.content !== "string" && !Array.isArray(candidate.content))
    ) {
      continue;
    }
    latest.set(candidate.customType, {
      customType: candidate.customType,
      content: candidate.content as string | unknown[],
    });
  }
  return [...latest.values()];
}
