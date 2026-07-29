/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildInstructionSurfaceReport } from "../lib/instruction-surface-report.ts";

describe("Instruction Surface Report", () => {
  it("separates SF Pi-owned, external Salesforce skill, and excluded context without leaking content", () => {
    const secretPrompt = "PRIVATE PROJECT INSTRUCTIONS";
    const secretContext = "PRIVATE GUARDRAIL BODY";
    const report = buildInstructionSurfaceReport({
      mode: "current_session",
      systemPrompt: secretPrompt,
      selectedTools: ["sf_apex", "third_party"],
      tools: [
        {
          name: "sf_apex",
          description: "Apex lifecycle",
          parameters: { type: "object", properties: { action: { type: "string" } } },
          promptSnippet: "Run Apex lifecycle work",
          promptGuidelines: ["Use sf_apex before raw CLI."],
        },
        {
          name: "sf_soql",
          description: "SOQL lifecycle",
          parameters: { type: "object" },
        },
        {
          name: "third_party",
          description: "Unrelated tool",
          parameters: { type: "object" },
        },
      ],
      skills: [
        {
          name: "generating-apex",
          description: "Generate Apex classes.",
          filePath: "/home/test/.pi/agent/sf-skills/afv-library/skills/generating-apex/SKILL.md",
        },
        {
          name: "sf-agentscript",
          description: "Operate SF Agent Script tools.",
          filePath: "/repo/extensions/sf-agentscript/skills/sf-agentscript/SKILL.md",
        },
        {
          name: "generic-skill",
          description: "Generic skill.",
          filePath: "/home/test/.pi/agent/skills/generic-skill/SKILL.md",
        },
      ],
      contextMessages: [
        { customType: "sf-guardrail-prompt", content: secretContext },
        { customType: "unrelated", content: "OTHER PRIVATE CONTEXT" },
      ],
      sfPiToolNames: ["sf_apex", "sf_soql"],
      sfPiPackageRoot: "/repo",
      externalSalesforceSkillRoots: ["/home/test/.pi/agent/sf-skills/afv-library/skills"],
    });

    expect(report.summary.system_prompt_chars).toBe(secretPrompt.length);
    expect(report.sections.sf_pi_tool_definitions.items).toBe(1);
    expect(report.sections.sf_pi_hidden_context.chars).toBe(secretContext.length);
    expect(report.sections.external_salesforce_skills.items).toBe(1);
    expect(report.sections.bundled_extension_skills.items).toBe(1);
    expect(report.sections.excluded_other_skills.items).toBe(1);
    expect(report.largest_contributors.some((item) => item.id === "sf_apex")).toBe(true);

    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(secretPrompt);
    expect(serialized).not.toContain(secretContext);
    expect(serialized).not.toContain("/home/test");
    expect(serialized).not.toContain("/repo");
  });
});
