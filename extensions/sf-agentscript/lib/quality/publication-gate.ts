/* SPDX-License-Identifier: Apache-2.0 */
/** Session-scoped approval envelope for native Agent Script quality publication risks. */
import type { AgentScriptQualityResult } from "./types.ts";

export const QUALITY_ANALYSIS_FAILED_RISK = "quality-analysis-failed" as const;
export type QualityPublicationRiskId = string;
export type QualityOverrideLedger = Map<string, Set<QualityPublicationRiskId>>;

const sessionLedger = createQualityOverrideLedger();

export function createQualityOverrideLedger(): QualityOverrideLedger {
  return new Map();
}

export function resetSessionQualityOverrides(): void {
  sessionLedger.clear();
}

export function sessionQualityOverrideLedger(): QualityOverrideLedger {
  return sessionLedger;
}

export function qualityPublicationRiskIds(
  quality: AgentScriptQualityResult,
): QualityPublicationRiskId[] {
  if (!quality.ok || quality.status === "failed") return [QUALITY_ANALYSIS_FAILED_RISK];
  return Array.from(
    new Set(
      quality.findings
        .filter((finding) => finding.severity === "high")
        .map((finding) => finding.rule_id),
    ),
  ).sort();
}

export function evaluateQualityPublicationGate(
  bundle: string,
  quality: AgentScriptQualityResult,
  ledger: QualityOverrideLedger = sessionLedger,
  approveNewRisks = false,
): {
  proceed: boolean;
  riskIds: QualityPublicationRiskId[];
  newRiskIds: QualityPublicationRiskId[];
} {
  const riskIds = qualityPublicationRiskIds(quality);
  if (riskIds.length === 0) return { proceed: true, riskIds, newRiskIds: [] };

  const approved = ledger.get(bundle) ?? new Set<QualityPublicationRiskId>();
  const newRiskIds = riskIds.filter((riskId) => !approved.has(riskId));
  if (approveNewRisks && newRiskIds.length > 0) {
    for (const riskId of newRiskIds) approved.add(riskId);
    ledger.set(bundle, approved);
    return { proceed: true, riskIds, newRiskIds };
  }
  return { proceed: newRiskIds.length === 0, riskIds, newRiskIds };
}
