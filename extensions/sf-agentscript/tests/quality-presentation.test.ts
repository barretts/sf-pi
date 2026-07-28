/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { buildQualityRepairPayload } from "../lib/quality/presentation.ts";
import type { AgentScriptQualityFinding } from "../lib/quality/types.ts";

function finding(
  index: number,
  severity: AgentScriptQualityFinding["severity"] = "moderate",
): AgentScriptQualityFinding {
  return {
    rule_id: severity === "low" ? "action-before-transition" : "unused-action",
    rule_name: severity === "low" ? "Action Before Transition" : "Unused Action",
    severity,
    message: `Finding ${index}`,
    range: { start: { line: index, character: 0 }, end: { line: index, character: 1 } },
    line: index + 1,
  };
}

describe("Agent Script quality LLM repair payload", () => {
  it("contains only bounded actionable data and deterministic verification calls", () => {
    const findings = [finding(0, "low"), ...Array.from({ length: 12 }, (_, i) => finding(i + 1))];
    const payload = buildQualityRepairPayload("/tmp/A.agent", findings, 2, "signature");

    expect(payload).toMatchObject({
      version: 1,
      task: "repair_agent_script_quality",
      file: "/tmp/A.agent",
      attempt: 2,
      finding_signature: "signature",
    });
    expect(payload.findings).toHaveLength(10);
    expect(payload.findings.every((item) => item.severity === "moderate")).toBe(true);
    expect(payload.verify).toEqual([
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: "/tmp/A.agent" },
      },
      {
        tool: "agentscript_authoring",
        params: { verb: "inspect", mode: "quality", agent_file: "/tmp/A.agent" },
      },
    ]);
    expect(JSON.stringify(payload)).not.toContain("rule_name");
  });
});
