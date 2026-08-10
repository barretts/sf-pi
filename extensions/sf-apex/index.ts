/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-apex behavior contract
 *
 * SF Apex is a lean Apex Lifecycle Extension: it owns Apex authoring guidance,
 * bounded diagnostics, trace/log/watch, Anonymous Apex probes, and targeted
 * tests while leaving source edits to normal Pi file tools.
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | Register the sf_apex lifecycle tool
 *   /sf-apex (no args)     | Open the extension detail in the SF Pi Manager
 *   /sf-apex status        | Print status as plain text (headless-safe)
 *   /sf-apex help          | Print command usage as plain text
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
  ExtensionContext,
  ToolResultEvent,
} from "@earendil-works/pi-coding-agent";
import {
  getFirstTokenCompletionsFromActions,
  type SfPiCommandAction,
} from "../../lib/common/command-actions.ts";
import type { InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import { openExtensionInManager } from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { beginSalesforceConnectionSession } from "../../lib/common/sf-conn/index.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { registerSfApexTool } from "./lib/sf-apex-tool.ts";
import { diagnoseApexFile, isApexFile, resolveToolPath } from "./lib/diagnostics.ts";

const COMMAND_NAME = "sf-apex";

type SfApexAction = "status" | "help";

const SF_APEX_ACTIONS: SfPiCommandAction<SfApexAction>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current SF Apex extension status.",
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
  if (!requirePiVersion(pi, "sf-apex")) return;

  pi.on("session_start", async (event) => {
    beginSalesforceConnectionSession(event);
    registerSfApexTool(pi);
  });
  pi.on("tool_result", async (event, ctx) => handleToolResult(event, ctx));

  pi.registerCommand(COMMAND_NAME, {
    description: "SF Apex — Apex lifecycle status & controls",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_APEX_ACTIONS, prefix),
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
    ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-apex.", "warning");
  }
}

async function handleToolResult(event: ToolResultEvent, ctx: ExtensionContext) {
  if (event.isError || !isFileMutationToolResult(event)) return undefined;
  const rawPath = event?.input?.path;
  if (typeof rawPath !== "string" || rawPath.trim() === "") return undefined;
  const filePath = resolveToolPath(rawPath, ctx.cwd);
  if (!filePath || !isApexFile(filePath)) return undefined;

  const result = await diagnoseApexFile(filePath, ctx.cwd);
  if (result.details.ok === true && result.details.status === "clean") return undefined;

  const existingContent = Array.isArray(event.content) ? event.content : [];
  return {
    content: [
      ...existingContent,
      {
        type: "text" as const,
        text: `\n\nSF Apex diagnostics:\n${result.content[0]?.text ?? ""}`,
      },
    ],
    details: {
      ...(typeof event.details === "object" && event.details ? event.details : {}),
      sf_apex_diagnostics: result.details,
    },
  };
}

function isFileMutationToolResult(event: ToolResultEvent): boolean {
  return event.toolName === "write" || event.toolName === "edit";
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
    "SF Apex is installed.",
    "Use the sf_apex tool for API-native Apex lifecycle workflows.",
    "Use /sf-apex with no args to open its SF Pi Manager detail page.",
  ].join("\n");
}

function helpText(): string {
  return [
    "Commands:",
    "  /sf-apex          Open SF Apex in the SF Pi Manager",
    "  /sf-apex status   Print extension status",
    "  /sf-apex help     Print this help",
    "",
    "Tool actions:",
    "  status, org.preflight, apex.search",
    "  test.discover, test.plan, coverage.summary",
    "  author.plan, diagnose.file",
    "  trace.start, trace.stop, trace.status",
    "  log.latest, log.get, log.analyze, log.watch",
    "  anon.run",
    "  test.run, test.result, test.rerun",
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
