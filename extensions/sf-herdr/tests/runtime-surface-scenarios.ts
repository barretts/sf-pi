/* SPDX-License-Identifier: Apache-2.0 */
import type { RuntimeSurfaceScenarioModule } from "../../../scripts/runtime-surface/types.ts";

export const scenarios: RuntimeSurfaceScenarioModule["scenarios"] = [
  {
    name: "not-ready",
    invoke: ["session_start"],
    expectedTools: "none",
  },
  {
    name: "ready",
    invoke: ["session_start"],
    expectedTools: "manifest",
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "opaque-test-pane",
    },
    activeTools: ["herdr_layout", "herdr_pane", "herdr_agent"],
  },
];
