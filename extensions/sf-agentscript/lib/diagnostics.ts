/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Run the official AgentScript SDK over a `.agent` file and preserve its
 * complete diagnostic result.
 *
 * Explicit compile/check returns every upstream severity. Automatic
 * compile-on-save narrows that result to errors and warnings at its presentation
 * boundary so informational hints do not flood edit-loop context. Quick-fix
 * availability is independent from diagnostic visibility.
 */

import fs from "node:fs/promises";
import { analyzeAgentScriptSource } from "./agentforce-document.ts";
import { buildQuickFixes } from "./code-actions.ts";
import { buildLocalDiagnostics } from "./local-lints.ts";
import type { AgentScriptCheckResult } from "./types.ts";

// -------------------------------------------------------------------------------------------------
// Public API
// -------------------------------------------------------------------------------------------------

export function isAgentScriptCompileValid(diagnostics: readonly { severity: number }[]): boolean {
  return !diagnostics.some((diagnostic) => diagnostic.severity === 1);
}

/**
 * Read `filePath`, run parse + compile, return a filtered result.
 *
 * Never throws. If the SDK isn't loadable we return an `ok: false` result so
 * the caller can render a one-time setup note.
 */
export async function checkAgentScriptFile(filePath: string): Promise<AgentScriptCheckResult> {
  let source: string;
  try {
    source = await fs.readFile(filePath, "utf8");
  } catch (error) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      failureKind: "read_failed",
      unavailableReason: `Failed to read ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  return checkAgentScriptSource(source);
}

export async function checkAgentScriptSource(source: string): Promise<AgentScriptCheckResult> {
  const analysis = await analyzeAgentScriptSource(source);
  if (analysis.ok === false) {
    return {
      ok: false,
      diagnostics: [],
      quickFixes: [],
      dialect: analysis.dialect,
      failureKind: analysis.failureKind,
      unavailableReason: analysis.unavailableReason,
    };
  }

  const localDiagnostics = buildLocalDiagnostics(source);
  const diagnostics = [...analysis.analysis.compileDiagnostics, ...localDiagnostics];
  const quickFixes = await buildQuickFixes(source, diagnostics, analysis.analysis.documentState);

  return {
    ok: true,
    diagnostics,
    dialect: analysis.analysis.dialect,
    quickFixes,
  };
}
