/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  AGENT_SCRIPT_QUALITY_RULES,
  AGENT_SCRIPT_QUALITY_RULE_IDS,
  qualityRuleById,
} from "../lib/quality/catalog.ts";

describe("Agent Script quality rule catalog", () => {
  it("defines the 20-rule stable catalog with unique ids", () => {
    expect(AGENT_SCRIPT_QUALITY_RULES).toHaveLength(20);
    expect(new Set(AGENT_SCRIPT_QUALITY_RULE_IDS).size).toBe(20);
  });

  it("defaults every v1 rule on and keeps High rules non-suppressible", () => {
    expect(AGENT_SCRIPT_QUALITY_RULES.every((rule) => rule.defaultEnabled)).toBe(true);
    expect(
      AGENT_SCRIPT_QUALITY_RULES.filter((rule) => rule.severity === "high").every(
        (rule) => rule.participatesInPublishGate && !rule.suppressible,
      ),
    ).toBe(true);
  });

  it("exposes stable metadata for settings and reports", () => {
    expect(qualityRuleById("unconditional-transition-cycle")).toMatchObject({
      name: "Endless Transition Loop",
      severity: "high",
      category: "flow",
    });
    expect(qualityRuleById("variable-description-max-length")).toMatchObject({
      severity: "high",
      runsAtEditTime: true,
      participatesInPublishGate: true,
      suppressible: false,
    });
    expect(qualityRuleById("instruction-template-syntax")).toMatchObject({
      severity: "moderate",
      upstreamDiagnosticCode: "instruction-template-syntax",
      participatesInRepair: true,
      participatesInPublishGate: false,
    });
    expect(qualityRuleById("cyclomatic-complexity")).toMatchObject({
      name: "Cyclomatic Complexity",
      severity: "metric",
      participatesInRepair: false,
      participatesInPublishGate: false,
    });
  });
});
