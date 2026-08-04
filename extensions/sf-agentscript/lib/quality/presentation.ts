/* SPDX-License-Identifier: Apache-2.0 */
/** Human-card and compact LLM-repair presentation for Agent Script quality. */
import path from "node:path";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";
import type { AgentScriptQualityFinding, AgentScriptQualityResult } from "./types.ts";

export const AGENT_SCRIPT_QUALITY_REPAIR_MESSAGE_TYPE = "sf-agentscript-quality-repair";

export type AgentScriptQualityCardState =
  | "checking"
  | "passed"
  | "issues"
  | "repairing"
  | "fixed"
  | "stopped"
  | "blocked"
  | "partial"
  | "failed";

export interface AgentScriptQualityCardData {
  schema_version: 1;
  state: AgentScriptQualityCardState;
  file: string;
  quality: AgentScriptQualityResult;
  repair?: {
    attempt: number;
    signature: string;
  };
  message?: string;
  duration_ms?: number;
}

export interface AgentScriptQualityRepairPayload {
  version: 1;
  task: "repair_agent_script_quality";
  file: string;
  attempt: number;
  finding_signature: string;
  findings: Array<{
    rule_id: string;
    severity: "high" | "moderate";
    line: number;
    message: string;
    suggestion?: string;
    evidence?: string[];
  }>;
  constraints: string[];
  verify: Array<{
    tool: "agentscript_authoring";
    params: Record<string, unknown>;
  }>;
}

export function qualityCardData(
  file: string,
  quality: AgentScriptQualityResult,
  options: {
    state?: AgentScriptQualityCardState;
    repair?: AgentScriptQualityCardData["repair"];
    message?: string;
    durationMs?: number;
  } = {},
): AgentScriptQualityCardData {
  return {
    schema_version: 1,
    state: options.state ?? qualityCardState(quality),
    file,
    quality,
    ...(options.repair ? { repair: options.repair } : {}),
    ...(options.message ? { message: options.message } : {}),
    ...(options.durationMs !== undefined ? { duration_ms: options.durationMs } : {}),
  };
}

export function qualityCardState(quality: AgentScriptQualityResult): AgentScriptQualityCardState {
  if (!quality.ok || quality.status === "failed") return "failed";
  if (quality.status === "partial") return "partial";
  if (quality.findings.length > 0 || quality.summary.info > 0) return "issues";
  return "passed";
}

export function buildQualityRepairPayload(
  file: string,
  findings: AgentScriptQualityFinding[],
  attempt: number,
  signature: string,
): AgentScriptQualityRepairPayload {
  return {
    version: 1,
    task: "repair_agent_script_quality",
    file,
    attempt,
    finding_signature: signature,
    findings: findings
      .filter((finding) => finding.severity === "high" || finding.severity === "moderate")
      .slice(0, 10)
      .map((finding) => ({
        rule_id: finding.rule_id,
        severity: finding.severity as "high" | "moderate",
        line: finding.line,
        message: finding.message,
        ...(finding.suggestion ? { suggestion: finding.suggestion } : {}),
        ...(finding.evidence?.length ? { evidence: finding.evidence.slice(0, 3) } : {}),
      })),
    constraints: [
      "Edit only the listed Agent Script file.",
      "Preserve unrelated behavior.",
      "Do not suppress High findings.",
    ],
    verify: [
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: file },
      },
      {
        tool: "agentscript_authoring",
        params: { verb: "inspect", mode: "quality", agent_file: file },
      },
    ],
  };
}

export function createQualityCardComponent(
  card: AgentScriptQualityCardData,
  expanded: boolean,
  theme: Theme,
  boxed = true,
): Component {
  const text = new Text(renderQualityCardText(card, expanded, theme), 0, 0);
  if (!boxed) return text;
  const box = new Box(1, 1, (value) => theme.bg(cardBackground(card.state), value));
  box.addChild(text);
  return box;
}

export function renderQualityCardText(
  card: AgentScriptQualityCardData,
  expanded: boolean,
  theme: Theme,
): string {
  const quality = card.quality;
  const summary = quality.summary;
  const coverage = quality.coverage;
  const disabled = Math.max(0, coverage.total_rules - coverage.enabled_rules);
  const metrics = quality.metrics.cyclomatic_complexity;
  const maxComplexity = Math.max(0, ...metrics.map((metric) => metric.value));
  const visual = stateVisual(card.state);
  const title = `${theme.fg(visual.tone, visual.icon)} ${theme.bold("Agent Script Quality")} ${theme.fg("dim", `· ${path.basename(card.file)}`)}`;
  const lines = [title, theme.fg(visual.tone, headline(card, disabled))];

  if (card.state === "passed" || card.state === "fixed") {
    lines.push(
      `${theme.fg("success", "☑")} Quality passed   ${theme.fg("success", "☑")} No High findings   ${theme.fg("success", "☑")} ${coverage.enabled_rules}/${coverage.total_rules} rules enabled`,
    );
  } else {
    lines.push(formatCounts(summary, theme));
  }

  if (actionableCount(quality) > 0) {
    lines.push(
      theme.fg("warning", "Recommended: resolve High and Moderate findings before activation."),
    );
  }

  if (card.repair) {
    const repairStatus =
      card.state === "fixed"
        ? {
            tone: "success" as const,
            text: `✓ Repair attempt ${card.repair.attempt} verified by quality scan`,
          }
        : card.state === "stopped"
          ? { tone: "warning" as const, text: `⚠ Repair attempt ${card.repair.attempt}` }
          : { tone: "accent" as const, text: `↻ Repair attempt ${card.repair.attempt}` };
    lines.push(theme.fg(repairStatus.tone, repairStatus.text));
  }
  if (card.message) lines.push(theme.fg("muted", card.message));

  for (const finding of quality.findings) {
    const findingVisual = severityVisual(finding.severity);
    lines.push(
      `${theme.fg(findingVisual.tone, findingVisual.icon)} ${theme.fg(findingVisual.tone, finding.rule_name)} ${theme.fg("dim", `L${finding.line}`)}`,
    );
    if (expanded) {
      lines.push(`  ${theme.fg("muted", finding.message)}`);
      if (finding.suggestion)
        lines.push(`  ${theme.fg("accent", `Suggestion: ${finding.suggestion}`)}`);
    }
  }
  const footer = [
    card.state === "passed" || card.state === "fixed"
      ? undefined
      : `${coverage.enabled_rules}/${coverage.total_rules} rules enabled`,
    `${metrics.length} procedure(s)`,
    `max complexity ${maxComplexity}`,
    card.duration_ms !== undefined ? `${card.duration_ms} ms` : undefined,
  ].filter((value): value is string => Boolean(value));
  lines.push(theme.fg("dim", footer.join(" · ")));

  if (expanded) {
    if (disabled > 0) {
      lines.push(
        theme.fg(
          "dim",
          `Disabled: ${coverage.disabled_rules.map((rule) => rule.name).join(", ") || disabled}`,
        ),
      );
    }
    if (quality.suppressions.applied.length > 0) {
      lines.push(theme.fg("dim", `${quality.suppressions.applied.length} suppression(s) applied`));
    }
    if (quality.failure_reason) lines.push(theme.fg("error", quality.failure_reason));
  }

  return lines.join("\n");
}

function headline(card: AgentScriptQualityCardData, disabled: number): string {
  const quality = card.quality;
  switch (card.state) {
    case "checking":
      return "Checking enabled quality rules…";
    case "passed":
      return disabled === 0
        ? `All ${quality.coverage.enabled_rules} enabled quality checks passed`
        : `No findings from ${quality.coverage.enabled_rules} enabled rules · ${disabled} disabled`;
    case "fixed":
      return `Quality findings cleared after repair attempt ${card.repair?.attempt ?? 1}`;
    case "repairing":
      return `${actionableCount(quality)} actionable issue(s) found · repair queued`;
    case "stopped":
      return "Repair stopped · finding signature unchanged";
    case "blocked":
      return "Publication paused by High quality findings";
    case "partial":
      return "Quality analysis is partial";
    case "failed":
      return "Quality analysis did not complete";
    case "issues":
      return `${quality.findings.length} quality issue(s) found`;
  }
}

function actionableCount(quality: AgentScriptQualityResult): number {
  return quality.findings.filter(
    (finding) => finding.severity === "high" || finding.severity === "moderate",
  ).length;
}

function formatCounts(summary: AgentScriptQualityResult["summary"], theme: Theme): string {
  return [
    theme.fg(summary.high > 0 ? "error" : "dim", `${summary.high} High`),
    theme.fg(summary.moderate > 0 ? "warning" : "dim", `${summary.moderate} Moderate`),
    theme.fg("dim", `${summary.low} Low`),
    theme.fg("dim", `${summary.info} Info`),
  ].join("   ");
}

function stateVisual(state: AgentScriptQualityCardState): {
  icon: string;
  tone: Parameters<Theme["fg"]>[0];
} {
  switch (state) {
    case "passed":
    case "fixed":
      return { icon: "✅", tone: "success" };
    case "failed":
    case "blocked":
      return { icon: "✕", tone: "error" };
    case "repairing":
      return { icon: "🔧", tone: "accent" };
    case "checking":
      return { icon: "◇", tone: "accent" };
    case "issues":
    case "partial":
    case "stopped":
      return { icon: "⚠", tone: "warning" };
  }
}

function severityVisual(severity: AgentScriptQualityFinding["severity"]): {
  icon: string;
  tone: Parameters<Theme["fg"]>[0];
} {
  switch (severity) {
    case "high":
      return { icon: "✕", tone: "error" };
    case "moderate":
      return { icon: "▲", tone: "warning" };
    case "low":
      return { icon: "•", tone: "muted" };
    case "info":
      return { icon: "ℹ", tone: "accent" };
  }
}

function cardBackground(state: AgentScriptQualityCardState): Parameters<Theme["bg"]>[0] {
  if (state === "failed" || state === "blocked") return "toolErrorBg";
  if (state === "checking" || state === "repairing") return "toolPendingBg";
  if (state === "passed" || state === "fixed") return "toolSuccessBg";
  return "customMessageBg";
}
