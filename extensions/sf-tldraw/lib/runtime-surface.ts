/* SPDX-License-Identifier: Apache-2.0 */
/** Shared command/tool presentation for explicit tldraw runtime observations. */
import type { TldrawDocumentSummary, TldrawRuntimeStatus } from "./types.ts";

export function formatTldrawRuntimeStatus(status: TldrawRuntimeStatus): string {
  const lines = [
    "tldraw Canvas status",
    `- Runtime: ${status.kind}`,
    `- Open documents: ${status.openDocuments ?? 0}`,
    `- Focused document: ${status.focusedDocumentName ?? "none"}`,
    `- Native document creation: ${status.capabilities?.nativeDocumentCreation ? "available" : "unverified"}`,
    `- Pi skill: ${status.skillReadiness?.kind ?? "unknown"}`,
  ];
  if (status.message) lines.push(`- Note: ${status.message}`);
  if (status.skillReadiness && status.skillReadiness.kind !== "ready") {
    lines.push(`- Skill recovery: ${status.skillReadiness.message}`);
  }
  if (status.kind === "no-open-document") {
    lines.push("- Recovery: call action='create_document', then render with its document_id.");
  }
  return lines.join("\n");
}

export function formatTldrawDocuments(documents: TldrawDocumentSummary[]): string {
  if (documents.length === 0) {
    return "No tldraw documents are open. Call action='create_document', then render with its document_id.";
  }
  return [
    "Open tldraw documents:",
    ...documents.map(
      (document) =>
        `- ${document.name ?? "Untitled"} · id=${document.id} · page=${document.pageName ?? "unknown"} · shapes=${document.shapeCount ?? "unknown"}`,
    ),
  ].join("\n");
}
