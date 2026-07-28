/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  createQualityOverrideLedger,
  evaluateQualityPublicationGate,
} from "../lib/quality/publication-gate.ts";
import type { AgentScriptQualityResult } from "../lib/quality/types.ts";

function result(ruleIds: string[], status: AgentScriptQualityResult["status"] = "findings") {
  return {
    ok: status !== "failed",
    status,
    findings: ruleIds.map((rule_id) => ({
      rule_id,
      rule_name: rule_id,
      severity: "high",
      message: "risk",
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      line: 1,
    })),
    summary: { high: ruleIds.length, moderate: 0, low: 0, info: 0 },
    metrics: { cyclomatic_complexity: [] },
    coverage: { total_rules: 18, enabled_rules: 18, disabled_rules: [] },
    suppressions: { applied: [], invalid: [], unused: [] },
    ...(status === "failed" ? { failure_reason: "boom" } : {}),
  } as AgentScriptQualityResult;
}

describe("Agent Script quality publication gate", () => {
  it("pauses on new High findings and exposes exact approval ids", () => {
    const ledger = createQualityOverrideLedger();
    expect(
      evaluateQualityPublicationGate("Bundle", result(["action-chain-too-deep"]), ledger, false),
    ).toEqual({
      proceed: false,
      riskIds: ["action-chain-too-deep"],
      newRiskIds: ["action-chain-too-deep"],
    });
  });

  it("approves rule ids for the bundle and current session only", () => {
    const ledger = createQualityOverrideLedger();
    expect(
      evaluateQualityPublicationGate("Bundle", result(["action-chain-too-deep"]), ledger, true)
        .proceed,
    ).toBe(true);
    expect(
      evaluateQualityPublicationGate("Bundle", result(["action-chain-too-deep"]), ledger, false)
        .proceed,
    ).toBe(true);
    expect(
      evaluateQualityPublicationGate("Other", result(["action-chain-too-deep"]), ledger, false)
        .proceed,
    ).toBe(false);
  });

  it("asks again when a new High rule appears", () => {
    const ledger = createQualityOverrideLedger();
    evaluateQualityPublicationGate("Bundle", result(["action-chain-too-deep"]), ledger, true);
    const next = evaluateQualityPublicationGate(
      "Bundle",
      result(["action-chain-too-deep", "deterministic-action-missing-input"]),
      ledger,
      false,
    );
    expect(next.proceed).toBe(false);
    expect(next.newRiskIds).toEqual(["deterministic-action-missing-input"]);
  });

  it("treats analyzer failure as a separate approval class", () => {
    const ledger = createQualityOverrideLedger();
    const failure = evaluateQualityPublicationGate("Bundle", result([], "failed"), ledger, false);
    expect(failure.newRiskIds).toEqual(["quality-analysis-failed"]);
  });
});
