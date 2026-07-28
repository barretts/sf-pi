/* SPDX-License-Identifier: Apache-2.0 */
/**
 * sf-tldraw — local editable Salesforce diagrams through tldraw offline.
 *
 * Behavior matrix:
 *
 *   Event/Trigger            | Result
 *   -------------------------|----------------------------------------------------------
 *   extension load           | Register `tldraw_canvas` and `/sf-tldraw`; no live probe
 *   session_start            | Cache-only local availability; no loopback verification
 *   /sf-tldraw (no args)     | Open the SF Pi Manager detail page when UI is available
 *   /sf-tldraw status        | Explicitly probe runtime and capability readiness
 *   render tool actions      | Validate, render, lint, verify terminals, capture evidence
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  getFirstTokenCompletionsFromActions,
  resolveAction,
} from "../../lib/common/command-actions.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  registerManagerDetailActions,
  type ManagerDetailAction,
} from "../../lib/common/manager-actions.ts";
import {
  openExtensionInManager,
  type SfPiManagerOpenRoute,
} from "../../lib/common/manager-deep-link.ts";
import { requirePiVersion } from "../../lib/common/pi-compat.ts";
import { withSafeCommandHandler } from "../../lib/common/safe-command-handler.ts";
import { clearTldrawStatus, setTldrawStatus } from "../../lib/common/tldraw-status/store.ts";
import { SF_TLDRAW_ACTIONS, renderHelp } from "./lib/command-surface.ts";
import { hasTldrawServerConfig, TldrawRuntimeClient } from "./lib/runtime-client.ts";
import { formatTldrawDocuments, formatTldrawRuntimeStatus } from "./lib/runtime-surface.ts";
import { effectiveSettingsText, registerTldrawCanvasTool } from "./lib/tldraw_canvas-tool.ts";

const COMMAND_NAME = "sf-tldraw";

export default function sfTldraw(pi: ExtensionAPI): void {
  if (!requirePiVersion(pi, "sf-tldraw")) return;

  registerTldrawCanvasTool(pi);

  pi.on("session_start", async () => {
    if (!hasTldrawServerConfig()) {
      clearTldrawStatus();
      return;
    }
    setTldrawStatus({
      kind: "available",
      origin: "availability",
      message: "Local tldraw server configuration detected. Verify readiness on demand.",
    });
  });
  pi.on("session_shutdown", async () => clearTldrawStatus());

  pi.registerCommand(COMMAND_NAME, {
    description: "Local tldraw Salesforce diagram status, settings, and reference",
    getArgumentCompletions: (prefix: string) =>
      getFirstTokenCompletionsFromActions(SF_TLDRAW_ACTIONS, prefix),
    handler: async (args, ctx) => {
      await withSafeCommandHandler(ctx, COMMAND_NAME, async () => {
        const trimmed = (args ?? "").trim();
        if (!trimmed && ctx.hasUI) {
          await openInManager(pi, ctx, "detail");
          return;
        }
        await handleCommand(ctx, trimmed, false);
      });
    },
  });

  registerManagerDetailActions(pi, COMMAND_NAME, managerActions());
}

function managerActions(): ManagerDetailAction[] {
  return SF_TLDRAW_ACTIONS.map((action) => ({
    id: action.value,
    label: action.label,
    description: action.description,
    group: action.group,
    run: (ctx) => handleCommand(ctx, action.value, true),
  }));
}

async function openInManager(
  pi: ExtensionAPI,
  ctx: ExtensionCommandContext,
  view: NonNullable<SfPiManagerOpenRoute["view"]>,
): Promise<void> {
  const opened = await openExtensionInManager(pi, ctx, {
    extensionId: COMMAND_NAME,
    view,
    actions: managerActions(),
  });
  if (!opened) ctx.ui.notify("SF Pi Manager is unavailable. Try /sf-pi open sf-tldraw.", "warning");
}

async function handleCommand(
  ctx: ExtensionCommandContext,
  rawArgs: string,
  fromPanel: boolean,
): Promise<void> {
  const token = rawArgs.trim().split(/\s+/)[0] ?? "";
  const action = token ? (resolveAction(SF_TLDRAW_ACTIONS, token) ?? token) : "status";
  if (action === "help") return emit(ctx, "SF tldraw help", renderHelp(), "info", fromPanel);
  if (action === "cheatsheet") {
    const text = readFileSync(path.join(import.meta.dirname, "docs", "cheatsheet.md"), "utf8");
    return emit(ctx, "SF tldraw cheatsheet", text, "info", fromPanel);
  }
  if (action === "status") {
    const client = new TldrawRuntimeClient();
    const observation = await client.observe(ctx.signal);
    setTldrawStatus({ ...observation.status, origin: "interaction" });
    const body = `${formatTldrawRuntimeStatus(observation.status)}\n\n${effectiveSettingsText(ctx.cwd)}`;
    return emit(
      ctx,
      "SF tldraw status",
      body,
      observation.status.kind === "ready" ? "success" : "warning",
      fromPanel,
    );
  }
  if (action === "documents") {
    const client = new TldrawRuntimeClient();
    const observation = await client.observe(ctx.signal);
    setTldrawStatus({ ...observation.status, origin: "interaction" });
    return emit(
      ctx,
      "Open tldraw documents",
      formatTldrawDocuments(observation.documents),
      observation.documents.length ? "info" : "warning",
      fromPanel,
    );
  }
  return emit(
    ctx,
    "SF tldraw — unknown subcommand",
    `Unknown /sf-tldraw subcommand: ${action}. Use status, documents, cheatsheet, or help.`,
    "warning",
    fromPanel,
  );
}

async function emit(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity | "success",
  fromPanel: boolean,
): Promise<void> {
  const panelSeverity: InfoPanelSeverity = severity === "success" ? "info" : severity;
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity: panelSeverity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, panelSeverity);
    return;
  }
  console.info(body);
}
