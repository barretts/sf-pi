/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Pi settings.json helpers for the gateway extension.
 *
 * This is intentionally separate from config.ts:
 * - config.ts owns gateway-specific saved config files
 * - this file owns generic Pi settings mutations (default model/provider)
 *
 * ⚠ Race risk: These functions read/write settings.json directly. Pi's own
 * settings writes (e.g. from setters like setLastChangelogVersion) could race
 * with ours. Pi v0.50.2 added external-edit preservation, but concurrent
 * writes from within the same process are still at risk. Callers should
 * use `ctx.reload()` after batch writes to let Pi re-read the file.
 *
 * Ideally Pi would expose a settings write API (pi.setSetting(key, value)).
 * Until then, this is the accepted pattern for provider extensions that
 * need to persist defaultProvider/defaultModel.
 */
import {
  globalSettingsPath as resolveGlobalSettingsPath,
  projectSettingsPath as resolveProjectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import { ENABLED_MODEL_PATTERN, PROVIDER_NAME, asOptionalString } from "./config.ts";

const LEGACY_GATEWAY_PROVIDER_PREFIX = `${PROVIDER_NAME}-`;

/**
 * The gateway registers a single canonical provider. Obsolete provider
 * suffixes are recognized generically so stale settings can be repaired
 * without retaining a retired exact identifier.
 */
function isGatewayScopePattern(pattern: string): boolean {
  return pattern === ENABLED_MODEL_PATTERN;
}

export interface EffectiveDefaultModelSetting {
  provider?: string;
  modelId?: string;
}

/** Update only model selection; Pi/user settings retain thinking authority. */
export function setDefaultModelSelection(
  settings: Record<string, unknown>,
  provider: string,
  modelId: string,
): void {
  settings.defaultProvider = provider;
  settings.defaultModel = modelId;
}

/** Repair stale gateway provider suffixes without retaining a retired exact ID. */
export function normalizeLegacyGatewayIdentitySettings(settings: Record<string, unknown>): boolean {
  let changed = false;
  const defaultProvider = asOptionalString(settings.defaultProvider);
  if (defaultProvider && isLegacyGatewayProviderId(defaultProvider)) {
    settings.defaultProvider = PROVIDER_NAME;
    changed = true;
  }

  const defaultModel = asOptionalString(settings.defaultModel);
  if (defaultModel) {
    const slash = defaultModel.indexOf("/");
    const provider = slash > 0 ? defaultModel.slice(0, slash) : undefined;
    if (provider && isLegacyGatewayProviderId(provider)) {
      settings.defaultModel = `${PROVIDER_NAME}/${defaultModel.slice(slash + 1)}`;
      changed = true;
    }
  }

  const normalizedEnabledModels = normalizeLegacyGatewayEnabledModels(settings.enabledModels);
  if (normalizedEnabledModels) {
    const currentEnabledModels = toStringArray(settings.enabledModels);
    const differs =
      normalizedEnabledModels.length !== currentEnabledModels.length ||
      normalizedEnabledModels.some((value, index) => value !== currentEnabledModels[index]);
    if (differs) {
      settings.enabledModels = normalizedEnabledModels;
      changed = true;
    }
  }

  return changed;
}

export function globalSettingsPath(): string {
  return resolveGlobalSettingsPath();
}

export function projectSettingsPath(cwd: string): string {
  return resolveProjectSettingsPath(cwd);
}

/**
 * Read Pi settings as a tolerant object.
 * Missing files and malformed JSON both collapse to {} so command handlers can
 * stay linear and user-friendly.
 */
export function readSettings(filePath: string): Record<string, unknown> {
  return readJsonFile(filePath);
}

export function writeSettings(filePath: string, settings: Record<string, unknown>): void {
  writeJsonFile(filePath, settings);
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function isExclusiveEnabledModelPattern(value: unknown): boolean {
  const patterns = toStringArray(value);
  if (patterns.length === 0) return false;
  return patterns.every((pattern) => isGatewayScopePattern(pattern));
}

function isLegacyGatewayProviderId(provider: string): boolean {
  return provider.startsWith(LEGACY_GATEWAY_PROVIDER_PREFIX);
}

function isLegacyGatewayModelPattern(pattern: string): boolean {
  if (isGatewayScopePattern(pattern)) return false;
  const provider = pattern.split("/", 1)[0];
  return provider ? isLegacyGatewayProviderId(provider) : false;
}

/**
 * Collapse entries from obsolete gateway provider suffixes to the canonical
 * provider wildcard. Current-provider exact model IDs remain untouched.
 */
export function normalizeLegacyGatewayEnabledModels(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const patterns = toStringArray(value);
  let hasGatewayScope = false;
  const otherPatterns: string[] = [];

  for (const pattern of patterns) {
    if (isGatewayScopePattern(pattern) || isLegacyGatewayModelPattern(pattern)) {
      hasGatewayScope = true;
      continue;
    }

    if (!otherPatterns.includes(pattern)) {
      otherPatterns.push(pattern);
    }
  }

  if (!hasGatewayScope) {
    return patterns;
  }

  return [ENABLED_MODEL_PATTERN, ...otherPatterns];
}

export function snapshotEnabledModelsForExclusiveScope(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }
  return removeEnabledModelPattern(value);
}

/**
 * Keep the gateway provider pattern present and at the front of enabledModels.
 */
export function ensureEnabledModelPattern(value: unknown): string[] {
  const existing = toStringArray(value).filter((item) => !isGatewayScopePattern(item));
  return [ENABLED_MODEL_PATTERN, ...existing];
}

/** Replace enabledModels with gateway-only scope. */
export function setExclusiveEnabledModelPattern(): string[] {
  return [ENABLED_MODEL_PATTERN];
}

/** Remove the gateway provider pattern from enabledModels. */
export function removeEnabledModelPattern(value: unknown): string[] {
  return toStringArray(value).filter((item) => !isGatewayScopePattern(item));
}

export function restoreEnabledModelsSnapshot(
  snapshot: string[] | null | undefined,
): string[] | undefined {
  if (snapshot === undefined || snapshot === null) {
    return undefined;
  }
  return [...snapshot];
}

export function applyGatewayModelScope(value: unknown, exclusiveScope: boolean): string[] {
  return exclusiveScope ? setExclusiveEnabledModelPattern() : ensureEnabledModelPattern(value);
}

export function shouldCaptureExclusiveScopeSnapshot(
  value: unknown,
  existingSnapshot: string[] | null | undefined,
): boolean {
  return existingSnapshot === undefined || !isExclusiveEnabledModelPattern(value);
}

/**
 * Project settings override global settings, matching Pi's normal precedence.
 * We only read the default-provider related keys here.
 */
export function getEffectiveDefaultModelSetting(cwd: string): EffectiveDefaultModelSetting {
  const merged = {
    ...readSettings(globalSettingsPath()),
    ...readSettings(projectSettingsPath(cwd)),
  };

  return {
    provider: asOptionalString(merged.defaultProvider),
    modelId: asOptionalString(merged.defaultModel),
  };
}
