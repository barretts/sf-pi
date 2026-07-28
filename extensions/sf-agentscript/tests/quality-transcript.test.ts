/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { visibleWidth } from "@earendil-works/pi-tui";
import { qualityCardData, type AgentScriptQualityCardState } from "../lib/quality/presentation.ts";
import { createAgentScriptQualityTranscriptRenderer } from "../lib/quality/transcript.ts";
import type { AgentScriptQualityResult } from "../lib/quality/types.ts";

const theme = {
  fg: (_color: string, value: string) => value,
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
} as Theme;

const moderateFinding = {
  rule_id: "unused-action" as const,
  rule_name: "Unused Action",
  severity: "moderate" as const,
  message: "Action 'lookup' is not referenced.",
  range: { start: { line: 11, character: 0 }, end: { line: 11, character: 6 } },
  line: 12,
};

function result(
  findings: AgentScriptQualityResult["findings"] = [],
  options: { status?: AgentScriptQualityResult["status"]; enabled?: number } = {},
): AgentScriptQualityResult {
  return {
    ok: options.status !== "failed",
    status: options.status ?? (findings.length > 0 ? "findings" : "clean"),
    findings,
    summary: {
      high: findings.filter((finding) => finding.severity === "high").length,
      moderate: findings.filter((finding) => finding.severity === "moderate").length,
      low: findings.filter((finding) => finding.severity === "low").length,
      info: findings.filter((finding) => finding.severity === "info").length,
    },
    coverage: {
      total_rules: 18,
      enabled_rules: options.enabled ?? 18,
      disabled_rules:
        options.enabled === 17
          ? [{ id: "unused-action", name: "Unused Action", source: "global" }]
          : [],
    },
    metrics: { cyclomatic_complexity: [] },
    suppressions: { applied: [], invalid: [], unused: [] },
    ...(options.status === "failed" ? { failure_reason: "parser unavailable" } : {}),
  };
}

function render(card: ReturnType<typeof qualityCardData>, expanded = true, width = 120): string {
  const component = createAgentScriptQualityTranscriptRenderer()(
    { data: card } as never,
    { expanded } as never,
    theme,
  );
  return component?.render(width).join("\n") ?? "";
}

describe("Agent Script quality transcript card", () => {
  it("renders a green passed card with honest enabled-rule coverage", () => {
    const passed = render(qualityCardData("/tmp/A.agent", result()));
    expect(passed).toContain("✅ Agent Script Quality · A.agent");
    expect(passed).toContain("All 18 enabled quality checks passed");
    expect(passed).toContain("☑ Quality passed");
    expect(passed).not.toContain("Compile clean");

    const disabled = render(qualityCardData("/tmp/A.agent", result([], { enabled: 17 })));
    expect(disabled).toContain("No findings from 17 enabled rules · 1 disabled");
    expect(disabled).not.toContain("All 17 enabled quality checks passed");
  });

  it("shows issue evidence and repair state", () => {
    const card = qualityCardData("/tmp/A.agent", result([moderateFinding]), {
      state: "repairing",
      repair: { attempt: 1, signature: "sig" },
    });
    const rendered = render(card);
    expect(rendered).toContain("🔧 Agent Script Quality · A.agent");
    expect(rendered).toContain("1 actionable issue(s) found · repair queued");
    expect(rendered).toContain("▲ Unused Action L12");
    expect(rendered).toContain("Action 'lookup' is not referenced.");
    expect(rendered).toContain("Repair attempt 1");
  });

  it.each([
    ["checking", "◇", "Checking enabled quality rules…"],
    ["issues", "⚠", "1 quality issue(s) found"],
    ["fixed", "✅", "Quality findings cleared after repair attempt 1"],
    ["stopped", "⚠", "Repair stopped · finding signature unchanged"],
    ["partial", "⚠", "Quality analysis is partial"],
    ["failed", "✕", "Quality analysis did not complete"],
    ["blocked", "✕", "Publication paused by High quality findings"],
  ] as Array<[AgentScriptQualityCardState, string, string]>)(
    "renders the %s state",
    (state, icon, headline) => {
      const quality =
        state === "failed"
          ? result([], { status: "failed" })
          : state === "partial"
            ? result([], { status: "partial" })
            : result(
                state === "blocked" || state === "stopped" || state === "issues"
                  ? [moderateFinding]
                  : [],
              );
      const card = qualityCardData("/tmp/A.agent", quality, {
        state,
        repair: { attempt: 1, signature: "sig" },
      });
      const rendered = render(card);
      expect(rendered).toContain(`${icon} Agent Script Quality`);
      expect(rendered).toContain(headline);
    },
  );

  it.each([40, 80, 120])("never exceeds a %i-column terminal", (width) => {
    const card = qualityCardData(
      "/tmp/a-very-long-folder-name/Another-Very-Long-Agent-Name.agent",
      result([
        {
          ...moderateFinding,
          message:
            "This deliberately long finding message must wrap without overflowing the terminal width.",
        },
      ]),
    );
    const component = createAgentScriptQualityTranscriptRenderer()(
      { data: card } as never,
      { expanded: true } as never,
      theme,
    );
    const lines = component?.render(width) ?? [];
    expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
  });
});
