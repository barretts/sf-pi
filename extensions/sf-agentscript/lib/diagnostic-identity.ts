/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic, source-bound identities for diagnostics and code actions. */
import { createHash } from "node:crypto";
import type { AgentScriptDiagnostic, AgentScriptQuickFix } from "./types.ts";

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function sourceVersionFor(source: string): string {
  return `sv1:${createHash("sha256").update(source, "utf8").digest("hex")}`;
}

export function identifyDiagnostics(
  sourceVersion: string,
  diagnostics: readonly AgentScriptDiagnostic[],
): AgentScriptDiagnostic[] {
  return diagnostics.map((diagnostic) => ({
    ...diagnostic,
    diagnosticId: `diag1:${digest([
      sourceVersion,
      diagnostic.code ?? null,
      diagnostic.source ?? null,
      diagnostic.severity,
      diagnostic.range.start.line,
      diagnostic.range.start.character,
      diagnostic.range.end.line,
      diagnostic.range.end.character,
      diagnostic.message,
    ])}`,
  }));
}

export function identifyQuickFixes(
  sourceVersion: string,
  quickFixes: readonly AgentScriptQuickFix[],
): AgentScriptQuickFix[] {
  return quickFixes.map((fix) => {
    const diagnosticId = fix.diagnosticId;
    return {
      ...fix,
      sourceVersion,
      actionId: `act1:${digest([
        sourceVersion,
        diagnosticId ?? null,
        fix.title,
        fix.preferred,
        fix.edits.map((edit) => [
          edit.range.start.line,
          edit.range.start.character,
          edit.range.end.line,
          edit.range.end.character,
          edit.newText,
        ]),
      ])}`,
    };
  });
}
