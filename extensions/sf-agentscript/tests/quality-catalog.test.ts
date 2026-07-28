/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  AGENT_SCRIPT_QUALITY_RULES,
  AGENT_SCRIPT_QUALITY_RULE_IDS,
  qualityRuleById,
} from "../lib/quality/catalog.ts";

describe("Agent Script quality rule catalog", () => {
  it("defines the frozen 18-rule v1 catalog with unique ids", () => {
    expect(AGENT_SCRIPT_QUALITY_RULES).toHaveLength(18);
    expect(new Set(AGENT_SCRIPT_QUALITY_RULE_IDS).size).toBe(18);
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
    expect(qualityRuleById("cyclomatic-complexity")).toMatchObject({
      name: "Cyclomatic Complexity",
      severity: "metric",
      participatesInRepair: false,
      participatesInPublishGate: false,
    });
  });
});
