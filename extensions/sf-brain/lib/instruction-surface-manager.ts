/* SPDX-License-Identifier: Apache-2.0 */
/** SF Brain Manager diagnostics for the advisory Instruction Surface Report. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { ManagerDetailAction } from "../../../lib/common/manager-actions.ts";
import {
  compareInstructionSurfaceToBaseline,
  loadInstructionSurfaceBaseline,
} from "./instruction-surface-baseline.ts";
import { InstructionSurfacePanel } from "./instruction-surface-panel.ts";
import {
  captureInstructionSurfaceReport,
  type CaptureInstructionSurfaceOptions,
  type InstructionSurfaceRuntimeContext,
  type InstructionSurfaceRuntimePi,
} from "./instruction-surface-runtime.ts";

export function buildSfBrainManagerActions(
  pi: Pick<ExtensionAPI, "getAllTools">,
  options: CaptureInstructionSurfaceOptions,
): ManagerDetailAction[] {
  return [
    {
      id: "instruction-surface",
      label: "Instruction surface",
      description: "Inspect model-visible Salesforce context size and contributors.",
      group: "Diagnostics",
      acceptsScope: false,
      run: () => undefined,
      createPanel: (theme, _cwd, _scope, done, ctx) => {
        const report = captureInstructionSurfaceReport(
          pi as InstructionSurfaceRuntimePi,
          ctx as unknown as InstructionSurfaceRuntimeContext,
          options,
        );
        const comparison = compareInstructionSurfaceToBaseline(
          report,
          loadInstructionSurfaceBaseline(options.sfPiPackageRoot),
        );
        return new InstructionSurfacePanel(theme, report, done, comparison);
      },
    },
  ];
}
