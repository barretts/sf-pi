/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { AGENT_SCRIPT_QUALITY_RULES } from "../lib/quality/catalog.ts";
import { renderLifecycleResult } from "../lib/render/lifecycle.ts";
import type { AgentScriptQualityResult } from "../lib/quality/types.ts";

const theme = {
  fg: (_color: string, value: string) => value,
  bg: (_color: string, value: string) => value,
  bold: (value: string) => value,
} as Theme;

const quality: AgentScriptQualityResult = {
  ok: true,
  status: "findings",
  findings: [
    {
      rule_id: "unconditional-transition-cycle",
      rule_name: "Endless Transition Loop",
      severity: "high",
      message: "Cycle: a → b → a.",
      range: { start: { line: 20, character: 0 }, end: { line: 20, character: 5 } },
      line: 21,
    },
  ],
  summary: { high: 1, moderate: 0, low: 0, info: 0 },
  coverage: {
    total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
    enabled_rules: AGENT_SCRIPT_QUALITY_RULES.length,
    disabled_rules: [],
  },
  metrics: { cyclomatic_complexity: [] },
  suppressions: { applied: [], invalid: [], unused: [] },
};

describe("Agent Script lifecycle quality card", () => {
  it("renders publication-gate evidence as a blocked card", () => {
    const component = renderLifecycleResult(
      {
        details: {
          ok: false,
          action: "publish.quality_gate",
          quality_gate: {
            file: "/tmp/Gate.agent",
            risk_ids: ["unconditional-transition-cycle"],
            quality,
          },
        },
      },
      { expanded: true },
      theme,
    );
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("✕ Agent Script Quality · Gate.agent");
    expect(rendered).toContain("Publication paused by High quality findings");
    expect(rendered).toContain("Endless Transition Loop L21");
    expect(rendered).toContain("Approval required for: unconditional-transition-cycle");
  });
});
