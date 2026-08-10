/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-lwc behavior contract
 *
 * SF LWC is a lean local-native LWC Lifecycle Extension. It owns local SFDX
 * project scans, component inspection, focused LWC diagnostics, targeted local
 * Jest runs, and artifacts while leaving source edits, deploy/retrieve, visual
 * preview, org source evidence, and broad static analysis to existing SF Pi
 * surfaces.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | Register the sf_lwc lifecycle tool
 *   /sf-lwc (no args)      | Open the extension detail in the SF Pi Manager
 *   /sf-lwc status         | Print status as plain text (headless-safe)
 *   /sf-lwc help           | Print command usage as plain text
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  type SfPiCommandAction,
} from "../../lib/common/command-actions.ts";
import type { InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfLwcTool } from "./lib/sf-lwc-tool.ts";

const COMMAND_NAME = "sf-lwc";

type SfLwcAction = "status" | "help";

const SF_LWC_ACTIONS: SfPiCommandAction<SfLwcAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF LWC extension status.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command and tool usage.",
    group: "Reference",
  },
];

export default function (pi: ExtensionAPI) {
  if (!requirePiVersion(pi, "sf-lwc")) return;

  pi.on("session_start", async () => {
    registerSfLwcTool(pi);
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF LWC — local LWC lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_LWC_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const sub = (args ?? "").trim().toLowerCase();
        if (sub === "" && ctx.hasUI) {
          await openInManager(pi, ctx);
          return;
        }
        await handleAction(ctx, sub === "" ? "status" : sub);
      });
    },
  });
}

async function openInManager(pi: ExtensionAPI, ctx: ExtensionCommandContext): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view: "detail",
  });
  if (!opened) {
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-lwc.", "warning");
  }
}

async function handleAction(ctx: ExtensionCommandContext, action: string): Promise<void> {
  if (action === "status") {
    await emitOutput(ctx, statusText(), "info");
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, helpText(), "info");
    return;
  }
  await emitOutput(ctx, `Unknown /${COMMAND_NAME} subcommand: ${action}`, "warning");
}

function statusText(): string {
  return [
    "SF LWC is installed.",
    "Use the sf_lwc tool for local-native Lightning Web Component lifecycle workflows.",
    "Use /sf-lwc with no args to open its SF Pi Manager detail page.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-lwc          Open SF LWC in the SF Pi Manager",
    "  /sf-lwc status   Print extension status",
    "  /sf-lwc help     Print this help",
    "",
    "Tool actions:",
    "  status",
    "  project.scan, component.list, component.inspect",
    "  file.diagnose",
    "  test.discover, test.plan, test.run",
    "  history.last, history.rerun",
  ].join("\n");
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  body: string,
  severity: InfoPanelSeverity,
): Promise<void> {
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
