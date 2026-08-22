/* SPDX-License-Identifier: Apache-2.0 */
/** Minimal SKILL.md frontmatter patcher for disable-model-invocation. */
import type { SkillInvocationMode } from "./types.ts";

const DISABLE_KEY = "disable-model-invocation";
const DISABLE_KEY_RE = /^\s*disable-model-invocation\s*:/;

export interface FrontmatterDocument {
  raw: string;
  hasFrontmatter: boolean;
  frontmatterText: string;
  body: string;
  lineEnding: "\n" | "\r\n";
}

export function parseFrontmatter(raw: string): FrontmatterDocument {
  const lineEnding = raw.includes("\r\n") ? "\r\n" : "\n";
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) {
    return { raw, hasFrontmatter: false, frontmatterText: "", body: raw, lineEnding };
  }
  return {
    raw,
    hasFrontmatter: true,
    frontmatterText: match[1] ?? "",
    body: raw.slice(match[0].length),
    lineEnding,
  };
}

export function classifyInvocationMode(raw: string): SkillInvocationMode {
  return hasDisableModelInvocation(parseFrontmatter(raw)) ? "manual-only" : "agent-invocable";
}

export function hasDisableModelInvocation(doc: FrontmatterDocument): boolean {
  return doc.frontmatterText.split(/\r?\n/).some((line) => {
    if (!DISABLE_KEY_RE.test(line)) return false;
    return /:\s*true\s*$/i.test(line.trim());
  });
}

export function applyInvocationMode(raw: string, mode: SkillInvocationMode): string {
  const doc = parseFrontmatter(raw);
  if (!doc.hasFrontmatter) {
    if (mode === "agent-invocable") return raw;
    return `---${doc.lineEnding}${DISABLE_KEY}: true${doc.lineEnding}---${doc.lineEnding}${raw}`;
  }

  const nextFrontmatter =
    mode === "manual-only"
      ? ensureManualOnly(doc.frontmatterText, doc.lineEnding)
      : ensureAgentInvocable(doc.frontmatterText);

  return `---${doc.lineEnding}${withTrailingNewline(nextFrontmatter, doc.lineEnding)}---${doc.lineEnding}${doc.body}`;
}

function ensureManualOnly(frontmatterText: string, lineEnding: "\n" | "\r\n"): string {
  const lines = frontmatterText.split(/\r?\n/).filter((line) => !DISABLE_KEY_RE.test(line));
  lines.push(`${DISABLE_KEY}: true`);
  return lines.join(lineEnding);
}

function ensureAgentInvocable(frontmatterText: string): string {
  return frontmatterText
    .split(/\r?\n/)
    .filter((line) => !DISABLE_KEY_RE.test(line))
    .join("\n");
}

function withTrailingNewline(text: string, lineEnding: "\n" | "\r\n"): string {
  if (text.length === 0) return "";
  return text.endsWith("\n") ? text : `${text}${lineEnding}`;
}
