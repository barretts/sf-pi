/* SPDX-License-Identifier: Apache-2.0 */
/** Global-only native Pi settings for SF Herdr. */
import { HERDR_PLAN_INTENTS, type HerdrPlanIntent } from "../../../lib/common/herdr.ts";
import {
  globalSettingsPath,
  readJsonFile,
  writeJsonFile,
} from "../../../lib/common/sf-pi-settings.ts";

export type HerdrSplitDirection = "auto" | "right" | "down";
export type HerdrLifecycle = "ephemeral" | "sticky" | "manual";

export interface SfHerdrSettings {
  splitDirection: HerdrSplitDirection;
  lifecycleByIntent: Record<HerdrPlanIntent, HerdrLifecycle>;
}

export const DEFAULT_SF_HERDR_SETTINGS: SfHerdrSettings = {
  splitDirection: "auto",
  lifecycleByIntent: {
    "run-tests": "ephemeral",
    "tail-logs": "ephemeral",
    "deploy-validate": "ephemeral",
    preview: "ephemeral",
    eval: "ephemeral",
    server: "sticky",
    review: "manual",
    verify: "ephemeral",
  },
};

export function readSfHerdrSettings(): SfHerdrSettings {
  const root = readJsonFile(globalSettingsPath());
  const sfPi = asObject(root.sfPi);
  const raw = asObject(sfPi?.herdr);
  const lifecycle = asObject(raw?.lifecycleByIntent);
  return {
    splitDirection: isSplitDirection(raw?.splitDirection)
      ? raw.splitDirection
      : DEFAULT_SF_HERDR_SETTINGS.splitDirection,
    lifecycleByIntent: Object.fromEntries(
      HERDR_PLAN_INTENTS.map((intent) => [
        intent,
        isLifecycle(lifecycle?.[intent])
          ? lifecycle[intent]
          : DEFAULT_SF_HERDR_SETTINGS.lifecycleByIntent[intent],
      ]),
    ) as Record<HerdrPlanIntent, HerdrLifecycle>,
  };
}

export function writeSfHerdrSettings(settings: SfHerdrSettings): void {
  const filePath = globalSettingsPath();
  const root = readJsonFile(filePath);
  const sfPi = { ...(asObject(root.sfPi) ?? {}) };
  sfPi.herdr = {
    splitDirection: settings.splitDirection,
    lifecycleByIntent: Object.fromEntries(
      HERDR_PLAN_INTENTS.map((intent) => [intent, settings.lifecycleByIntent[intent]]),
    ),
  };
  writeJsonFile(filePath, { ...root, sfPi });
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isSplitDirection(value: unknown): value is HerdrSplitDirection {
  return value === "auto" || value === "right" || value === "down";
}

function isLifecycle(value: unknown): value is HerdrLifecycle {
  return value === "ephemeral" || value === "sticky" || value === "manual";
}
