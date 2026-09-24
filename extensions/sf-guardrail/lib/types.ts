/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Type boundary for sf-guardrail.
 *
 * One place for the guardrail config schema, decision shapes, and persisted
 * entry types. Keep this module pure: no imports from node, fs, or pi — it
 * is the shape contract everything else depends on.
 */

// ─── Config schema ──────────────────────────────────────────────────────────────

export type ProtectionLevel = "noAccess" | "readOnly" | "none";
export type RuleBehavior = "off" | "confirm" | "block";
export type GuardrailEngine = "deterministic" | "jev";
export type JevAction = "allow" | "confirm" | "block";
export type JevFileKind = "file" | "directory" | "other" | "unknown";
export type JevQuestionId =
  "risk" | "file_policy" | "command_policy" | "org_policy" | "disclosure" | "authority";

export interface JevChoiceAnswer {
  choice: JevAction;
  probabilities: Record<JevAction, number>;
  confidence: number;
}

export interface JevToolDescriptor {
  description: string;
  parameters?: unknown;
}

/** Query text structure only; source access, response contents, and artifact paths are unobserved. */
export interface JevSoqlQueryShape {
  projection: "single_Id";
  sourceCount: 1;
  queryLimit: number;
  otherClauses: false;
  sourceSpelling: "withheld";
  sensitivity: "unknown";
}

export interface JevArtifactFileAccess {
  path: string;
  access: "mkdir" | "write";
}

/** Trusted local call context. It is not a tool argument or hosted fact. */
export interface JevArtifactPlanContext {
  toolName: string;
  input: Record<string, unknown>;
  cwd: string;
  sessionId?: string;
  toolCallId?: string;
}

/** Local-only plan identity and ordered effects for fresh fact binding. */
export interface JevArtifactPlanFacts {
  hash: string;
  accesses: readonly JevArtifactFileAccess[];
}

/** Values here have crossed the metadata-only privacy boundary. */
export interface JevToolMetadata {
  toolName: string;
  description?: string;
  metadata: Record<string, unknown>;
  omissions: string[];
  complete: boolean;
  /** Local-only marker from the builder. No other incomplete reason is present. */
  artifactPathsOnlyIncomplete?: true;
  /** Local-only trusted plan binding. Never send its hash or call identity. */
  artifactPlan?: Readonly<JevArtifactPlanFacts>;
}

export interface JevFacts {
  org?: { type: OrgTypeFilter; verified: boolean; explicit: boolean };
  files?: Array<{
    path: string;
    exists: boolean | "unknown";
    /** Kind from stat, which follows symlinks. Absent means unknown. */
    kind?: JevFileKind;
    resolvedPath?: string;
    absolutePath?: string;
    relativePath?: string;
    basename?: string;
    homeRelativePath?: string;
  }>;
  browser?: { status: string; role?: string; label?: string; ageMs?: number };
}

export interface JevResolvedFacts {
  facts: JevFacts;
  /** Local-only approval binding; never serialized into a hosted request. */
  orgIdentity?: string;
  browserIdentity?: string;
  /** Local-only. The hosted request receives only the observed file facts. */
  artifactPlan?: Readonly<JevArtifactPlanFacts>;
}

export interface JevEvidence {
  model: string;
  provider?: string;
  requestId?: string;
  probabilities?: Record<JevAction, number>;
  confidence?: number;
  /** Independent model answers; these are not combined into a calibrated probability. */
  answers?: Partial<Record<JevQuestionId, JevChoiceAnswer>>;
  latencyMs: number;
  cost?: number;
  failure?: string;
  policyHash: string;
  protocolHash: string;
  inputHash?: string;
  descriptorHash?: string;
  factsHash?: string;
  /** Bounded local artifact identity and access counts. No raw paths or query. */
  artifactPlanHash?: string;
  artifactAccessCounts?: { mkdir: number; write: number };
  /** Local endpoint, model, provider, and routing binding. No endpoint text is stored. */
  transportHash?: string;
}

export interface JevPrediction extends JevChoiceAnswer {
  answers?: Partial<Record<JevQuestionId, JevChoiceAnswer>>;
  model: string;
  provider: string;
  requestId: string;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
}

export interface JevChoiceQuestion {
  type: "choice";
  instructions: unknown;
  criteria: Record<JevAction, unknown>;
}

export interface JevRequest {
  model: string;
  provider?: { only: ["typesafe"]; allow_fallbacks: false };
  state: unknown;
  questions: { risk: JevChoiceQuestion } & Partial<
    Record<Exclude<JevQuestionId, "risk">, JevChoiceQuestion>
  >;
}

export type JevClientFailureCode =
  | "missing_endpoint"
  | "invalid_endpoint"
  | "missing_credentials"
  | "invalid_credentials"
  | "invalid_request"
  | "cancelled"
  | "timeout"
  | "transport_error"
  | "http_error"
  | "response_too_large"
  | "invalid_response"
  | "identity_mismatch";

/** Partial reply hashes cover only the bound prefix, not a complete reply. */
export interface JevStageFailureEvidence {
  stage: "non_command" | "syntax" | "command_policy";
  requestedQuestionIds: string[];
  requestHash?: string;
  requestBytes?: number;
  transportHash: string;
  latencyMs: number;
  requestSent: boolean;
  failure: JevClientFailureCode;
  responseComplete?: boolean;
  responseHash?: string;
  responseBytes?: number;
  responsePrefixHash?: string;
  responsePrefixBytes?: number;
}

/** These forms support a process. They do not select or release a policy action. */
export type JevNonCommandQuestionId = Exclude<JevQuestionId, "command_policy">;
export type JevSyntaxQuestionId = `r_${string}`;
export type JevSyntaxChoice = "match" | "no_match";

export interface JevSyntaxChoiceQuestion {
  type: "choice";
  instructions: unknown;
  criteria: Record<JevSyntaxChoice, unknown>;
}

export interface JevStageRequestBase {
  model: string;
  provider: { only: ["typesafe"]; allow_fallbacks: false };
  state: unknown;
}

export interface JevNonCommandRequest extends JevStageRequestBase {
  questions: { risk: JevChoiceQuestion } & Partial<
    Record<Exclude<JevNonCommandQuestionId, "risk">, JevChoiceQuestion>
  >;
}

/** Send every row in one request. The client admits 1..64 alphabetic opaque IDs in source order. */
export interface JevSyntaxRequest extends JevStageRequestBase {
  questions: Record<JevSyntaxQuestionId, JevSyntaxChoiceQuestion>;
}

export interface JevCommandPolicyRequest extends JevStageRequestBase {
  questions: { command_policy: JevChoiceQuestion };
}

export interface JevSyntaxChoiceAnswer {
  choice: JevSyntaxChoice;
  probabilities: Record<JevSyntaxChoice, number>;
  confidence: number;
}

/** Hash the actual request and raw reply. Do not store endpoint or key text. */
export interface JevStageEvidence<QuestionId extends string> {
  requestedQuestionIds: QuestionId[];
  requestHash: string;
  responseHash: string;
  transportHash: string;
  requestBytes: number;
  responseBytes: number;
  model: string;
  provider: string;
  requestId: string;
  usage: { input_tokens: number; output_tokens: number; cost?: number };
  latencyMs: number;
}

export interface JevNonCommandStageResult {
  stage: "non_command";
  answers: { risk: JevChoiceAnswer } & Partial<
    Record<Exclude<JevNonCommandQuestionId, "risk">, JevChoiceAnswer>
  >;
  evidence: JevStageEvidence<JevNonCommandQuestionId>;
}

export interface JevSyntaxStageResult {
  stage: "syntax";
  answers: Record<JevSyntaxQuestionId, JevSyntaxChoiceAnswer>;
  evidence: JevStageEvidence<JevSyntaxQuestionId>;
}

export interface JevCommandPolicyStageResult {
  stage: "command_policy";
  answers: { command_policy: JevChoiceAnswer };
  evidence: JevStageEvidence<"command_policy">;
}

export interface JevProcessTransport {
  requestNonCommand(request: JevNonCommandRequest): Promise<JevNonCommandStageResult>;
  requestSyntax(request: JevSyntaxRequest): Promise<JevSyntaxStageResult>;
  requestCommandPolicy(request: JevCommandPolicyRequest): Promise<JevCommandPolicyStageResult>;
  /** Cancel pending work and remove the process timer and caller listener. */
  close(): void;
}

export interface PolicyPattern {
  pattern: string;
  /** If true, treat pattern as a regex (anchored with JS flags). */
  regex?: boolean;
}

export interface PolicyRule {
  id: string;
  description?: string;
  patterns: PolicyPattern[];
  allowedPatterns?: PolicyPattern[];
  protection: ProtectionLevel;
  /** Only match if the file currently exists on disk. Default true. */
  onlyIfExists?: boolean;
  /** Message shown when the rule blocks. {file} is replaced with the path. */
  blockMessage?: string;
  /** Per-rule behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
}

export interface CommandPattern {
  id: string;
  pattern: string;
  description?: string;
  /** Override the default `confirm` action for this pattern. Currently unused in MVP. */
  action?: "confirm" | "block";
  /** Per-pattern behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
}

export interface CommandGateConfig {
  patterns: CommandPattern[];
  allowedPatterns: CommandPattern[];
  autoDenyPatterns: CommandPattern[];
}

/**
 * Shell-AST-based match spec for org-aware rules.
 *
 * Semantics:
 *   - `cmd` matches the head word, e.g. "sf".
 *   - `subCmd` matches the positional non-flag arguments that follow, in
 *     order. Each entry is either a literal string or an array of
 *     alternatives. Example: `["data", ["delete","update"]]` matches both
 *     `sf data delete …` and `sf data update …` but not `sf data query …`.
 *   - `flagIn` requires the named flag to be present with one of the listed
 *     values. `--method DELETE` matches, `--method=DELETE` matches,
 *     `--method GET` does not. Omit to ignore flag matching.
 */
export interface ShellAstMatch {
  cmd: string;
  subCmd?: (string | string[])[];
  flagIn?: Record<string, string[]>;
}

export interface OrgAwareMatch {
  tool: "bash";
  ast: ShellAstMatch;
}

export type OrgTypeFilter =
  "production" | "sandbox" | "scratch" | "developer" | "trial" | "unknown";

export interface OrgAwareRule {
  id: string;
  description?: string;
  match: OrgAwareMatch;
  /** Rule fires only when the resolved target-org type is one of these. */
  whenOrgType: OrgTypeFilter[];
  action: "confirm" | "block";
  confirmMessage?: string;
  /** Per-rule behavior. Default confirm. */
  behavior?: RuleBehavior;
  /** Compatibility flag. `false` is treated as behavior='off'. */
  enabled?: boolean;
}

export interface OrgAwareGateConfig {
  rules: OrgAwareRule[];
}

export interface PoliciesConfig {
  rules: PolicyRule[];
}

export interface GuardrailConfig {
  version: 1;
  /** Aliases the user has tagged as production. Merged with type detection. */
  productionAliases: string[];
  /** Env var name that opens a headless escape hatch when set to a truthy value. */
  headlessEscapeHatchEnv: string;
  /** ms. `ctx.ui.select` returns undefined past this; guardrail treats as block. */
  confirmTimeoutMs: number;
  policies: PoliciesConfig;
  commandGate: CommandGateConfig;
  orgAwareGate: OrgAwareGateConfig;
}

// ─── Safety subject model ───────────────────────────────────────────────────────

export type SafetySubject = FileSafetySubject | ShellCommandSafetySubject | NativeToolSafetySubject;

export interface FileSafetySubject {
  kind: "file";
  toolName: string;
  path: string;
}

export interface ShellCommandSafetySubject {
  kind: "shellCommand";
  toolName: "bash" | "herdr_pane";
  command: string;
}

export interface NativeToolSafetySubject {
  kind: "nativeTool";
  toolName: string;
  action?: string;
  ruleId: string;
  /** Compact display subject for prompts/audit; never a full raw payload. */
  subject: string;
  reason: string;
  promptTitle?: string;
  operationFamily: string;
  riskTier: string;
  /** Stable, already-sanitized fingerprint for the operation payload/target details. */
  fingerprint: string;
  approvalLabel: string;
  approvalDetail?: string;
  /** True when the native operation targets a Salesforce org. */
  usesSalesforceOrg?: boolean;
  /** Alias / username / org id from target_org, when the tool supplied one. */
  targetOrg?: string;
  /** True when targetOrg came explicitly from tool input instead of the active default. */
  targetOrgExplicit?: boolean;
  /** False for native operations that should not create session approvals. */
  allowSession?: boolean;
}

// ─── Decision model ─────────────────────────────────────────────────────────────

export type DecisionOutcome =
  | "allow_once"
  | "allow_session"
  | "allow_persisted"
  | "allow_auto"
  | "operator_auto_approve"
  | "block"
  | "timeout"
  | "cancel"
  | "hard_block"
  | "headless_pass"
  | "headless_block";

/**
 * A classified tool_call — the product of evaluating every feature against one
 * incoming event. A single event can match at most one policy (strongest-wins)
 * but multiple command-gate or org-aware rules may fire; index.ts iterates them
 * in order and stops at the first block/deny.
 */
export interface ApprovalScope {
  fingerprint: string;
  label: string;
  detail?: string;
  riskTier?: string;
  operationFamily?: string;
  /** When false, the HIL dialog offers only allow-once or block. */
  allowSession?: boolean;
  /** Legacy compatibility only. New approvals are session-scoped. */
  persistedGrant?: {
    label: string;
    ttlMs: number;
  };
}

/** Compatibility alias for the envelope-first redesign vocabulary. */
export type SafetyEnvelope = ApprovalScope;

export interface ClassifiedDecision {
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate" | "nativeToolGate" | "jevGate";
  action: "allow" | "block" | "confirm";
  /** Human-readable reason surfaced back to the LLM on block. */
  reason: string;
  /** Displayed to the user in the confirmation dialog. */
  promptTitle?: string;
  /** Stable fingerprint for session allow-memory dedup. */
  fingerprint: string;
  /** File path, shell command, or compact native tool operation subject. */
  subject: string;
  /** Human-readable Safety Envelope metadata. Kept as approvalScope for compatibility. */
  approvalScope?: SafetyEnvelope;
  /** Target-org context if resolved. */
  orgAlias?: string;
  orgType?: OrgTypeFilter;
  orgId?: string;
  orgUsername?: string;
  orgResolutionGuessed?: boolean;
  orgResolutionSource?: "cache" | "lookup" | "productionAliases" | "guessed";
  orgTargetExplicit?: boolean;
  orgCommand?: string;
  jev?: JevEvidence;
}

// ─── Persisted entries (pi.appendEntry customType values) ───────────────────────

/** Decision audit log. Rendered by `/sf-guardrail audit`. */
export const DECISION_ENTRY_TYPE = "sf-guardrail-decision";

/** Session allow-memory. Rendered/cleared by `/sf-guardrail forget`. */
export const ALLOW_ENTRY_TYPE = "sf-guardrail-allow";

/** Session allow-memory revocation marker. */
export const ALLOW_REVOKE_ENTRY_TYPE = "sf-guardrail-allow-revoke";

/** Injection guard. Emitted once per session like sf-brain's kernel. */
export const INJECTION_ENTRY_TYPE = "sf-guardrail-prompt";

export interface DecisionEntryData {
  timestamp: number;
  ruleId: string;
  feature: "policies" | "commandGate" | "orgAwareGate" | "nativeToolGate" | "jevGate";
  outcome: DecisionOutcome;
  toolName: string;
  subject: string;
  fingerprint: string;
  orgAlias?: string;
  orgType?: OrgTypeFilter;
  orgId?: string;
  orgUsername?: string;
  orgResolutionGuessed?: boolean;
  orgResolutionSource?: "cache" | "lookup" | "productionAliases" | "guessed";
  approvalScopeLabel?: string;
  approvalScopeDetail?: string;
  approvalRiskTier?: string;
  reason: string;
  jev?: JevEvidence;
}

export interface AllowEntryData {
  ruleId: string;
  fingerprint: string;
  grantedAt: number;
}

export interface AllowRevokeEntryData {
  revokedAt: number;
}

// ─── Command / slot constants ───────────────────────────────────────────────────

export const COMMAND_NAME = "sf-guardrail";
export const STATUS_KEY = "sf-guardrail";
