/* SPDX-License-Identifier: Apache-2.0 */
/** Four inherited, non-secret sf-tldraw preferences stored in Pi settings. */
import {
  globalSettingsPath,
  projectSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";
import type {
  EffectiveTldrawPreferences,
  SettingsScope,
  TldrawPreferenceKey,
  TldrawPreferences,
} from "./types.ts";

export const DEFAULT_TLDRAW_PREFERENCES: TldrawPreferences = {
  cardinalityDetail: "simplified",
  cardFill: "transparent",
  ldvThreshold: "2M",
  recordTypeMode: "off",
};

export interface TldrawPreferenceDescriptor {
  key: TldrawPreferenceKey;
  label: string;
  description: string;
  values: readonly string[];
}

export const TLDRAW_PREFERENCE_DESCRIPTORS: readonly TldrawPreferenceDescriptor[] = [
  {
    key: "cardinalityDetail",
    label: "Cardinality detail",
    description: "Simplified bar/crow-foot or full physical optionality.",
    values: ["simplified", "full"],
  },
  {
    key: "cardFill",
    label: "Card fill",
    description: "Transparent keeps white object cards; family tints them by object family.",
    values: ["transparent", "family"],
  },
  {
    key: "ldvThreshold",
    label: "LDV threshold",
    description: "Minimum observed row count that receives an LDV pill.",
    values: ["1M", "2M", "5M", "10M"],
  },
  {
    key: "recordTypeMode",
    label: "Record types",
    description:
      "Off by default; auto shows meaningful multiplicity; always shows supplied values.",
    values: ["off", "auto", "always"],
  },
];

const KEYS = TLDRAW_PREFERENCE_DESCRIPTORS.map(
  (descriptor) => descriptor.key,
) as TldrawPreferenceKey[];

export function readScopedTldrawPreferences(
  cwd: string,
  scope: SettingsScope,
): Partial<TldrawPreferences> {
  const settings = readJsonFile(
    scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath(),
  );
  return sanitize(readNested(settings));
}

export function readEffectiveTldrawPreferences(cwd: string): EffectiveTldrawPreferences {
  const global = readScopedTldrawPreferences(cwd, "global");
  const project = readScopedTldrawPreferences(cwd, "project");
  const result = { ...DEFAULT_TLDRAW_PREFERENCES } as EffectiveTldrawPreferences;
  result.sources = {} as EffectiveTldrawPreferences["sources"];
  for (const key of KEYS) {
    if (project[key] !== undefined) {
      setValue(result, key, project[key]);
      result.sources[key] = { scope: "project", path: projectSettingsPath(cwd) };
    } else if (global[key] !== undefined) {
      setValue(result, key, global[key]);
      result.sources[key] = { scope: "global", path: globalSettingsPath() };
    } else {
      result.sources[key] = { scope: "default" };
    }
  }
  return result;
}

export function writeTldrawPreference<K extends TldrawPreferenceKey>(
  cwd: string,
  scope: SettingsScope,
  key: K,
  value: TldrawPreferences[K],
): EffectiveTldrawPreferences {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const settings = readJsonFile(filePath);
  const sfPi = object(settings.sfPi);
  const tldraw = object(sfPi.tldraw);
  tldraw[key] = value;
  sfPi.tldraw = tldraw;
  settings.sfPi = sfPi;
  writeJsonFile(filePath, settings);
  return readEffectiveTldrawPreferences(cwd);
}

export function clearTldrawPreference(
  cwd: string,
  scope: SettingsScope,
  key: TldrawPreferenceKey,
): EffectiveTldrawPreferences {
  const filePath = scope === "project" ? projectSettingsPath(cwd) : globalSettingsPath();
  const settings = readJsonFile(filePath);
  const sfPi = object(settings.sfPi);
  const tldraw = object(sfPi.tldraw);
  delete tldraw[key];
  if (Object.keys(tldraw).length > 0) sfPi.tldraw = tldraw;
  else delete sfPi.tldraw;
  if (Object.keys(sfPi).length > 0) settings.sfPi = sfPi;
  else delete settings.sfPi;
  writeJsonFile(filePath, settings);
  return readEffectiveTldrawPreferences(cwd);
}

export function preferenceSourceLabel(
  preferences: EffectiveTldrawPreferences,
  key: TldrawPreferenceKey,
): string {
  const source = preferences.sources[key];
  return source.scope === "default" ? "default" : source.scope;
}

function readNested(settings: Record<string, unknown>): unknown {
  return object(object(settings.sfPi).tldraw);
}

function sanitize(value: unknown): Partial<TldrawPreferences> {
  const input = object(value);
  const result: Partial<TldrawPreferences> = {};
  for (const descriptor of TLDRAW_PREFERENCE_DESCRIPTORS) {
    const candidate = input[descriptor.key];
    if (typeof candidate === "string" && descriptor.values.includes(candidate)) {
      setValue(result, descriptor.key, candidate as TldrawPreferences[TldrawPreferenceKey]);
    }
  }
  return result;
}

function setValue(
  target: Partial<TldrawPreferences>,
  key: TldrawPreferenceKey,
  value: TldrawPreferences[TldrawPreferenceKey],
): void {
  (target as unknown as Record<string, unknown>)[key] = value;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
