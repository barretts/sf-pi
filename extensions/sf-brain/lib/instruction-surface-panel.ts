/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only SF Pi Manager panel for the advisory Instruction Surface Report. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey, truncateToWidth } from "@earendil-works/pi-tui";
import type { ConfigPanelResult } from "../../../catalog/registry.ts";
import type { InstructionSurfaceBaselineComparison } from "./instruction-surface-baseline.ts";
import type { InstructionSurfaceReport } from "./instruction-surface-report.ts";

export function renderInstructionSurfaceReport(
  report: InstructionSurfaceReport,
  width = 100,
  comparison?: InstructionSurfaceBaselineComparison,
): string[] {
  const safeWidth = Number.isFinite(width) ? Math.max(20, Math.floor(width)) : 100;
  const lines: string[] = [
    "Instruction Surface Report",
    "Advisory character counts; prompt contents are never displayed.",
    "",
    "Current session",
    row("System prompt", report.summary.system_prompt_chars),
    row("SF Pi-owned", report.summary.sf_pi_owned_chars),
    row("SF Pi tool definitions", report.summary.sf_pi_tool_definition_chars),
    row("External Salesforce skills", report.summary.external_salesforce_skill_chars),
    row("Effective startup estimate", report.summary.effective_startup_estimate_chars),
    row("Approximate tokens", report.summary.approximate_effective_startup_tokens),
    "",
    "SF Pi-owned sections",
    sectionRow("Tool definitions", report.sections.sf_pi_tool_definitions),
    sectionRow("Tool guidance", report.sections.sf_pi_tool_guidance),
    sectionRow("Hidden context", report.sections.sf_pi_hidden_context),
    sectionRow("Bundled skills", report.sections.bundled_extension_skills),
    "",
    ...comparisonLines(comparison),
    "Largest SF Pi contributors",
    ...report.largest_contributors
      .filter((item) => item.kind !== "skill" || report.sections.bundled_extension_skills.items > 0)
      .slice(0, 8)
      .map((item) => `  ${item.id} · ${labelKind(item.kind)} · ${formatNumber(item.chars)} chars`),
    "",
    "Limitations",
    ...report.limitations.slice(0, 3).map((line) => `  • ${line}`),
  ];

  return lines.map((line) => truncateToWidth(line, safeWidth, "…"));
}

export class InstructionSurfacePanel implements Focusable {
  focused = false;

  constructor(
    private readonly theme: Theme,
    private readonly report: InstructionSurfaceReport,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
    private readonly comparison?: InstructionSurfaceBaselineComparison,
  ) {}

  handleInput(data: string): void {
    if (
      matchesKey(data, "escape") ||
      matchesKey(data, "enter") ||
      matchesKey(data, "return") ||
      data === "q"
    ) {
      this.done(undefined);
    }
  }

  renderContent(width = 100): string[] {
    const lines = renderInstructionSurfaceReport(this.report, width, this.comparison);
    if (lines.length > 0) lines[0] = this.theme.fg("accent", this.theme.bold(lines[0] ?? ""));
    return [...lines, "", this.theme.fg("dim", "Enter/Esc back")];
  }

  render(width = 100): string[] {
    return this.renderContent(width);
  }

  invalidate(): void {}
}

function comparisonLines(comparison: InstructionSurfaceBaselineComparison | undefined): string[] {
  if (!comparison) return [];
  if (comparison.comparable === false) {
    return ["Bundled baseline", `  Not comparable · ${comparison.reason}`, ""];
  }
  return [
    `Compared with bundled baseline v${comparison.baseline_sf_pi_version}`,
    `  SF Pi-owned          ${signed(comparison.deltas.sf_pi_owned_chars)} chars`,
    `  Tool definitions     ${signed(comparison.deltas.sf_pi_tool_definition_chars)} chars`,
    `  Tool guidance        ${signed(comparison.deltas.sf_pi_tool_guidance_chars)} chars`,
    `  Hidden context       ${signed(comparison.deltas.sf_pi_hidden_context_chars)} chars`,
    `  Bundled skills       ${signed(comparison.deltas.bundled_extension_skill_chars)} chars`,
    "",
  ];
}

function signed(value: number): string {
  return value > 0 ? `+${formatNumber(value)}` : formatNumber(value);
}

function row(label: string, value: number): string {
  return `  ${label.padEnd(29)} ${formatNumber(value)}`;
}

function sectionRow(
  label: string,
  section: { chars: number; approximate_tokens: number; items: number },
): string {
  return `  ${label.padEnd(20)} ${formatNumber(section.chars)} chars · ${section.items} items`;
}

function labelKind(kind: InstructionSurfaceReport["largest_contributors"][number]["kind"]): string {
  return kind.replaceAll("_", " ");
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}
