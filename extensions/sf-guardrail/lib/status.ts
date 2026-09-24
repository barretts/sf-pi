/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Human-readable status summary for `/sf-guardrail` (default subcommand).
 *
 * Kept as a pure formatter so tests can snapshot it. index.ts passes the
 * current config and the recent audit entries; this module returns the
 * string shown via ctx.ui.notify.
 */
import { enabledNativeFamilies, powerToolModeLabel } from "./power-tool-mode.ts";
import { labelForRuleBehavior, resolveRuleBehavior } from "./rule-behavior.ts";
import type { GuardrailConfigSource } from "./config.ts";
import type { GuardrailPowerToolSettings } from "./power-tool-mode.ts";
import type { Data360ExecutionChainEntryData } from "./approval-ledger.ts";
import type { DecisionEntryData, GuardrailConfig, GuardrailEngine } from "./types.ts";

export interface StatusInput {
  config: GuardrailConfig;
  configSource: GuardrailConfigSource;
  recent: DecisionEntryData[];
  data360ExecutionChains?: Data360ExecutionChainEntryData[];
  hasUI: boolean;
  headlessEnabled: boolean;
  operatorAutoApproveEnabled: boolean;
  powerTool?: GuardrailPowerToolSettings;
  engine?: GuardrailEngine;
  jevModel?: string;
  jevEndpointStatus?: string;
  jevCredentialReady?: boolean;
}

export function renderStatus(input: StatusInput): string {
  const {
    config,
    configSource,
    recent,
    data360ExecutionChains = [],
    hasUI,
    headlessEnabled,
    operatorAutoApproveEnabled,
    powerTool,
    engine = "deterministic",
    jevModel,
    jevEndpointStatus,
    jevCredentialReady,
  } = input;
  const lines: string[] = [];
  lines.push(`sf-guardrail: extension-enabled (source: ${configSource})`);
  lines.push(`  decision engine: ${engine}`);
  if (engine === "jev") {
    if (jevModel) lines.push(`  Jev model: ${jevModel}`);
    const connectionStatus =
      jevEndpointStatus === undefined
        ? "not checked"
        : ["ready", "missing", "invalid"].includes(jevEndpointStatus)
          ? jevEndpointStatus
          : "invalid";
    lines.push(`  Decisions provider connection: ${connectionStatus}`);
    lines.push(
      `  Jev API key: ${jevCredentialReady === true ? "ready" : jevCredentialReady === false ? "unavailable" : "not checked"}`,
    );
    const failures = recent.filter((entry) => entry.jev?.failure).slice(0, 3);
    if (failures.length) {
      lines.push(
        `  recent Jev failures: ${failures.map((entry) => entry.jev?.failure).join(", ")}`,
      );
    }
  }

  lines.push(
    `  policies: ${count(config.policies.rules, (r) => resolveRuleBehavior(r) !== "off")} active / ${config.policies.rules.length} defined`,
  );
  lines.push(
    `  command gate: ${count(config.commandGate.patterns, (p) => resolveRuleBehavior(p) !== "off")} active / ${config.commandGate.patterns.length} patterns; ${config.commandGate.allowedPatterns.length} allowed; ${config.commandGate.autoDenyPatterns.length} auto-deny`,
  );
  lines.push(
    `  org-aware gate: ${count(config.orgAwareGate.rules, (r) => resolveRuleBehavior(r) !== "off")} active / ${config.orgAwareGate.rules.length} defined`,
  );

  if (config.productionAliases.length > 0) {
    lines.push(`  productionAliases: ${config.productionAliases.join(", ")}`);
  }

  if (!hasUI) {
    lines.push(
      `  headless mode: ${engine === "deterministic" && headlessEnabled ? "opt-in pass" : "fail-closed"}`,
    );
  }
  lines.push(
    `  power tool mode: ${engine === "jev" ? "disabled for Jev" : powerToolStatus(powerTool)}`,
  );
  if (engine === "jev") {
    lines.push("  operator auto-approve env: disabled for Jev");
  } else if (operatorAutoApproveEnabled) {
    lines.push("  operator auto-approve env: enabled for confirm-class decisions");
  }

  lines.push("");
  if (recent.length === 0) {
    lines.push("  no guardrail decisions this session");
  } else {
    lines.push(`  recent decisions (${recent.length}):`);
    for (const entry of recent.slice(0, 5)) {
      lines.push(`    ${formatEntry(entry)}`);
    }
  }
  appendData360ExecutionChains(lines, data360ExecutionChains, 3, "  ");
  return lines.join("\n");
}

function count<T>(xs: T[], pred: (x: T) => boolean): number {
  return xs.filter(pred).length;
}

function powerToolStatus(powerTool: GuardrailPowerToolSettings | undefined): string {
  const mode = powerTool?.mode ?? "off";
  if (mode === "off") return "Off";
  const prod = powerTool?.productionUnknown ? "prod/unknown auto-approve on" : "prod/unknown off";
  if (mode === "all") return `${powerToolModeLabel(mode)} (${prod})`;
  const families = [...enabledNativeFamilies(powerTool)].join(", ");
  return `${powerToolModeLabel(mode)} (${families}; ${prod})`;
}

function formatEntry(e: DecisionEntryData): string {
  const when = new Date(e.timestamp).toISOString().slice(11, 19);
  const shortSubject = e.subject.length > 60 ? e.subject.slice(0, 57) + "…" : e.subject;
  const orgSuffix = e.orgAlias
    ? ` org=${e.orgAlias}(${e.orgType ?? "?"}${e.orgResolutionGuessed ? ",guessed" : ""}${e.orgResolutionSource ? `,${e.orgResolutionSource}` : ""})`
    : "";
  const scopeSuffix = e.approvalScopeLabel ? ` scope=${e.approvalScopeLabel}` : "";
  const jevSuffix = e.jev ? formatJevEvidence(e.jev) : "";
  return `${when}  ${e.outcome}  ${e.ruleId}${orgSuffix}${scopeSuffix}  ${e.toolName}  ${shortSubject}${jevSuffix}`;
}

function formatJevEvidence(evidence: NonNullable<DecisionEntryData["jev"]>): string {
  const fields = [`model=${evidence.model}`, `${Math.round(evidence.latencyMs)}ms`];
  if (evidence.operatingPoint) fields.push(`point=${evidence.operatingPoint.name}`);
  if (evidence.riskAnswer) fields.push(`risk=${evidence.riskAnswer.choice}`);
  if (evidence.requestId) fields.push(`request=${evidence.requestId}`);
  if (evidence.probabilities) {
    fields.push(`risk P(allow)=${evidence.probabilities.allow.toFixed(4)}`);
  }
  if (evidence.confidence !== undefined)
    fields.push(`risk confidence=${evidence.confidence.toFixed(4)}`);
  const heads =
    evidence.process?.kind === "command_stages"
      ? evidence.process.result.answers
      : evidence.process?.kind === "all_heads"
        ? (evidence.process.stage?.answers ?? evidence.answers)
        : evidence.answers;
  for (const [id, answer] of Object.entries(heads ?? {})) {
    if (!answer) continue;
    fields.push(
      `${id}=${answer.choice} (P(allow)=${answer.probabilities.allow.toFixed(4)}; confidence=${answer.confidence.toFixed(4)}${evidence.process?.kind === "command_stages" ? `; request=${evidence.process.result.origins[id]?.requestId ?? "unobserved"}` : ""})`,
    );
  }
  if (evidence.process?.kind === "command_stages")
    fields.push(
      `actual stages=${evidence.process.result.stages.length}`,
      `syntax answers=${evidence.process.result.syntaxTranscript.length}`,
    );
  if (evidence.cost !== undefined) fields.push(`cost=$${evidence.cost.toFixed(8)}`);
  if (evidence.failure) fields.push(`failure=${evidence.failure}`);
  return `  Jev(${fields.join("; ")})`;
}

export function renderRules(config: GuardrailConfig): string {
  const lines: string[] = [];
  lines.push("Policies:");
  for (const rule of config.policies.rules) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(rule))}]`;
    lines.push(`  ${status} ${rule.id} (${rule.protection})  ${rule.description ?? ""}`.trimEnd());
    for (const p of rule.patterns) {
      lines.push(`      ${p.regex ? "regex" : "glob"}: ${p.pattern}`);
    }
  }
  lines.push("");
  lines.push("Command gate:");
  for (const p of config.commandGate.patterns) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(p))}]`;
    lines.push(`  ${status} ${p.id}  ${p.pattern}  ${p.description ?? ""}`.trimEnd());
  }
  lines.push("");
  lines.push("Org-aware gate:");
  for (const rule of config.orgAwareGate.rules) {
    const status = `[${labelForRuleBehavior(resolveRuleBehavior(rule))}]`;
    const types = rule.whenOrgType.join(",");
    lines.push(
      `  ${status} ${rule.id} (${rule.action}, orgType=${types})  ${rule.description ?? ""}`.trimEnd(),
    );
  }
  return lines.join("\n");
}

export function renderAudit(
  recent: DecisionEntryData[],
  data360ExecutionChains: Data360ExecutionChainEntryData[] = [],
): string {
  const lines: string[] = [];
  if (recent.length === 0) {
    lines.push("No guardrail decisions recorded this session.");
  } else {
    lines.push(`Guardrail decisions (${recent.length}):`);
    for (const entry of recent) lines.push(`  ${formatEntry(entry)}`);
  }
  appendData360ExecutionChains(lines, data360ExecutionChains, data360ExecutionChains.length, "");
  return lines.join("\n");
}

function appendData360ExecutionChains(
  lines: string[],
  chains: Data360ExecutionChainEntryData[],
  limit: number,
  indent: string,
): void {
  if (!chains.length) return;
  lines.push("");
  lines.push(`${indent}related Data 360 execution chains (${chains.length}):`);
  for (const entry of chains.slice(0, limit)) {
    lines.push(`${indent}  ${formatData360ExecutionChain(entry)}`);
  }
  if (chains.length > limit) {
    lines.push(`${indent}  +${chains.length - limit} more execution chain(s)`);
  }
}

function formatData360ExecutionChain(entry: Data360ExecutionChainEntryData): string {
  const when = new Date(entry.timestamp).toISOString().slice(11, 19);
  const parent = [entry.parentTool, entry.parentAction].filter(Boolean).join(" ") || "Data 360";
  const target = entry.targetOrg ? ` org=${entry.targetOrg}` : "";
  const status = entry.ok === false ? "failed" : "ok";
  const childActions = entry.executionChain
    .slice(0, 5)
    .map((step) => [stringValue(step.tool), stringValue(step.action)].filter(Boolean).join(" "))
    .filter(Boolean);
  const childText = childActions.length ? childActions.join(" → ") : "no child actions recorded";
  const more =
    entry.executionChain.length > childActions.length
      ? ` (+${entry.executionChain.length - childActions.length} more)`
      : "";
  const fingerprint =
    typeof entry.journey_fingerprint === "string"
      ? ` fingerprint=${entry.journey_fingerprint}`
      : "";
  return `${when}  ${status}  ${parent}${target}${fingerprint}  ${childText}${more}`;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
