/* SPDX-License-Identifier: Apache-2.0 */
/** The single tldraw Canvas API family tool. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { setTldrawStatus } from "../../../lib/common/tldraw-status/store.ts";
import { persistStandaloneScreenshot } from "./artifacts.ts";
import { renderSalesforceDiagram } from "./renderer.ts";
import { sanitizeRuntimeText, sanitizeRuntimeValue } from "./redaction.ts";
import { readEffectiveTldrawPreferences } from "./settings.ts";
import { TldrawRuntimeClient, TldrawRuntimeError } from "./runtime-client.ts";
import type {
  DiagramFamily,
  OutputMode,
  RenderMode,
  TldrawAction,
  TldrawPreferences,
} from "./types.ts";

export const TLDRAW_CANVAS_TOOL_NAME = "tldraw_canvas";
export const TLDRAW_CANVAS_DETAILS_KEY = "sfTldraw";

const Params = Type.Object(
  {
    action: StringEnum(
      [
        "status",
        "documents",
        "search",
        "execute",
        "screenshot",
        "script_workspace",
        "script_status",
        "cheatsheet",
        "render_salesforce_data_model",
        "render_salesforce_architecture",
        "render_salesforce_sequence",
      ] as const,
      { description: "tldraw Canvas action." },
    ),
    document_id: Type.Optional(
      Type.String({
        description:
          "Opaque id returned by action='documents'. Omit to use the focused open document.",
      }),
    ),
    query: Type.Optional(
      Type.String({ description: "Document, page, or shape-text query for action='search'." }),
    ),
    script: Type.Optional(
      Type.String({ description: "Raw tldraw editor JavaScript for action='execute'." }),
    ),
    acknowledge_raw_canvas: Type.Optional(
      Type.Boolean({ description: "Required true for action='execute'." }),
    ),
    acknowledge_workspace_creation: Type.Optional(
      Type.Boolean({
        description: "Required true for action='script_workspace', which can create starter files.",
      }),
    ),
    size: Type.Optional(
      StringEnum(["small", "medium", "large", "full"] as const, {
        description: "Screenshot size. Defaults to small.",
      }),
    ),
    screenshot_mode: Type.Optional(
      StringEnum(["canvas", "window"] as const, {
        description: "Screenshot capture mode. Defaults to canvas.",
      }),
    ),
    bounds: Type.Optional(
      Type.Object(
        { x: Type.Number(), y: Type.Number(), w: Type.Number(), h: Type.Number() },
        { additionalProperties: false },
      ),
    ),
    image_mode: Type.Optional(
      StringEnum(["artifact", "thumbnail", "full"] as const, {
        description: "How screenshot image content is returned. Defaults to thumbnail.",
      }),
    ),
    spec: Type.Optional(
      Type.Any({
        description: "Versioned, explicitly grounded Salesforce Diagram Spec for render actions.",
      }),
    ),
    page_name: Type.Optional(
      Type.String({
        description:
          "Page name. Existing pages are reconciled; missing pages are created in the open document.",
      }),
    ),
    render_mode: Type.Optional(
      StringEnum(["preserve", "relayout", "replace"] as const, {
        description: "Preserve human positions by default; relayout and replace are explicit.",
      }),
    ),
    cardinality_detail: Type.Optional(StringEnum(["simplified", "full"] as const)),
    card_fill: Type.Optional(
      StringEnum(["transparent", "family"] as const, {
        description:
          "Data-model card interior. Defaults to the transparent (white) card from settings.",
      }),
    ),
    ldv_threshold: Type.Optional(StringEnum(["1M", "2M", "5M", "10M"] as const)),
    record_type_mode: Type.Optional(StringEnum(["off", "auto", "always"] as const)),
    interaction_mode: Type.Optional(StringEnum(["static", "step_through"] as const)),
    output_mode: Type.Optional(
      StringEnum(["summary", "inline", "file_only"] as const, {
        description: "Result detail level. Defaults to summary.",
      }),
    ),
  },
  { additionalProperties: false },
);

type ToolContent =
  { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };

type Input = {
  action: TldrawAction;
  document_id?: string;
  query?: string;
  script?: string;
  acknowledge_raw_canvas?: boolean;
  acknowledge_workspace_creation?: boolean;
  size?: "small" | "medium" | "large" | "full";
  screenshot_mode?: "canvas" | "window";
  bounds?: { x: number; y: number; w: number; h: number };
  image_mode?: "artifact" | "thumbnail" | "full";
  spec?: unknown;
  page_name?: string;
  render_mode?: RenderMode;
  cardinality_detail?: TldrawPreferences["cardinalityDetail"];
  card_fill?: TldrawPreferences["cardFill"];
  ldv_threshold?: TldrawPreferences["ldvThreshold"];
  record_type_mode?: TldrawPreferences["recordTypeMode"];
  interaction_mode?: TldrawPreferences["interactionMode"];
  output_mode?: OutputMode;
};

export function registerTldrawCanvasTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof Params>({
    name: TLDRAW_CANVAS_TOOL_NAME,
    label: "tldraw Canvas",
    description:
      "Inspect and operate the local tldraw offline Canvas API, or deterministically render grounded Salesforce data-model, architecture, and sequence diagrams.",
    promptSnippet: "Render editable, deterministic Salesforce diagrams in a local tldraw canvas.",
    promptGuidelines: [
      "Use tldraw_canvas for Salesforce diagrams when the local canvas is ready; explicit Mermaid or text requests win.",
      "For Salesforce render actions, pass a versioned spec with grounding.mode='reference' or 'org' and evidence source ids for every semantic element. Never infer or fabricate Salesforce facts.",
      "Call action='documents' before rendering when more than one board may be open. The current runtime can create pages inside open documents but cannot create a new document natively.",
      "Default render_mode='preserve' keeps human positioning and annotations. Use relayout or replace only when explicitly requested.",
      "A render is complete only when readiness is true, canvas lints are zero, terminal decoration checks pass, and screenshot evidence was captured.",
      "Use action='cheatsheet' only when the tldraw/Salesforce spec contract is needed; it is not always-on context.",
      "Never use OS automation or direct .tldraw archive generation as a fallback for missing Canvas API capabilities.",
    ],
    parameters: Params,
    async execute(_toolCallId, params, signal, onUpdate, ctx) {
      const input = params as Input;
      const client = new TldrawRuntimeClient();
      onUpdate?.({ content: [{ type: "text", text: progressMessage(input.action) }], details: {} });
      try {
        if (input.action === "status") {
          const status = await client.status(signal);
          setTldrawStatus(status);
          return ok(input.action, formatStatus(status), { status });
        }
        if (input.action === "cheatsheet") {
          const text = readFileSync(
            path.join(import.meta.dirname, "..", "docs", "cheatsheet.md"),
            "utf8",
          );
          return ok(input.action, text, { lazy: true });
        }
        if (input.action === "documents") {
          const documents = await client.documents(signal);
          const status = await client.status(signal);
          setTldrawStatus(status);
          return ok(input.action, formatDocuments(documents), {
            documents,
            capabilities: status.capabilities,
          });
        }
        if (input.action === "search") {
          if (!input.query?.trim())
            return fail(input.action, "query is required for action='search'.", "missing_query");
          const matches = await client.search(input.query, signal);
          return ok(
            input.action,
            matches.length
              ? JSON.stringify(matches, null, 2)
              : `No tldraw matches for '${input.query}'.`,
            { matches },
          );
        }
        if (input.action === "execute") {
          if (input.acknowledge_raw_canvas !== true)
            return fail(
              input.action,
              "Raw canvas execution requires acknowledge_raw_canvas=true.",
              "acknowledgement_required",
            );
          if (!input.script?.trim())
            return fail(input.action, "script is required for action='execute'.", "missing_script");
          if (!ctx.hasUI) {
            return fail(
              input.action,
              "Raw canvas execution requires an interactive user confirmation.",
              "user_confirmation_required",
            );
          }
          const document = await client.resolveDocument(input.document_id, signal);
          const confirmed = await ctx.ui.confirm(
            "Run raw tldraw Canvas script?",
            `Document: ${document.name ?? document.id}\n\n${clip(input.script, 800)}`,
          );
          if (!confirmed) return fail(input.action, "Raw canvas execution cancelled.", "cancelled");
          const result = sanitizeRuntimeValue(
            await client.execute(document.id, input.script, signal),
          );
          return ok(input.action, clip(JSON.stringify(result, null, 2), 6000), {
            documentId: document.id,
            result,
          });
        }
        if (input.action === "screenshot") {
          const document = await client.resolveDocument(input.document_id, signal);
          const screenshot = await client.screenshot(
            document.id,
            {
              size: input.size ?? "small",
              mode: input.screenshot_mode ?? "canvas",
              bounds: input.bounds,
            },
            signal,
          );
          const artifact = persistStandaloneScreenshot({ documentId: document.id, screenshot });
          const publicScreenshot = {
            width: screenshot.width,
            height: screenshot.height,
            pageName: screenshot.pageName,
            captureMode: screenshot.captureMode,
          };
          const content: ToolContent[] = [
            {
              type: "text",
              text: `Captured tldraw screenshot.\nDocument: ${document.name ?? document.id}\nPage: ${screenshot.pageName}\nArtifact: ${artifact.screenshotPath}\nMode: ${screenshot.captureMode}`,
            },
          ];
          const image = imageContent(artifact.screenshotPath, input.image_mode ?? "thumbnail");
          if (image) content.push(image);
          return {
            content,
            details: {
              [TLDRAW_CANVAS_DETAILS_KEY]: {
                ok: true,
                action: input.action,
                documentId: document.id,
                screenshot: publicScreenshot,
                artifact,
              },
            },
          };
        }
        if (input.action === "script_workspace") {
          if (input.acknowledge_workspace_creation !== true)
            return fail(
              input.action,
              "script_workspace can create starter files and requires acknowledge_workspace_creation=true.",
              "acknowledgement_required",
            );
          if (!ctx.hasUI) {
            return fail(
              input.action,
              "Document-script workspace creation requires an interactive user confirmation.",
              "user_confirmation_required",
            );
          }
          const document = await client.resolveDocument(input.document_id, signal);
          const confirmed = await ctx.ui.confirm(
            "Create or open the tldraw document-script workspace?",
            `Document: ${document.name ?? document.id}\n\nThis can create starter files for the open board.`,
          );
          if (!confirmed)
            return fail(input.action, "Document-script workspace creation cancelled.", "cancelled");
          const workspace = sanitizeRuntimeValue(await client.scriptWorkspace(document.id, signal));
          return ok(input.action, formatObject(workspace), { documentId: document.id, workspace });
        }
        if (input.action === "script_status") {
          const document = await client.resolveDocument(input.document_id, signal);
          const status = sanitizeRuntimeValue(await client.scriptStatus(document.id, signal));
          return ok(input.action, formatObject(status), { documentId: document.id, status });
        }
        if (isRenderAction(input.action)) {
          const family = familyForAction(input.action);
          const outcome = await renderSalesforceDiagram(
            {
              family,
              spec: input.spec,
              documentId: input.document_id,
              pageName: input.page_name,
              mode: input.render_mode,
              outputMode: input.output_mode,
              preferences: {
                ...(input.cardinality_detail
                  ? { cardinalityDetail: input.cardinality_detail }
                  : {}),
                ...(input.card_fill ? { cardFill: input.card_fill } : {}),
                ...(input.ldv_threshold ? { ldvThreshold: input.ldv_threshold } : {}),
                ...(input.record_type_mode ? { recordTypeMode: input.record_type_mode } : {}),
                ...(input.interaction_mode ? { interactionMode: input.interaction_mode } : {}),
              },
            },
            { cwd: ctx.cwd, signal, client },
          );
          if (outcome.ok === false) {
            return fail(input.action, outcome.message, outcome.reason, {
              validation: outcome.validation,
              readiness: outcome.result?.readiness,
              recover_via: outcome.recoverVia,
            });
          }
          const summary = formatRenderSuccess(outcome);
          const content: ToolContent[] = [{ type: "text", text: summary }];
          if (outcome.outputMode !== "file_only" && outcome.artifact.thumbnailPath) {
            const image = imageContent(outcome.artifact.thumbnailPath, "thumbnail");
            if (image) content.push(image);
          }
          return {
            content,
            details: {
              [TLDRAW_CANVAS_DETAILS_KEY]: {
                ok: true,
                action: input.action,
                result: outcome.result,
                artifact: outcome.artifact,
              },
            },
          };
        }
        return fail(
          input.action,
          `Unsupported tldraw_canvas action '${input.action}'.`,
          "unsupported_action",
        );
      } catch (error) {
        if (error instanceof TldrawRuntimeError) {
          return fail(input.action, error.message, error.code, {
            recover_via: runtimeRecovery(error.code),
          });
        }
        return fail(
          input.action,
          `tldraw_canvas failed: ${sanitizeRuntimeText(error instanceof Error ? error.message : String(error)).slice(0, 500)}`,
          "unexpected_error",
        );
      }
    },
  });
}

function isRenderAction(action: TldrawAction): boolean {
  return action.startsWith("render_salesforce_");
}

function familyForAction(action: TldrawAction): DiagramFamily {
  if (action === "render_salesforce_data_model") return "data_model";
  if (action === "render_salesforce_architecture") return "architecture";
  return "sequence";
}

function progressMessage(action: TldrawAction): string {
  return action.startsWith("render_")
    ? `Validating and rendering ${action.replace("render_salesforce_", "").replaceAll("_", " ")}…`
    : `Running tldraw Canvas action: ${action}…`;
}

function formatStatus(status: Awaited<ReturnType<TldrawRuntimeClient["status"]>>): string {
  const lines = [
    "tldraw Canvas status",
    `- Runtime: ${status.kind}`,
    `- Open documents: ${status.openDocuments ?? 0}`,
    `- Focused document: ${status.focusedDocumentName ?? "none"}`,
    `- Native document creation: ${status.capabilities?.nativeDocumentCreation ? "available" : "unavailable"}`,
  ];
  if (status.message) lines.push(`- Note: ${status.message}`);
  if (!status.capabilities?.nativeDocumentCreation)
    lines.push(
      "- Recovery: open a board in tldraw offline; sf-tldraw will not use OS automation or generate .tldraw archives.",
    );
  return lines.join("\n");
}

function formatDocuments(
  documents: Array<{ id: string; name?: string; pageName?: string; shapeCount?: number }>,
): string {
  if (documents.length === 0)
    return "No tldraw documents are open. Open or create a board in tldraw offline, then retry.";
  return [
    "Open tldraw documents:",
    ...documents.map(
      (document) =>
        `- ${document.name ?? "Untitled"} · id=${document.id} · page=${document.pageName ?? "unknown"} · shapes=${document.shapeCount ?? "unknown"}`,
    ),
  ].join("\n");
}

function formatRenderSuccess(
  outcome: Extract<Awaited<ReturnType<typeof renderSalesforceDiagram>>, { ok: true }>,
): string {
  const { result, artifact } = outcome;
  return [
    `Rendered Salesforce ${result.family.replaceAll("_", " ")} diagram.`,
    `Document: ${result.documentId}`,
    `Page: ${result.pageName}`,
    `Shapes: ${result.createdShapes} created · ${result.updatedShapes} updated · ${result.deletedShapes} removed`,
    `Readiness: ready · lints=${result.readiness.lintCount} · marker checks=${result.readiness.markerChecks.length}`,
    result.readiness.warnings.length
      ? `Warnings: ${result.readiness.warnings.join(" | ")}`
      : "Warnings: none",
    `Report: ${artifact.reportPath}`,
    `Full image: ${artifact.screenshotPath ?? "not written"}`,
    `Thumbnail: ${artifact.thumbnailPath ?? "not written"}`,
  ].join("\n");
}

function imageContent(
  filePath: string,
  mode: "artifact" | "thumbnail" | "full",
): { type: "image"; data: string; mimeType: string } | null {
  if (mode === "artifact") return null;
  try {
    if (statSync(filePath).size > 1_500_000) return null;
    return {
      type: "image",
      data: readFileSync(filePath).toString("base64"),
      mimeType: filePath.endsWith(".png") ? "image/png" : "image/jpeg",
    };
  } catch {
    return null;
  }
}

function ok(action: TldrawAction, text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details: { [TLDRAW_CANVAS_DETAILS_KEY]: { ok: true, action, ...details } },
  };
}

function fail(
  action: TldrawAction,
  text: string,
  reason: string,
  details: Record<string, unknown> = {},
) {
  return {
    content: [{ type: "text" as const, text }],
    details: { [TLDRAW_CANVAS_DETAILS_KEY]: { ok: false, action, reason, ...details } },
  };
}

function formatObject(value: unknown): string {
  return clip(JSON.stringify(sanitizeRuntimeValue(value), null, 2), 8000);
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}\n…truncated`;
}

function runtimeRecovery(code: TldrawRuntimeError["code"]): Record<string, unknown> {
  if (code === "no_open_document" || code === "not_found")
    return { action: "documents", instruction: "Open a board in tldraw offline." };
  return { action: "status", command: "/sf-tldraw status" };
}

export function effectiveSettingsText(cwd: string): string {
  const settings = readEffectiveTldrawPreferences(cwd);
  return [
    `Cardinality: ${settings.cardinalityDetail}`,
    `Card fill: ${settings.cardFill}`,
    `LDV threshold: ${settings.ldvThreshold}`,
    `Record types: ${settings.recordTypeMode}`,
    `Interaction: ${settings.interactionMode}`,
  ].join(" · ");
}
