/* SPDX-License-Identifier: Apache-2.0 */
/** Source-bound, fail-closed selection of one current Agent Script quick fix. */
import { getAgentScriptAnalysis, invalidateAgentScriptAnalysis } from "./analysis-snapshot.ts";
import { sourceVersionFor } from "./diagnostic-identity.ts";
import type { AgentScriptDiagnostic, AgentScriptQuickFix } from "./types.ts";

export interface QuickFixSelector {
  diagnostic_code?: string;
  line?: number;
  fix_index?: number;
  source_version?: string;
  diagnostic_id?: string;
  action_id?: string;
}

export interface QuickFixCandidate {
  line: number;
  diagnostic_id?: string;
  action_id?: string;
  code?: string;
  message?: string;
  title?: string;
}

export type QuickFixSelectionResult =
  | { ok: true; fix: AgentScriptQuickFix }
  | {
      ok: false;
      reason: string;
      reason_detail?: string;
      candidates?: QuickFixCandidate[];
    };

export async function selectCurrentQuickFix(
  path: string,
  source: string,
  selector: QuickFixSelector,
): Promise<QuickFixSelectionResult> {
  const currentSourceVersion = sourceVersionFor(source);
  if (selector.source_version && selector.source_version !== currentSourceVersion) {
    return failure(
      "stale_source",
      "The file changed after this quick fix was generated. Re-run agentscript_authoring compile/check and use the new action identity.",
    );
  }

  // File metadata can be preserved across same-size external edits, so require
  // the cached analysis to match the exact source bytes already read.
  let snapshot = await getAgentScriptAnalysis(path);
  if (snapshot.source !== source) {
    invalidateAgentScriptAnalysis(path);
    snapshot = await getAgentScriptAnalysis(path);
  }
  if (snapshot.source !== source) {
    return failure(
      "stale_source",
      "The source changed while preparing the quick fix. Recompile and retry.",
    );
  }

  const compile = await snapshot.getCompile();
  if (!compile.ok) return failure("compile_failed", compile.unavailableReason);

  let fix: AgentScriptQuickFix | undefined;
  if (selector.action_id) {
    const matches = compile.quickFixes.filter(
      (candidate) =>
        candidate.actionId === selector.action_id &&
        (!selector.diagnostic_id || candidate.diagnosticId === selector.diagnostic_id),
    );
    if (matches.length === 0) {
      return failure(
        "no_matching_quick_fix",
        "The requested action identity is not valid for the current source. Re-run compile/check.",
      );
    }
    if (matches.length > 1) return ambiguousQuickFix(matches);
    fix = matches[0];
  } else if (selector.diagnostic_id) {
    const diagnostics = compile.diagnostics.filter(
      (diagnostic) => diagnostic.diagnosticId === selector.diagnostic_id,
    );
    if (diagnostics.length === 0) {
      return failure(
        "no_matching_diagnostic",
        "The requested diagnostic identity is not valid for the current source. Re-run compile/check.",
      );
    }
    if (diagnostics.length > 1) return ambiguousDiagnostics(diagnostics);
    const fixes = compile.quickFixes.filter(
      (candidate) => candidate.diagnosticId === selector.diagnostic_id,
    );
    if (fixes.length > 1 && selector.fix_index === undefined) return ambiguousQuickFix(fixes);
    fix = fixes[selector.fix_index ?? 0];
  } else {
    if (!selector.diagnostic_code || selector.line === undefined) {
      return failure(
        "missing_quick_fix_selector",
        "Pass source_version, diagnostic_id, and action_id from compile/check, or legacy diagnostic_code and line coordinates.",
      );
    }
    const lineZero = selector.line - 1;
    const diagnostics = compile.diagnostics.filter(
      (diagnostic) =>
        diagnostic.code === selector.diagnostic_code && diagnostic.range.start.line === lineZero,
    );
    if (diagnostics.length === 0) {
      return failure(
        "no_matching_diagnostic",
        `No '${selector.diagnostic_code}' diagnostic at line ${selector.line}. Re-run agentscript_authoring compile/check to get current diagnostics.`,
      );
    }
    if (diagnostics.length > 1) return ambiguousDiagnostics(diagnostics);
    const diagnostic = diagnostics[0];
    const fixes = compile.quickFixes.filter(
      (candidate) =>
        candidate.diagnosticId === diagnostic.diagnosticId ||
        (!candidate.diagnosticId &&
          candidate.diagnosticCode === selector.diagnostic_code &&
          candidate.diagnosticLine === lineZero),
    );
    if (fixes.length > 1 && selector.fix_index === undefined) return ambiguousQuickFix(fixes);
    fix = fixes[selector.fix_index ?? 0];
  }

  if (!fix) {
    if (compile.codeActionProvider?.status === "unavailable") {
      return failure(
        "code_action_provider_unavailable",
        compile.codeActionProvider.reason ?? "The official code-action provider did not complete.",
      );
    }
    return failure(
      "no_fix_available",
      "The selected diagnostic has no machine-applicable fix. Re-run compile/check.",
    );
  }

  return { ok: true, fix };
}

function failure(reason: string, reason_detail?: string): QuickFixSelectionResult {
  return { ok: false, reason, reason_detail };
}

function ambiguousDiagnostics(diagnostics: AgentScriptDiagnostic[]): QuickFixSelectionResult {
  return {
    ok: false,
    reason: "ambiguous_diagnostic",
    reason_detail:
      "Multiple diagnostics match the legacy selector. Re-run compile/check and use diagnostic_id/action_id.",
    candidates: diagnostics.map((diagnostic) => ({
      line: diagnostic.range.start.line + 1,
      diagnostic_id: diagnostic.diagnosticId,
      code: diagnostic.code,
      message: diagnostic.message.slice(0, 160),
    })),
  };
}

function ambiguousQuickFix(fixes: AgentScriptQuickFix[]): QuickFixSelectionResult {
  return {
    ok: false,
    reason: "ambiguous_quick_fix",
    reason_detail: "Multiple quick fixes match. Re-run compile/check and pass action_id.",
    candidates: fixes.map((candidate) => ({
      line: candidate.diagnosticLine + 1,
      diagnostic_id: candidate.diagnosticId,
      action_id: candidate.actionId,
      code: candidate.diagnosticCode,
      title: candidate.title,
    })),
  };
}
