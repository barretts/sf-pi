/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Guardrail config loader — bundled defaults merged with a user override.
 *
 * Merge strategy (last wins):
 *   1. Bundled: `extensions/sf-guardrail/SF_GUARDRAIL_DEFAULTS.json`
 *   2. Advanced override: `<globalAgentDir>/sf-guardrail/rules.json`
 *   3. Routine Pi preferences: `settings.json -> sfPi.guardrail`
 *
 * Rule-set merging is by `id` (not by array index). A user-defined rule with
 * id "sf-deploy-prod" replaces the bundled one wholesale. Routine bundled-rule
 * behavior is overlaid from Pi settings so the manager surface reflects runtime.
 *
 * Project-level overrides / project-local Guardrail weakening remain deferred
 * by ADR 0041 and ADR 0049.
 */
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  openSync,
  readFileSync,
  readSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { globalAgentPath } from "../../../lib/common/pi-paths.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";
import type {
  CommandGateConfig,
  CommandPattern,
  GuardrailConfig,
  GuardrailEngine,
  OrgAwareGateConfig,
  OrgAwareRule,
  PoliciesConfig,
  PolicyRule,
} from "./types.ts";
import { behaviorEnabled, resolveRuleBehavior } from "./rule-behavior.ts";
import {
  applyGuardrailPiSettings,
  hasGuardrailPiSettings,
  guardrailSettingsValue,
  normalizeGuardrailPiSettings,
  readGuardrailPiSettings,
  rejectGuardrailJsonDuplicateKeys,
  validateGuardrailPiSettings,
  type GuardrailPiSettings,
} from "./guardrail-settings.ts";

export type GuardrailConfigSource = "bundled" | "override" | "settings" | "override+settings";

/** Error messages and categories never contain settings values, paths, or parse text. */
export class GuardrailConfigError extends Error {
  readonly category: string;

  constructor(category: string) {
    super(`Guardrail configuration blocked: ${category}.`);
    this.category = category;
    this.name = "GuardrailConfigError";
  }
}

const CONFIG_FILE_LIMIT_BYTES = 256 * 1024;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BUNDLED_PATH = path.resolve(__dirname, "..", "SF_GUARDRAIL_DEFAULTS.json");

/** Path to the user override file. Exposed for tests and panels. */
export function userConfigPath(): string {
  return globalAgentPath("sf-guardrail", "rules.json");
}

/**
 * Load the bundled defaults verbatim. Exposed so tests and tooling can read
 * the shipping rule set without re-implementing parsing.
 */
export function readBundledConfig(): GuardrailConfig {
  const text = readFileSync(BUNDLED_PATH, "utf8");
  return sanitize(JSON.parse(text));
}

/**
 * Attempt to read the user override. Returns `undefined` if the file is
 * missing, unreadable, or does not parse. Silent fallback mirrors sf-brain.
 */
export function readUserOverride(): Partial<GuardrailConfig> | undefined {
  const p = userConfigPath();
  if (!existsSync(p)) return undefined;
  try {
    const text = readFileSync(p, "utf8");
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return undefined;
    return parsed as Partial<GuardrailConfig>;
  } catch {
    return undefined;
  }
}

/**
 * Load the effective config. Bundled defaults + user override if present.
 * Result is sanitized: every field that ships in bundled defaults is present,
 * and unknown fields are dropped.
 */
export function loadConfig(): { config: GuardrailConfig; source: GuardrailConfigSource } {
  const bundled = readBundledConfig();
  const override = readUserOverride();
  const settings = readGuardrailPiSettings();

  return effectiveConfig(bundled, override, settings);
}

/**
 * Read each policy source once. Settings errors cannot silently switch engines;
 * Jev additionally rejects supplied policy fields that legacy sanitizers drop.
 */
export function loadGuardrailSnapshot(): {
  config: GuardrailConfig;
  source: GuardrailConfigSource;
  engine: GuardrailEngine;
} {
  const root = readBoundedJsonObject(globalSettingsPath(), "settings", true) ?? {};
  if (root.sfPi !== undefined && !isObject(root.sfPi)) invalid("settings");
  const rawSettings = guardrailSettingsValue(root);
  if (rawSettings !== undefined && !isObject(rawSettings)) invalid("settings");
  const raw = (rawSettings ?? {}) as Record<string, unknown>;
  if (raw.engine !== undefined && raw.engine !== "deterministic" && raw.engine !== "jev") {
    invalid("settings");
  }
  const engine: GuardrailEngine = raw.engine === "jev" ? "jev" : "deterministic";
  if (engine === "jev") {
    try {
      validateGuardrailPiSettings(raw);
    } catch {
      invalid("settings");
    }
  }
  const settings = normalizeGuardrailPiSettings(raw);

  const bundled = readBoundedJsonObject(BUNDLED_PATH, "bundled", false);
  validateConfig(bundled, "bundled");
  let override: Partial<GuardrailConfig> | undefined;
  try {
    const parsed = readBoundedJsonObject(userConfigPath(), "override", true);
    if (parsed !== undefined) {
      if (engine === "jev") validateConfig(parsed, "override");
      override = parsed as Partial<GuardrailConfig>;
    }
  } catch (error) {
    if (engine === "jev") throw error;
  }
  return { ...effectiveConfig(sanitize(bundled), override, settings), engine };
}

function effectiveConfig(
  bundled: GuardrailConfig,
  override: Partial<GuardrailConfig> | undefined,
  settings: GuardrailPiSettings,
): { config: GuardrailConfig; source: GuardrailConfigSource } {
  let config = override ? merge(bundled, override) : bundled;
  let source: GuardrailConfigSource = override ? "override" : "bundled";

  if (hasGuardrailPiSettings(settings)) {
    config = applyGuardrailPiSettings(config, settings);
    source = override ? "override+settings" : "settings";
  }

  return { config, source };
}

function readBoundedJsonObject(
  filePath: string,
  source: "settings" | "override" | "bundled",
  optional: boolean,
): Record<string, unknown> | undefined {
  let fd: number;
  try {
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new GuardrailConfigError(`${source}-unreadable`);
  }
  let text: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new GuardrailConfigError(`${source}-unreadable`);
    if (stat.size > CONFIG_FILE_LIMIT_BYTES) {
      throw new GuardrailConfigError(`${source}-too-large`);
    }
    const buffer = Buffer.alloc(CONFIG_FILE_LIMIT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const bytes = readSync(fd, buffer, size, buffer.length - size, null);
      if (!bytes) break;
      size += bytes;
    }
    if (size > CONFIG_FILE_LIMIT_BYTES) {
      throw new GuardrailConfigError(`${source}-too-large`);
    }
    text = buffer.subarray(0, size).toString("utf8");
  } catch (error) {
    if (error instanceof GuardrailConfigError) throw error;
    throw new GuardrailConfigError(`${source}-unreadable`);
  } finally {
    closeSync(fd);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    rejectGuardrailJsonDuplicateKeys(text);
  } catch {
    throw new GuardrailConfigError(`${source}-invalid-json`);
  }
  if (!isObject(parsed)) invalid(source);
  return parsed as Record<string, unknown>;
}

function invalid(source: string): never {
  throw new GuardrailConfigError(`${source}-invalid-schema`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function keys(value: Record<string, unknown>, allowed: string[], source: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) invalid(source);
}

function validateScalars(raw: Record<string, unknown>, source: string): void {
  if (
    raw.confirmTimeoutMs !== undefined &&
    (typeof raw.confirmTimeoutMs !== "number" ||
      !Number.isFinite(raw.confirmTimeoutMs) ||
      raw.confirmTimeoutMs <= 0)
  )
    invalid(source);
  if (raw.productionAliases !== undefined && !strings(raw.productionAliases)) invalid(source);
}

function validateRule(raw: unknown, allowed: string[], source: string): Record<string, unknown> {
  if (!isObject(raw)) invalid(source);
  keys(raw, allowed, source);
  if (typeof raw.id !== "string" || !raw.id) invalid(source);
  if (raw.behavior !== undefined && !["off", "confirm", "block"].includes(raw.behavior as string))
    invalid(source);
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") invalid(source);
  if (raw.description !== undefined && typeof raw.description !== "string") invalid(source);
  if (raw.action !== undefined && raw.action !== "confirm" && raw.action !== "block")
    invalid(source);
  return raw;
}

function validateConfig(input: unknown, source: string): void {
  if (!isObject(input)) invalid(source);
  keys(
    input,
    [
      "version",
      "productionAliases",
      "headlessEscapeHatchEnv",
      "confirmTimeoutMs",
      "policies",
      "commandGate",
      "orgAwareGate",
    ],
    source,
  );
  if (input.version !== undefined && input.version !== 1) invalid(source);
  validateScalars(input, source);
  if (
    input.headlessEscapeHatchEnv !== undefined &&
    (typeof input.headlessEscapeHatchEnv !== "string" || !input.headlessEscapeHatchEnv)
  )
    invalid(source);
  for (const sectionName of ["policies", "commandGate", "orgAwareGate"] as const) {
    const section = input[sectionName];
    if (section === undefined) continue;
    if (!isObject(section)) invalid(source);
    const listKeys =
      sectionName === "commandGate"
        ? ["patterns", "allowedPatterns", "autoDenyPatterns"]
        : ["rules"];
    keys(section, listKeys, source);
    for (const list of Object.values(section)) {
      if (!Array.isArray(list)) invalid(source);
      const ids = new Set<string>();
      for (const raw of list) {
        const shared = ["id", "description", "behavior", "enabled"];
        const allowed =
          sectionName === "policies"
            ? [
                ...shared,
                "patterns",
                "allowedPatterns",
                "protection",
                "onlyIfExists",
                "blockMessage",
              ]
            : sectionName === "commandGate"
              ? [...shared, "pattern", "action"]
              : [...shared, "match", "whenOrgType", "action", "confirmMessage"];
        const rule = validateRule(raw, allowed, source);
        if (ids.has(rule.id as string)) invalid(source);
        ids.add(rule.id as string);
        if (sectionName === "policies") validatePolicyRule(rule, source);
        else if (sectionName === "commandGate") {
          if (typeof rule.pattern !== "string" || !rule.pattern) invalid(source);
        } else validateOrgRule(rule, source);
      }
    }
  }
}

function validatePolicyRule(rule: Record<string, unknown>, source: string): void {
  if (!["noAccess", "readOnly", "none"].includes(rule.protection as string)) invalid(source);
  if (rule.onlyIfExists !== undefined && typeof rule.onlyIfExists !== "boolean") invalid(source);
  if (rule.blockMessage !== undefined && typeof rule.blockMessage !== "string") invalid(source);
  if (!Array.isArray(rule.patterns) || rule.patterns.length === 0) invalid(source);
  for (const name of ["patterns", "allowedPatterns"]) {
    const patterns = rule[name];
    if (patterns === undefined) continue;
    if (!Array.isArray(patterns)) invalid(source);
    for (const pattern of patterns) {
      if (!isObject(pattern)) invalid(source);
      keys(pattern, ["pattern", "regex"], source);
      if (typeof pattern.pattern !== "string" || !pattern.pattern) invalid(source);
      if (pattern.regex !== undefined && typeof pattern.regex !== "boolean") invalid(source);
      if (pattern.regex) {
        try {
          new RegExp(pattern.pattern);
        } catch {
          invalid(source);
        }
      }
    }
  }
}

function validateOrgRule(rule: Record<string, unknown>, source: string): void {
  if (!isObject(rule.match) || rule.match.tool !== "bash" || !isObject(rule.match.ast))
    invalid(source);
  keys(rule.match, ["tool", "ast"], source);
  const ast = rule.match.ast;
  keys(ast, ["cmd", "subCmd", "flagIn"], source);
  if (typeof ast.cmd !== "string" || !ast.cmd) invalid(source);
  if (
    ast.subCmd !== undefined &&
    (!Array.isArray(ast.subCmd) ||
      !ast.subCmd.every((entry) => typeof entry === "string" || strings(entry)))
  )
    invalid(source);
  if (
    ast.flagIn !== undefined &&
    (!isObject(ast.flagIn) || !Object.values(ast.flagIn).every(strings))
  )
    invalid(source);
  if (
    !strings(rule.whenOrgType) ||
    rule.whenOrgType.some(
      (value) =>
        !["production", "sandbox", "scratch", "developer", "trial", "unknown"].includes(value),
    )
  )
    invalid(source);
  if (rule.confirmMessage !== undefined && typeof rule.confirmMessage !== "string") invalid(source);
}

// ─── Merge helpers ──────────────────────────────────────────────────────────────

function merge(base: GuardrailConfig, overlay: Partial<GuardrailConfig>): GuardrailConfig {
  const next: GuardrailConfig = {
    version: 1,
    productionAliases: Array.isArray(overlay.productionAliases)
      ? overlay.productionAliases.map(String)
      : base.productionAliases,
    headlessEscapeHatchEnv:
      typeof overlay.headlessEscapeHatchEnv === "string" &&
      overlay.headlessEscapeHatchEnv.length > 0
        ? overlay.headlessEscapeHatchEnv
        : base.headlessEscapeHatchEnv,
    confirmTimeoutMs:
      typeof overlay.confirmTimeoutMs === "number" && overlay.confirmTimeoutMs > 0
        ? overlay.confirmTimeoutMs
        : base.confirmTimeoutMs,
    policies: mergePolicies(base.policies, overlay.policies),
    commandGate: mergeCommandGate(base.commandGate, overlay.commandGate),
    orgAwareGate: mergeOrgAwareGate(base.orgAwareGate, overlay.orgAwareGate),
  };
  return next;
}

function mergePolicies(
  base: PoliciesConfig,
  overlay: Partial<PoliciesConfig> | undefined,
): PoliciesConfig {
  if (!overlay || !Array.isArray(overlay.rules)) return { rules: [...base.rules] };
  return { rules: mergeById(base.rules, overlay.rules, sanitizePolicyRule) };
}

function mergeCommandGate(
  base: CommandGateConfig,
  overlay: Partial<CommandGateConfig> | undefined,
): CommandGateConfig {
  if (!overlay) return { ...base, patterns: [...base.patterns] };
  return {
    patterns: mergeById(
      base.patterns,
      Array.isArray(overlay.patterns) ? overlay.patterns : [],
      sanitizeCommandPattern,
    ),
    allowedPatterns: Array.isArray(overlay.allowedPatterns)
      ? overlay.allowedPatterns.map(sanitizeCommandPattern).filter(isDefined)
      : base.allowedPatterns,
    autoDenyPatterns: Array.isArray(overlay.autoDenyPatterns)
      ? overlay.autoDenyPatterns.map(sanitizeCommandPattern).filter(isDefined)
      : base.autoDenyPatterns,
  };
}

function mergeOrgAwareGate(
  base: OrgAwareGateConfig,
  overlay: Partial<OrgAwareGateConfig> | undefined,
): OrgAwareGateConfig {
  if (!overlay || !Array.isArray(overlay.rules)) return { rules: [...base.rules] };
  return { rules: mergeById(base.rules, overlay.rules, sanitizeOrgAwareRule) };
}

function mergeById<T extends { id: string }>(
  base: T[],
  overlay: T[],
  sanitize: (input: unknown) => T | undefined,
): T[] {
  const byId = new Map<string, T>();
  for (const rule of base) byId.set(rule.id, rule);
  for (const raw of overlay) {
    const cleaned = sanitize(raw);
    if (cleaned) byId.set(cleaned.id, cleaned);
  }
  return [...byId.values()];
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

// ─── Sanitizers ─────────────────────────────────────────────────────────────────

/**
 * Walk a parsed config object and return a well-formed GuardrailConfig.
 * Used for the bundled file (which we trust) *and* in merge() so the output
 * never contains unknown fields that later code has to defend against.
 */
export function sanitize(input: unknown): GuardrailConfig {
  const base = fallbackConfig();
  if (!input || typeof input !== "object") return base;
  return merge(base, input as Partial<GuardrailConfig>);
}

function sanitizePolicyRule(input: unknown): PolicyRule | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  const id = typeof raw.id === "string" ? raw.id : undefined;
  if (!id) return undefined;
  const patterns = Array.isArray(raw.patterns)
    ? raw.patterns
        .map((p) => sanitizePolicyPattern(p))
        .filter((p): p is { pattern: string; regex?: boolean } => p !== undefined)
    : [];
  if (patterns.length === 0) return undefined;
  const allowedPatterns = Array.isArray(raw.allowedPatterns)
    ? raw.allowedPatterns
        .map((p) => sanitizePolicyPattern(p))
        .filter((p): p is { pattern: string; regex?: boolean } => p !== undefined)
    : [];
  const protection =
    raw.protection === "readOnly" || raw.protection === "none" ? raw.protection : "noAccess";
  const behavior = resolveRuleBehavior({
    behavior: sanitizeBehavior(raw.behavior),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    protection,
  });
  return {
    id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    patterns,
    allowedPatterns,
    protection,
    onlyIfExists: typeof raw.onlyIfExists === "boolean" ? raw.onlyIfExists : true,
    blockMessage: typeof raw.blockMessage === "string" ? raw.blockMessage : undefined,
    behavior,
    enabled: behaviorEnabled(behavior),
  };
}

function sanitizePolicyPattern(input: unknown): { pattern: string; regex?: boolean } | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.pattern !== "string" || raw.pattern.length === 0) return undefined;
  return {
    pattern: raw.pattern,
    regex: typeof raw.regex === "boolean" ? raw.regex : undefined,
  };
}

function sanitizeCommandPattern(input: unknown): CommandPattern | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string" || typeof raw.pattern !== "string") return undefined;
  const action = raw.action === "block" ? "block" : "confirm";
  const behavior = resolveRuleBehavior({
    behavior: sanitizeBehavior(raw.behavior),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    action,
  });
  return {
    id: raw.id,
    pattern: raw.pattern,
    description: typeof raw.description === "string" ? raw.description : undefined,
    action,
    behavior,
    enabled: behaviorEnabled(behavior),
  };
}

function sanitizeBehavior(value: unknown): "off" | "confirm" | "block" | undefined {
  return value === "off" || value === "confirm" || value === "block" ? value : undefined;
}

function sanitizeOrgAwareRule(input: unknown): OrgAwareRule | undefined {
  if (!input || typeof input !== "object") return undefined;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== "string") return undefined;
  const match = raw.match as Record<string, unknown> | undefined;
  if (!match || match.tool !== "bash" || !match.ast) return undefined;
  const ast = match.ast as Record<string, unknown>;
  if (typeof ast.cmd !== "string") return undefined;
  const whenOrgType = Array.isArray(raw.whenOrgType)
    ? raw.whenOrgType.filter(
        (v): v is "production" | "sandbox" | "scratch" | "developer" | "trial" | "unknown" =>
          typeof v === "string" &&
          ["production", "sandbox", "scratch", "developer", "trial", "unknown"].includes(v),
      )
    : [];
  const action = raw.action === "block" ? "block" : "confirm";
  const behavior = resolveRuleBehavior({
    behavior: sanitizeBehavior(raw.behavior),
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : undefined,
    action,
  });
  return {
    id: raw.id,
    description: typeof raw.description === "string" ? raw.description : undefined,
    match: {
      tool: "bash",
      ast: {
        cmd: ast.cmd,
        subCmd: Array.isArray(ast.subCmd)
          ? (ast.subCmd as (string | string[])[]).filter(
              (v) => typeof v === "string" || Array.isArray(v),
            )
          : undefined,
        flagIn:
          ast.flagIn && typeof ast.flagIn === "object"
            ? (ast.flagIn as Record<string, string[]>)
            : undefined,
      },
    },
    whenOrgType,
    action,
    behavior,
    confirmMessage: typeof raw.confirmMessage === "string" ? raw.confirmMessage : undefined,
    enabled: behaviorEnabled(behavior),
  };
}

function fallbackConfig(): GuardrailConfig {
  // Used only when the bundled file is unreadable, which should never happen
  // in a correctly-installed build. Keeps guardrail inert rather than throwing.
  return {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "SF_GUARDRAIL_ALLOW_HEADLESS",
    confirmTimeoutMs: 30000,
    policies: { rules: [] },
    commandGate: { patterns: [], allowedPatterns: [], autoDenyPatterns: [] },
    orgAwareGate: { rules: [] },
  };
}
