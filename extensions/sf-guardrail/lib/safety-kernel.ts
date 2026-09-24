/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Kernel bridge for sf-guardrail.
 *
 * Deterministic mode preserves the existing gates. Jev mode classifies every
 * call before risk-based normalization, using operation metadata and trusted facts.
 *
 * Keep this module pure: no Pi Runtime UI, session, notification, or
 * persistence side effects belong here.
 */
import { evaluateCommandRiskWithOrgLookup } from "./command-risk-gate.ts";
import { evaluateFilePolicy } from "./file-policy-gate.ts";
import { evaluateOrgAwareRiskWithOrgLookup } from "./org-aware-risk-gate.ts";
import { evaluateNativeToolRiskWithOrgLookup } from "./native-tool-risk-gate.ts";
import { normalizeSafetySubject } from "./safety-subject.ts";
import { evaluateJevSafety } from "./jev-risk.ts";
import type { JevOperatingPoint } from "./jev-operating-point.ts";
import type { PreparedSoqlArtifactPlan } from "../../../lib/common/sf-soql-artifact-plan/store.ts";
import type {
  ClassifiedDecision,
  GuardrailConfig,
  GuardrailEngine,
  JevToolDescriptor,
} from "./types.ts";

export interface SafetyKernelInput {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  config: GuardrailConfig;
  sessionId?: string;
  toolCallId?: string;
  artifactPlan?: Readonly<PreparedSoqlArtifactPlan>;
  engine?: GuardrailEngine;
  descriptor?: JevToolDescriptor;
  signal?: AbortSignal;
  deadline?: number;
  operatingPoint?: JevOperatingPoint;
  recheckContext?: () => boolean | Promise<boolean>;
}
export type GuardrailDecision = ClassifiedDecision;

export async function evaluateSafety(
  input: SafetyKernelInput,
): Promise<GuardrailDecision | undefined> {
  if (input.engine === "jev") {
    return evaluateJevSafety(input, {
      descriptor: input.descriptor,
      signal: input.signal,
      deadline: input.deadline,
      operatingPoint: input.operatingPoint,
      recheckContext: input.recheckContext,
    });
  }
  const subject = normalizeSafetySubject(input.toolName, input.input, {
    sessionId: input.sessionId,
  });
  if (!subject) return undefined;

  if (subject.kind === "file") {
    return evaluateFilePolicy(subject, input.cwd, input.config);
  }

  if (subject.kind === "nativeTool") {
    return evaluateNativeToolRiskWithOrgLookup(subject, input.cwd, input.config);
  }

  const commandRisk = await evaluateCommandRiskWithOrgLookup(subject, input.cwd, input.config);
  if (commandRisk?.kind === "allowListed") return undefined;
  if (commandRisk?.kind === "decision") return commandRisk.decision;

  return evaluateOrgAwareRiskWithOrgLookup(subject, input.cwd, input.config);
}
