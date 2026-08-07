/* SPDX-License-Identifier: Apache-2.0 */
/** Shared readiness calculation for the current split Herdr tool surface. */

export const HERDR_SPLIT_TOOL_NAMES = ["herdr_layout", "herdr_pane", "herdr_agent"] as const;

export interface HerdrSplitToolReadiness {
  activeControlEnv: boolean;
  anyToolActive: boolean;
  allToolsActive: boolean;
  missingTools: string[];
  ready: boolean;
}

export function getHerdrSplitToolReadiness(
  activeToolNames: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): HerdrSplitToolReadiness {
  const active = new Set(activeToolNames);
  const missingTools = HERDR_SPLIT_TOOL_NAMES.filter((name) => !active.has(name));
  const activeControlEnv = env.HERDR_ENV === "1" && !!env.HERDR_PANE_ID;
  const anyToolActive = HERDR_SPLIT_TOOL_NAMES.some((name) => active.has(name));
  const allToolsActive = missingTools.length === 0;
  return {
    activeControlEnv,
    anyToolActive,
    allToolsActive,
    missingTools,
    ready: activeControlEnv && allToolsActive,
  };
}
