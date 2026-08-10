/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-soql behavior contract
 *
 * SF SOQL is a lean SOQL Lifecycle Extension: it owns schema-aware query
 * describe, validation, explain, bounded execution, and artifacts while leaving
 * source edits to normal Pi file tools and broad exploration to sf-data-explorer.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  type SfPiCommandAction,
} from "../../lib/common/command-actions.ts";
import type { InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { beginSalesforceConnectionSession } from "../../lib/common/sf-conn/index.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfSoqlTool } from "./lib/sf-soql-tool.ts";

const COMMAND_NAME = "sf-soql";

type SfSoqlAction = "status" | "help";

const SF_SOQL_ACTIONS: SfPiCommandAction<SfSoqlAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF SOQL extension status.",
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
  if (!requirePiVersion(pi, "sf-soql")) return;

  pi.on("session_start", async (event) => {
    beginSalesforceConnectionSession(event);
    registerSfSoqlTool(pi);
  });

  pi.registerCommand(COMMAND_NAME, {
    description: "SF SOQL — query lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_SOQL_ACTIONS, prefix),
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
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-soql.", "warning");
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
    "SF SOQL is installed.",
    "Use the sf_soql tool for API-native SOQL lifecycle workflows.",
    "Use /sf-soql with no args to open its SF Pi Manager detail page.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-soql          Open SF SOQL in the SF Pi Manager",
    "  /sf-soql status   Print extension status",
    "  /sf-soql help     Print this help",
    "",
    "Tool actions:",
    "  status, org.preflight",
    "  schema.search, schema.describe, schema.relationships",
    "  query.draft, query.validate, query.explain, query.sample",
    "  query.run, query.count, query.queryAll, query.export",
    "  sosl.run, file.diagnose, lsp.status",
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
