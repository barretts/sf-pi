/* SPDX-License-Identifier: Apache-2.0 */
/** Native Agent Script quality analysis over the official Agentforce AST. */
import { parse, agentforceSchemaContext } from "@sf-agentscript/agentforce";
import { LintEngine, type AstRoot, type SchemaContext } from "@sf-agentscript/language";
import {
  AGENT_SCRIPT_QUALITY_RULES,
  isAgentScriptQualityRuleId,
  qualityRuleById,
  type AgentScriptQualityRuleId,
} from "./catalog.ts";
import { readEffectiveAgentScriptQualitySettings } from "./settings.ts";
import {
  QUALITY_SOURCE,
  QualityFactsPass,
  calculateCyclomaticComplexity,
  createQualityRulePass,
  qualityFactsKey,
} from "./rules.ts";
import type { AgentScriptDiagnostic } from "../types.ts";
import type {
  AgentScriptQualityFinding,
  AgentScriptQualityResult,
  QualityAstNode,
} from "./types.ts";

export interface RunAgentScriptQualityOptions {
  ruleOverrides?: Partial<Record<AgentScriptQualityRuleId, boolean>>;
  editTimeOnly?: boolean;
  document?: { source: string; ast: unknown; hasErrors: boolean };
  upstreamDiagnostics?: readonly AgentScriptDiagnostic[];
  analysisFailure?: string;
}

export async function runAgentScriptQuality(
  source: string,
  options: RunAgentScriptQualityOptions = {},
): Promise<AgentScriptQualityResult> {
  const global = readEffectiveAgentScriptQualitySettings();
  const effective = { ...global.rules, ...(options.ruleOverrides ?? {}) };
  const enabledDefinitions = AGENT_SCRIPT_QUALITY_RULES.filter(
    (definition) =>
      effective[definition.id] && (!options.editTimeOnly || definition.runsAtEditTime),
  );
  const disabled = AGENT_SCRIPT_QUALITY_RULES.filter((definition) => !effective[definition.id]).map(
    (definition) => ({
      id: definition.id,
      name: definition.name,
      source:
        options.ruleOverrides?.[definition.id] !== undefined
          ? ("override" as const)
          : ("global" as const),
    }),
  );
  const failed = (reason: string): AgentScriptQualityResult => ({
    ok: false,
    status: "failed",
    findings: [],
    summary: { high: 0, moderate: 0, low: 0, info: 0 },
    metrics: { cyclomatic_complexity: [] },
    coverage: {
      total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
      enabled_rules: enabledDefinitions.length,
      disabled_rules: disabled,
    },
    suppressions: { applied: [], invalid: [], unused: [] },
    failure_reason: reason,
  });
  if (options.analysisFailure) return failed(options.analysisFailure);

  try {
    const reusedDocument = options.document?.source === source;
    const document = reusedDocument && options.document ? options.document : parse(source);
    const upstreamDiagnostics =
      options.upstreamDiagnostics ?? (reusedDocument ? undefined : diagnosticsFrom(document));
    if (
      upstreamDiagnostics === undefined &&
      enabledDefinitions.some((definition) => definition.upstreamDiagnosticCode)
    ) {
      return failed("Official Agent Script diagnostics were unavailable for quality analysis.");
    }
    const passes = [
      new QualityFactsPass(),
      ...enabledDefinitions
        .filter(
          (definition) => definition.severity !== "metric" && !definition.upstreamDiagnosticCode,
        )
        .map((definition) => createQualityRulePass(definition.id)),
    ];
    const engine = new LintEngine({ passes, source: QUALITY_SOURCE });
    const run = engine.run(
      document.ast as unknown as AstRoot,
      agentforceSchemaContext as unknown as SchemaContext,
    );
    const facts = run.store.get(qualityFactsKey);
    if (!facts) throw new Error("Agent Script quality facts were not produced.");

    const findings = [
      ...run.diagnostics
        .filter((diagnostic) => diagnostic.source === QUALITY_SOURCE)
        .map(toFinding)
        .filter((finding): finding is AgentScriptQualityFinding => finding !== undefined),
      ...projectUpstreamFindings(upstreamDiagnostics ?? [], enabledDefinitions),
    ].sort(compareFindings);
    const suppressed = applySuppressions(source, findings);
    const metrics = effective["cyclomatic-complexity"] ? calculateCyclomaticComplexity(facts) : [];
    const summary = {
      high: suppressed.findings.filter((finding) => finding.severity === "high").length,
      moderate: suppressed.findings.filter((finding) => finding.severity === "moderate").length,
      low: suppressed.findings.filter((finding) => finding.severity === "low").length,
      info:
        suppressed.findings.filter((finding) => finding.severity === "info").length +
        suppressed.invalid.length +
        suppressed.unused.length,
    };
    return {
      ok: true,
      status:
        document.hasErrors || facts.components.length === 0
          ? "partial"
          : suppressed.findings.length > 0 || summary.info > 0
            ? "findings"
            : "clean",
      findings: suppressed.findings,
      summary,
      metrics: { cyclomatic_complexity: metrics },
      coverage: {
        total_rules: AGENT_SCRIPT_QUALITY_RULES.length,
        enabled_rules: enabledDefinitions.length,
        disabled_rules: disabled,
      },
      suppressions: {
        applied: suppressed.applied,
        invalid: suppressed.invalid,
        unused: suppressed.unused,
      },
    };
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error));
  }
}

function diagnosticsFrom(document: unknown): readonly AgentScriptDiagnostic[] | undefined {
  if (!document || typeof document !== "object" || !("diagnostics" in document)) return undefined;
  const diagnostics = (document as { diagnostics?: unknown }).diagnostics;
  return Array.isArray(diagnostics) ? (diagnostics as AgentScriptDiagnostic[]) : undefined;
}

function projectUpstreamFindings(
  diagnostics: readonly AgentScriptDiagnostic[],
  enabledDefinitions: readonly (typeof AGENT_SCRIPT_QUALITY_RULES)[number][],
): AgentScriptQualityFinding[] {
  const ruleByDiagnosticCode = new Map(
    enabledDefinitions
      .filter((definition) => definition.upstreamDiagnosticCode)
      .map((definition) => [definition.upstreamDiagnosticCode, definition] as const),
  );
  return diagnostics.flatMap((diagnostic) => {
    const definition = ruleByDiagnosticCode.get(String(diagnostic.code ?? ""));
    if (!definition) return [];
    const finding = toFinding({
      ...diagnostic,
      code: definition.id,
      data: {
        ...(diagnostic.data ?? {}),
        qualitySeverity: definition.severity,
        ruleName: definition.name,
      },
    });
    return finding ? [finding] : [];
  });
}

function toFinding(diagnostic: {
  code?: string | number;
  message: string;
  range: { start: { line: number; character: number }; end: { line: number; character: number } };
  data?: unknown;
}): AgentScriptQualityFinding | undefined {
  const ruleId = String(diagnostic.code ?? "");
  if (!isAgentScriptQualityRuleId(ruleId)) return undefined;
  const definition = qualityRuleById(ruleId);
  if (!definition || definition.severity === "metric") return undefined;
  const data =
    diagnostic.data && typeof diagnostic.data === "object"
      ? (diagnostic.data as Record<string, unknown>)
      : {};
  return {
    rule_id: ruleId,
    rule_name: definition.name,
    severity: definition.severity,
    message: diagnostic.message,
    range: diagnostic.range,
    line: diagnostic.range.start.line + 1,
    ...(typeof data.suggestion === "string" ? { suggestion: data.suggestion } : {}),
    ...(Array.isArray(data.evidence)
      ? { evidence: data.evidence.filter((value): value is string => typeof value === "string") }
      : {}),
  };
}

function compareFindings(a: AgentScriptQualityFinding, b: AgentScriptQualityFinding): number {
  const order = { high: 0, moderate: 1, low: 2, info: 3 } as const;
  return (
    order[a.severity] - order[b.severity] || a.line - b.line || a.rule_id.localeCompare(b.rule_id)
  );
}

interface ParsedSuppression {
  line: number;
  targetLine: number;
  ruleId?: AgentScriptQualityRuleId;
  reason?: string;
  error?: string;
}

function applySuppressions(source: string, findings: AgentScriptQualityFinding[]) {
  const suppressions = parseSuppressions(source);
  const remaining = [...findings];
  const applied: Array<{ rule_id: AgentScriptQualityRuleId; line: number; reason: string }> = [];
  const invalid: Array<{ line: number; message: string }> = [];
  const unused: Array<{ rule_id: AgentScriptQualityRuleId; line: number; reason: string }> = [];

  for (const suppression of suppressions) {
    if (suppression.error || !suppression.ruleId || !suppression.reason) {
      invalid.push({
        line: suppression.line,
        message: suppression.error ?? "Invalid suppression.",
      });
      continue;
    }
    const definition = qualityRuleById(suppression.ruleId);
    if (!definition?.suppressible) {
      invalid.push({
        line: suppression.line,
        message: `Rule '${suppression.ruleId}' cannot be suppressed inline.`,
      });
      continue;
    }
    const index = remaining.findIndex(
      (finding) =>
        finding.rule_id === suppression.ruleId && finding.line === suppression.targetLine,
    );
    if (index === -1) {
      unused.push({
        rule_id: suppression.ruleId,
        line: suppression.line,
        reason: suppression.reason,
      });
      continue;
    }
    remaining.splice(index, 1);
    applied.push({
      rule_id: suppression.ruleId,
      line: suppression.line,
      reason: suppression.reason,
    });
  }
  return { findings: remaining, applied, invalid, unused };
}

function parseSuppressions(source: string): ParsedSuppression[] {
  const lines = source.split("\n");
  const result: ParsedSuppression[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (!/sf-agentscript-ignore-next-line/.test(line)) continue;
    const match = /^\s*#\s*sf-agentscript-ignore-next-line\s+([a-z0-9-]+)\s*:\s*(.+?)\s*$/.exec(
      line,
    );
    let next = index + 1;
    while (next < lines.length && /^\s*(?:#.*)?$/.test(lines[next] ?? "")) next++;
    if (!match) {
      result.push({
        line: index + 1,
        targetLine: next + 1,
        error: "Suppression must be '# sf-agentscript-ignore-next-line <rule-id>: <reason>'.",
      });
      continue;
    }
    const id = match[1] ?? "";
    const reason = match[2]?.trim() ?? "";
    result.push({
      line: index + 1,
      targetLine: next + 1,
      ...(isAgentScriptQualityRuleId(id) ? { ruleId: id } : {}),
      ...(reason ? { reason } : {}),
      ...(!isAgentScriptQualityRuleId(id) ? { error: `Unknown quality rule '${id}'.` } : {}),
    });
  }
  return result;
}

/** Test seam for declaration ranges whose AST body starts after the mapping key. */
export function qualityNodeRange(node: QualityAstNode) {
  return node.__cst?.range;
}
