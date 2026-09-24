/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Native Pi settings adapter for routine sf-guardrail preferences.
 *
 * Routine preferences live under `sfPi.guardrail` in Pi's global settings.json.
 * The advanced rule override file remains the escape hatch for custom patterns
 * and full bundled-rule replacement by stable id.
 */
import { rejectGuardrailJsonDuplicateKeys } from "../../../lib/common/guardrail-engine.ts";
import {
  globalSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import {
  NATIVE_TOOL_FAMILIES,
  normalizePowerToolSettings,
  type GuardrailPowerToolSettings,
} from "./power-tool-mode.ts";
import type { GuardrailConfig, GuardrailEngine, RuleBehavior } from "./types.ts";
import { behaviorEnabled } from "./rule-behavior.ts";

export interface GuardrailSettingsRuleBehaviors {
  policies?: Record<string, RuleBehavior>;
  commandGate?: Record<string, RuleBehavior>;
  orgAwareGate?: Record<string, RuleBehavior>;
}

export interface GuardrailPiSettings {
  engine?: GuardrailEngine;
  confirmTimeoutMs?: number;
  productionAliases?: string[];
  ruleBehaviors?: GuardrailSettingsRuleBehaviors;
  powerTool?: GuardrailPowerToolSettings;
}

const SF_PI_KEY = "sfPi";
const GUARDRAIL_KEY = "guardrail";

export function readGuardrailPiSettings(): GuardrailPiSettings {
  const root = readJsonFile(globalSettingsPath());
  return normalizeGuardrailPiSettings(guardrailSettingsValue(root));
}

/** Extract settings without normalizing away an invalid engine or policy value. */
export function guardrailSettingsValue(root: Record<string, unknown>): unknown {
  return readNestedObject(root, SF_PI_KEY, GUARDRAIL_KEY);
}

export function writeGuardrailPiSettings(settings: GuardrailPiSettings): void {
  const root = readJsonFile(globalSettingsPath());
  const sfPi = objectValue(root[SF_PI_KEY]);
  sfPi[GUARDRAIL_KEY] = pruneEmptyGuardrailSettings(normalizeGuardrailPiSettings(settings));
  root[SF_PI_KEY] = sfPi;
  writeJsonFile(globalSettingsPath(), root);
}

export function updateGuardrailPiSettings(
  updater: (settings: GuardrailPiSettings) => GuardrailPiSettings,
): GuardrailPiSettings {
  const next = updater(readGuardrailPiSettings());
  writeGuardrailPiSettings(next);
  return readGuardrailPiSettings();
}

export function hasGuardrailPiSettings(settings: GuardrailPiSettings): boolean {
  return (
    settings.engine !== undefined ||
    typeof settings.confirmTimeoutMs === "number" ||
    settings.productionAliases !== undefined ||
    settings.ruleBehaviors !== undefined ||
    settings.powerTool !== undefined
  );
}

export function applyGuardrailPiSettings(
  config: GuardrailConfig,
  settings: GuardrailPiSettings,
): GuardrailConfig {
  if (!hasGuardrailPiSettings(settings)) return config;

  const next: GuardrailConfig = JSON.parse(JSON.stringify(config)) as GuardrailConfig;

  if (typeof settings.confirmTimeoutMs === "number" && settings.confirmTimeoutMs > 0) {
    next.confirmTimeoutMs = settings.confirmTimeoutMs;
  }
  if (settings.productionAliases) {
    next.productionAliases = [...settings.productionAliases];
  }

  applyRuleBehaviors(next, settings.ruleBehaviors);
  return next;
}

export function setGuardrailTimeoutPreference(confirmTimeoutMs: number): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, confirmTimeoutMs }));
}

export function setGuardrailEngine(engine: GuardrailEngine): GuardrailPiSettings {
  if (engine !== "deterministic" && engine !== "jev") {
    throw new Error("Invalid Guardrail engine.");
  }
  // An explicit engine change must preserve supplied policy values verbatim;
  // the tolerant preference normalizer must not erase an invalid Jev policy.
  const settingsPath = globalSettingsPath();
  const root = readSettingsForEngineUpdate(settingsPath);
  const sfPi = root[SF_PI_KEY];
  if (sfPi !== undefined && (!sfPi || typeof sfPi !== "object" || Array.isArray(sfPi))) {
    throw new Error("Guardrail engine change blocked: invalid settings.");
  }
  const current = guardrailSettingsValue(root);
  validateGuardrailPiSettings(current ?? {});
  root[SF_PI_KEY] = {
    ...objectValue(sfPi),
    [GUARDRAIL_KEY]: { ...objectValue(current), engine },
  };
  writeJsonFile(settingsPath, root);
  return readGuardrailPiSettings();
}

function readSettingsForEngineUpdate(settingsPath: string): Record<string, unknown> {
  let fd: number | undefined;
  try {
    try {
      fd = openSync(settingsPath, constants.O_RDONLY | constants.O_NONBLOCK);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
    const limit = 256 * 1024;
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) throw new Error();
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const bytes = readSync(fd, buffer, size, buffer.length - size, null);
      if (!bytes) break;
      size += bytes;
    }
    if (size > limit) throw new Error();
    const text = buffer.subarray(0, size).toString("utf8");
    const parsed: unknown = JSON.parse(text);
    rejectGuardrailJsonDuplicateKeys(text);
    if (!settingsObject(parsed)) throw new Error();
    return parsed;
  } catch {
    throw new Error("Guardrail engine change blocked: invalid or unreadable settings.");
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export { rejectGuardrailJsonDuplicateKeys } from "../../../lib/common/guardrail-engine.ts";

/** Validate raw preferences before a Jev snapshot or explicit engine update. */
export function validateGuardrailPiSettings(input: unknown): void {
  const invalid = (): never => {
    throw new Error("Guardrail settings invalid.");
  };
  if (!settingsObject(input)) invalid();
  const raw = input as Record<string, unknown>;
  if (
    Object.keys(raw).some(
      (key) =>
        !["engine", "confirmTimeoutMs", "productionAliases", "ruleBehaviors", "powerTool"].includes(
          key,
        ),
    )
  )
    invalid();
  if (raw.engine !== undefined && raw.engine !== "jev" && raw.engine !== "deterministic") invalid();
  if (
    raw.confirmTimeoutMs !== undefined &&
    (typeof raw.confirmTimeoutMs !== "number" ||
      !Number.isFinite(raw.confirmTimeoutMs) ||
      raw.confirmTimeoutMs <= 0)
  )
    invalid();
  if (raw.productionAliases !== undefined && !settingsStrings(raw.productionAliases)) invalid();
  if (raw.ruleBehaviors !== undefined) {
    if (!settingsObject(raw.ruleBehaviors)) invalid();
    const behaviors = raw.ruleBehaviors as Record<string, unknown>;
    if (
      Object.keys(behaviors).some(
        (key) => !["policies", "commandGate", "orgAwareGate"].includes(key),
      )
    )
      invalid();
    for (const section of Object.values(behaviors)) {
      if (!settingsObject(section)) invalid();
      for (const [id, behavior] of Object.entries(section as Record<string, unknown>)) {
        if (!id || !["off", "confirm", "block"].includes(behavior as string)) invalid();
      }
    }
  }
  if (raw.powerTool !== undefined) {
    if (!settingsObject(raw.powerTool)) invalid();
    const power = raw.powerTool as Record<string, unknown>;
    if (
      Object.keys(power).some(
        (key) => !["mode", "nativeFamilies", "productionUnknown"].includes(key),
      )
    )
      invalid();
    if (power.mode !== undefined && !["off", "native", "all"].includes(power.mode as string))
      invalid();
    if (power.productionUnknown !== undefined && typeof power.productionUnknown !== "boolean")
      invalid();
    if (
      power.nativeFamilies !== undefined &&
      (!settingsStrings(power.nativeFamilies) ||
        power.nativeFamilies.some((id) => !NATIVE_TOOL_FAMILIES.some((family) => family.id === id)))
    )
      invalid();
  }
}

function settingsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function settingsStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

export function setGuardrailProductionAliases(aliases: string[]): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, productionAliases: aliases }));
}

export function setGuardrailPowerToolSettings(
  powerTool: GuardrailPowerToolSettings,
): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({ ...settings, powerTool }));
}

export function setGuardrailRuleBehaviorPreference(
  section: keyof GuardrailSettingsRuleBehaviors,
  ruleId: string,
  behavior: RuleBehavior,
): GuardrailPiSettings {
  return updateGuardrailPiSettings((settings) => ({
    ...settings,
    ruleBehaviors: {
      ...(settings.ruleBehaviors ?? {}),
      [section]: {
        ...(settings.ruleBehaviors?.[section] ?? {}),
        [ruleId]: behavior,
      },
    },
  }));
}

function applyRuleBehaviors(
  config: GuardrailConfig,
  ruleBehaviors: GuardrailSettingsRuleBehaviors | undefined,
): void {
  for (const rule of config.policies.rules) {
    const behavior = ruleBehaviors?.policies?.[rule.id];
    if (behavior) {
      rule.behavior = behavior;
      rule.enabled = behaviorEnabled(behavior);
    }
  }
  for (const pattern of config.commandGate.patterns) {
    const behavior = ruleBehaviors?.commandGate?.[pattern.id];
    if (behavior) {
      pattern.behavior = behavior;
      pattern.enabled = behaviorEnabled(behavior);
    }
  }
  for (const rule of config.orgAwareGate.rules) {
    const behavior = ruleBehaviors?.orgAwareGate?.[rule.id];
    if (behavior) {
      rule.behavior = behavior;
      rule.enabled = behaviorEnabled(behavior);
    }
  }
}

export function normalizeGuardrailPiSettings(input: unknown): GuardrailPiSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const raw = input as Record<string, unknown>;
  const next: GuardrailPiSettings = {};

  if (raw.engine === "deterministic" || raw.engine === "jev") next.engine = raw.engine;

  if (typeof raw.confirmTimeoutMs === "number" && raw.confirmTimeoutMs > 0) {
    next.confirmTimeoutMs = raw.confirmTimeoutMs;
  }
  if (Array.isArray(raw.productionAliases)) {
    next.productionAliases = raw.productionAliases.filter(
      (v): v is string => typeof v === "string",
    );
  }
  const ruleBehaviors = normalizeRuleBehaviors(raw.ruleBehaviors);
  if (ruleBehaviors) next.ruleBehaviors = ruleBehaviors;
  const powerTool = normalizePowerToolSettings(raw.powerTool);
  if (powerTool) next.powerTool = powerTool;

  return next;
}

function normalizeRuleBehaviors(input: unknown): GuardrailSettingsRuleBehaviors | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;
  const next: GuardrailSettingsRuleBehaviors = {};
  for (const key of ["policies", "commandGate", "orgAwareGate"] as const) {
    const values = normalizeBehaviorMap(raw[key]);
    if (values) next[key] = values;
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

function normalizeBehaviorMap(input: unknown): Record<string, RuleBehavior> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const output: Record<string, RuleBehavior> = Object.create(null) as Record<string, RuleBehavior>;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (value === "off" || value === "confirm" || value === "block") output[key] = value;
  }
  return Object.keys(output).length > 0 ? output : undefined;
}

function pruneEmptyGuardrailSettings(settings: GuardrailPiSettings): GuardrailPiSettings {
  const next: GuardrailPiSettings = {};
  if (settings.engine !== undefined) next.engine = settings.engine;
  if (typeof settings.confirmTimeoutMs === "number")
    next.confirmTimeoutMs = settings.confirmTimeoutMs;
  if (settings.productionAliases) next.productionAliases = settings.productionAliases;
  if (settings.ruleBehaviors && Object.keys(settings.ruleBehaviors).length > 0) {
    next.ruleBehaviors = settings.ruleBehaviors;
  }
  if (settings.powerTool && Object.keys(settings.powerTool).length > 0) {
    next.powerTool = settings.powerTool;
  }
  return next;
}

function readNestedObject(root: Record<string, unknown>, first: string, second: string): unknown {
  const parent = root[first];
  if (!parent || typeof parent !== "object" || Array.isArray(parent)) return undefined;
  return (parent as Record<string, unknown>)[second];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}
