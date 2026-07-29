/* SPDX-License-Identifier: Apache-2.0 */
/** Versioned, public-safe baseline comparison for Instruction Surface Reports. */
import { readFileSync } from "node:fs";
import path from "node:path";
import type { InstructionSurfaceReport } from "./instruction-surface-report.ts";

export interface InstructionSurfaceBaselineMeasurement {
  sf_pi_owned_chars: number;
  sf_pi_tool_definition_chars: number;
  sf_pi_tool_guidance_chars: number;
  sf_pi_hidden_context_chars: number;
  bundled_extension_skill_chars: number;
}

export interface InstructionSurfaceBaseline {
  schema_version: 1;
  pi_runtime_version: string;
  sf_pi_version: string;
  measurement: InstructionSurfaceBaselineMeasurement;
}

export type InstructionSurfaceBaselineComparison =
  | {
      comparable: true;
      baseline_sf_pi_version: string;
      deltas: InstructionSurfaceBaselineMeasurement;
    }
  | { comparable: false; reason: string };

export function compareInstructionSurfaceToBaseline(
  report: InstructionSurfaceReport,
  baseline: InstructionSurfaceBaseline | undefined,
): InstructionSurfaceBaselineComparison {
  if (!baseline) return { comparable: false, reason: "Bundled baseline is unavailable." };
  if (report.schema_version !== baseline.schema_version) {
    return { comparable: false, reason: "Measurement schema versions differ." };
  }
  if (!report.pi_runtime_version || report.pi_runtime_version !== baseline.pi_runtime_version) {
    return { comparable: false, reason: "Pi Runtime versions differ." };
  }

  const current: InstructionSurfaceBaselineMeasurement = {
    sf_pi_owned_chars: report.summary.sf_pi_owned_chars,
    sf_pi_tool_definition_chars: report.summary.sf_pi_tool_definition_chars,
    sf_pi_tool_guidance_chars: report.sections.sf_pi_tool_guidance.chars,
    sf_pi_hidden_context_chars: report.sections.sf_pi_hidden_context.chars,
    bundled_extension_skill_chars: report.sections.bundled_extension_skills.chars,
  };

  return {
    comparable: true,
    baseline_sf_pi_version: baseline.sf_pi_version,
    deltas: {
      sf_pi_owned_chars: current.sf_pi_owned_chars - baseline.measurement.sf_pi_owned_chars,
      sf_pi_tool_definition_chars:
        current.sf_pi_tool_definition_chars - baseline.measurement.sf_pi_tool_definition_chars,
      sf_pi_tool_guidance_chars:
        current.sf_pi_tool_guidance_chars - baseline.measurement.sf_pi_tool_guidance_chars,
      sf_pi_hidden_context_chars:
        current.sf_pi_hidden_context_chars - baseline.measurement.sf_pi_hidden_context_chars,
      bundled_extension_skill_chars:
        current.bundled_extension_skill_chars - baseline.measurement.bundled_extension_skill_chars,
    },
  };
}

export function loadInstructionSurfaceBaseline(
  packageRoot: string,
): InstructionSurfaceBaseline | undefined {
  try {
    const value = JSON.parse(
      readFileSync(
        path.join(packageRoot, "extensions", "sf-brain", "instruction-surface-baseline.json"),
        "utf8",
      ),
    ) as unknown;
    return isInstructionSurfaceBaseline(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function isInstructionSurfaceBaseline(value: unknown): value is InstructionSurfaceBaseline {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<InstructionSurfaceBaseline>;
  if (
    candidate.schema_version !== 1 ||
    typeof candidate.pi_runtime_version !== "string" ||
    typeof candidate.sf_pi_version !== "string" ||
    !candidate.measurement ||
    typeof candidate.measurement !== "object"
  ) {
    return false;
  }
  return Object.values(candidate.measurement).every(
    (measurement) => typeof measurement === "number" && Number.isFinite(measurement),
  );
}
