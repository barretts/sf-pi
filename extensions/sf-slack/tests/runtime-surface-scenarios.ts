/* SPDX-License-Identifier: Apache-2.0 */
import type { RuntimeSurfaceScenarioModule } from "../../../scripts/runtime-surface/types.ts";

const syntheticToken = "xoxp-runtime-surface-fixture";

export const scenarios: RuntimeSurfaceScenarioModule["scenarios"] = [
  {
    name: "unconfigured",
    invoke: ["session_start", "session_shutdown"],
    expectedTools: "none",
  },
  {
    name: "configured",
    invoke: ["session_start", "session_shutdown"],
    expectedTools: "manifest",
    providerApiKeys: { "sf-slack": syntheticToken },
    expectedFetchSuffixes: ["/auth.test"],
    fetch: async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.endsWith("/auth.test")) {
        throw new Error(`Unexpected Slack fixture request: ${url}`);
      }
      return new Response(
        JSON.stringify({
          ok: true,
          user_id: "U00000000",
          user: "fixture-user",
          team_id: "T00000000",
        }),
        {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-oauth-scopes": "channels:read,files:read,users:read",
          },
        },
      );
    },
  },
];
