/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { captureInstructionSurfaceReport } from "../lib/instruction-surface-runtime.ts";

describe("captureInstructionSurfaceReport", () => {
  it("uses active Pi tools and the latest active-branch context without exposing source content", () => {
    const pi = {
      getAllTools: () => [
        {
          name: "sf_apex",
          description: "Apex lifecycle",
          parameters: { type: "object" },
          promptGuidelines: ["Use sf_apex."],
        },
        { name: "sf_soql", description: "SOQL lifecycle", parameters: { type: "object" } },
      ],
    };
    const ctx = {
      cwd: "/repo",
      getSystemPrompt: () => "BASE SYSTEM PROMPT",
      getSystemPromptOptions: () => ({
        selectedTools: ["sf_apex"],
        toolSnippets: { sf_apex: "Run Apex work" },
        skills: [
          {
            name: "generating-apex",
            description: "Generate Apex.",
            filePath: "/agent/sf-skills/afv-library/skills/generating-apex/SKILL.md",
          },
        ],
      }),
      sessionManager: {
        buildContextEntries: () => [
          {
            type: "custom_message",
            customType: "sf-brain-constitution",
            content: "OLD CONSTITUTION",
          },
          {
            type: "custom_message",
            customType: "sf-brain-constitution",
            content: "LATEST CONSTITUTION",
          },
          { type: "custom", customType: "sf-brain-state", data: { secret: true } },
        ],
      },
    };

    const report = captureInstructionSurfaceReport(pi, ctx, {
      sfPiPackageRoot: "/repo",
      sfPiToolNames: ["sf_apex", "sf_soql"],
      externalSalesforceSkillRoots: ["/agent/sf-skills/afv-library/skills"],
      piRuntimeVersion: "0.82.1",
      sfPiVersion: "1.2.3",
    });

    expect(report.sections.sf_pi_tool_definitions.items).toBe(1);
    expect(report.sections.sf_pi_tool_guidance.items).toBe(2);
    expect(report.sections.sf_pi_hidden_context.items).toBe(1);
    expect(report.sections.sf_pi_hidden_context.chars).toBe("LATEST CONSTITUTION".length);
    expect(report.sections.external_salesforce_skills.items).toBe(1);
    expect(report.pi_runtime_version).toBe("0.82.1");
    expect(JSON.stringify(report)).not.toContain("LATEST KERNEL");
    expect(JSON.stringify(report)).not.toContain("secret");
  });
});
