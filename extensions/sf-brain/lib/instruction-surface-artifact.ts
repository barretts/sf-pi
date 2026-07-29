/* SPDX-License-Identifier: Apache-2.0 */
/** Public-safe contributor artifact rendering for Instruction Surface measurements. */
import type { InstructionSurfaceBaselineComparison } from "./instruction-surface-baseline.ts";
import type { InstructionSurfaceReport } from "./instruction-surface-report.ts";

export function renderInstructionSurfaceMarkdown(
  report: InstructionSurfaceReport,
  comparison?: InstructionSurfaceBaselineComparison,
): string {
  const lines = [
    "# Instruction Surface Report",
    "",
    "> Advisory character measurements only. Prompt, context, schema, and skill contents are not included.",
    "",
    `- Mode: \`${report.mode}\``,
    `- Measurement schema: \`${report.schema_version}\``,
    `- Pi Runtime: \`${report.pi_runtime_version ?? "unknown"}\``,
    `- SF Pi: \`${report.sf_pi_version ?? "unknown"}\``,
    "",
    "## Summary",
    "",
    "| Surface | Characters | Approx. tokens |",
    "| --- | ---: | ---: |",
    summaryRow(
      "SF Pi-owned",
      report.summary.sf_pi_owned_chars,
      Math.ceil(report.summary.sf_pi_owned_chars / 4),
    ),
    summaryRow(
      "SF Pi active tool definitions",
      report.summary.sf_pi_tool_definition_chars,
      report.sections.sf_pi_tool_definitions.approximate_tokens,
    ),
    summaryRow(
      "External Salesforce skills",
      report.summary.external_salesforce_skill_chars,
      report.sections.external_salesforce_skills.approximate_tokens,
    ),
    summaryRow(
      "Effective startup estimate",
      report.summary.effective_startup_estimate_chars,
      report.summary.approximate_effective_startup_tokens,
    ),
    "",
    "## SF Pi-owned sections",
    "",
    "| Section | Items | Characters | Approx. tokens |",
    "| --- | ---: | ---: | ---: |",
    sectionRow("Tool definitions", report.sections.sf_pi_tool_definitions),
    sectionRow("Tool guidance", report.sections.sf_pi_tool_guidance),
    sectionRow("Hidden context", report.sections.sf_pi_hidden_context),
    sectionRow("Bundled extension skills", report.sections.bundled_extension_skills),
    "",
    ...baselineMarkdown(comparison),
    "## Largest contributors",
    "",
    "| Kind | Identifier | Characters |",
    "| --- | --- | ---: |",
    ...report.largest_contributors.map(
      (item) => `| ${item.kind.replaceAll("_", " ")} | \`${item.id}\` | ${item.chars} |`,
    ),
    "",
    "## Exclusions",
    "",
    ...report.exclusions.map((item) => `- ${item}`),
    "",
    "## Limitations",
    "",
    ...report.limitations.map((item) => `- ${item}`),
    "",
  ];
  return lines.join("\n");
}

function summaryRow(label: string, chars: number, tokens: number): string {
  return `| ${label} | ${chars} | ${tokens} |`;
}

function sectionRow(
  label: string,
  section: { items: number; chars: number; approximate_tokens: number },
): string {
  return `| ${label} | ${section.items} | ${section.chars} | ${section.approximate_tokens} |`;
}

function baselineMarkdown(comparison: InstructionSurfaceBaselineComparison | undefined): string[] {
  if (!comparison) return [];
  if (comparison.comparable === false) {
    return ["## Bundled baseline", "", `Not comparable: ${comparison.reason}`, ""];
  }
  return [
    `## Compared with bundled baseline v${comparison.baseline_sf_pi_version}`,
    "",
    "| Measurement | Character delta |",
    "| --- | ---: |",
    deltaRow("SF Pi-owned", comparison.deltas.sf_pi_owned_chars),
    deltaRow("Tool definitions", comparison.deltas.sf_pi_tool_definition_chars),
    deltaRow("Tool guidance", comparison.deltas.sf_pi_tool_guidance_chars),
    deltaRow("Hidden context", comparison.deltas.sf_pi_hidden_context_chars),
    deltaRow("Bundled extension skills", comparison.deltas.bundled_extension_skill_chars),
    "",
  ];
}

function deltaRow(label: string, value: number): string {
  return `| ${label} | ${value > 0 ? "+" : ""}${value} |`;
}
