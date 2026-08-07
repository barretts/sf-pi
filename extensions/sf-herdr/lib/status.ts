/* SPDX-License-Identifier: Apache-2.0 */
/** Status and doctor rendering for the current split Herdr runtime. */
import { getHerdrSplitToolReadiness } from "../../../lib/common/herdr-runtime.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";
import { readSfHerdrSettings } from "./settings.ts";

export function renderStatus(
  activeToolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const readiness = getHerdrSplitToolReadiness(activeToolNames, env);
  const settings = readSfHerdrSettings();
  return [
    "SF Herdr status",
    `Runtime: ${readiness.activeControlEnv ? "inside Herdr pane" : "not inside Herdr pane"}`,
    `Current tools: ${readiness.allToolsActive ? "all active" : `missing ${readiness.missingTools.join(", ")}`}`,
    `Planner: ${readiness.ready ? "ready" : "not registered for this runtime"}`,
    env.HERDR_PANE_ID ? `Current pane: ${env.HERDR_PANE_ID}` : undefined,
    `Global settings: ${globalSettingsPath()} → sfPi.herdr`,
    `Split direction: ${settings.splitDirection}`,
  ]
    .filter((line): line is string => typeof line === "string")
    .join("\n");
}

export function renderDoctor(
  activeToolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): string {
  const readiness = getHerdrSplitToolReadiness(activeToolNames, env);
  return [
    "SF Herdr doctor",
    "✓ sf-herdr command and settings surfaces loaded",
    `${readiness.activeControlEnv ? "✓" : "○"} HERDR_ENV=1 and HERDR_PANE_ID ${readiness.activeControlEnv ? "detected" : "not detected"}`,
    `${readiness.allToolsActive ? "✓" : "○"} Current split tools ${readiness.allToolsActive ? "all active" : `missing: ${readiness.missingTools.join(", ")}`}`,
    `${readiness.ready ? "✓" : "○"} sf_herdr_plan ${readiness.ready ? "eligible at session startup" : "not eligible in this runtime"}`,
    "",
    "The planner never mutates panes or generates commands. Herdr actions remain explicit.",
    "SF Guardrail mediates herdr_pane action=run commands when configured safety rules match.",
  ].join("\n");
}
