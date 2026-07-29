/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import {
  compareInstructionSurfaceToBaseline,
  type InstructionSurfaceBaseline,
} from "../lib/instruction-surface-baseline.ts";
import { buildInstructionSurfaceReport } from "../lib/instruction-surface-report.ts";

function report() {
  return buildInstructionSurfaceReport({
    mode: "current_session",
    systemPrompt: "base",
    selectedTools: ["sf_apex"],
    tools: [{ name: "sf_apex", description: "Apex", parameters: { type: "object" } }],
    skills: [],
    contextMessages: [],
    sfPiToolNames: ["sf_apex"],
    sfPiPackageRoot: "/repo",
    externalSalesforceSkillRoots: [],
    piRuntimeVersion: "0.82.1",
    sfPiVersion: "1.0.0",
  });
}

describe("Instruction Surface baseline", () => {
  it("compares compatible reports and refuses incompatible measurement versions", () => {
    const current = report();
    const baseline: InstructionSurfaceBaseline = {
      schema_version: 1,
      pi_runtime_version: "0.82.1",
      sf_pi_version: "0.9.0",
      measurement: {
        sf_pi_owned_chars: current.summary.sf_pi_owned_chars - 10,
        sf_pi_tool_definition_chars: current.summary.sf_pi_tool_definition_chars,
        sf_pi_tool_guidance_chars: 0,
        sf_pi_hidden_context_chars: 0,
        bundled_extension_skill_chars: 0,
      },
    };

    expect(compareInstructionSurfaceToBaseline(current, baseline)).toMatchObject({
      comparable: true,
      deltas: { sf_pi_owned_chars: 10, sf_pi_tool_definition_chars: 0 },
    });
    expect(
      compareInstructionSurfaceToBaseline(current, { ...baseline, pi_runtime_version: "0.99.0" }),
    ).toMatchObject({ comparable: false, reason: "Pi Runtime versions differ." });
  });
});
