/* SPDX-License-Identifier: Apache-2.0 */
/** Exact-Pi, command-only probe used by scripts/instruction-surface-report.mjs. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { VERSION, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { SF_PI_REGISTRY } from "../../catalog/registry.ts";
import { renderInstructionSurfaceMarkdown } from "../../extensions/sf-brain/lib/instruction-surface-artifact.ts";
import { readBundledConstitution } from "../../extensions/sf-brain/lib/constitution.ts";
import { formatSfPiRoutingSummary } from "../../extensions/sf-brain/lib/routing-summary.ts";
import { readBundledConfig } from "../../extensions/sf-guardrail/lib/config.ts";
import { renderGuardrailGuidance } from "../../extensions/sf-guardrail/lib/guidance.ts";
import {
  compareInstructionSurfaceToBaseline,
  loadInstructionSurfaceBaseline,
} from "../../extensions/sf-brain/lib/instruction-surface-baseline.ts";
import {
  captureInstructionSurfaceReport,
  type InstructionSurfaceRuntimeContext,
  type InstructionSurfaceRuntimePi,
} from "../../extensions/sf-brain/lib/instruction-surface-runtime.ts";

const COMMAND = "sf-pi-instruction-surface-probe";

export default function instructionSurfaceProbe(pi: ExtensionAPI): void {
  pi.registerCommand(COMMAND, {
    description: "Write a sanitized SF Pi Instruction Surface Report",
    handler: async (_args, ctx) => {
      const packageRoot = requiredEnv("SF_PI_INSTRUCTION_SURFACE_PACKAGE_ROOT");
      const outputDir = requiredEnv("SF_PI_INSTRUCTION_SURFACE_OUTPUT");
      const sfPiVersion = packageVersion(packageRoot);
      const runtimeContext = ctx as unknown as InstructionSurfaceRuntimeContext;
      const supplementalContextMessages =
        process.env.SF_PI_INSTRUCTION_SURFACE_INCLUDE_BUNDLED_CONTEXT === "1"
          ? [
              {
                customType: "sf-brain-constitution",
                content: readBundledConstitution(),
              },
              {
                customType: "sf-pi-routing-summary",
                content: formatSfPiRoutingSummary(runtimeContext.cwd),
              },
              {
                customType: "sf-guardrail-prompt",
                content: renderGuardrailGuidance(readBundledConfig()),
              },
            ]
          : [];
      const report = captureInstructionSurfaceReport(
        pi as InstructionSurfaceRuntimePi,
        runtimeContext,
        {
          sfPiPackageRoot: packageRoot,
          sfPiToolNames: SF_PI_REGISTRY.flatMap((extension) => extension.tools ?? []),
          piRuntimeVersion: VERSION,
          sfPiVersion,
          supplementalContextMessages,
        },
      );
      const comparison = compareInstructionSurfaceToBaseline(
        report,
        loadInstructionSurfaceBaseline(packageRoot),
      );

      mkdirSync(outputDir, { recursive: true });
      writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
      writeFileSync(
        path.join(outputDir, "report.md"),
        renderInstructionSurfaceMarkdown(report, comparison),
      );
    },
  });
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function packageVersion(packageRoot: string): string {
  try {
    const value = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8")) as {
      version?: unknown;
    };
    return typeof value.version === "string" ? value.version : "unknown";
  } catch {
    return "unknown";
  }
}
