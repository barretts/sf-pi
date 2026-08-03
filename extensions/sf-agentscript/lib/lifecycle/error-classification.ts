/* SPDX-License-Identifier: Apache-2.0 */
/** Shared lifecycle error classification for release and agent-user actions. */
import { mapAgentApiError } from "../errors/agent-api-error-map.ts";
import { sfap404Message } from "../errors/sfap-404.ts";
import type { AgentFeatureProfile } from "../feature-profile.ts";
import { toolError, type ToolError } from "../tool-types.ts";

const LIFECYCLE_TOOL_NAME = "agentscript_lifecycle";

export function classifyLifecycleError(
  err: unknown,
  agentApiName: string,
  callingAction: "publish" | "activate" | "deactivate" | "list_versions",
  agentFile?: string,
  featureProfile?: AgentFeatureProfile,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);

  // 1. Consult the shared agent-API error map first. Same SFAP envelope as
  //    preview, so we get the typed cases (should-have-user-assigned,
  //    activation-rejected, sfap-404, etc.) for free.
  const phase: "publish" | "activate" | "deactivate" | undefined =
    callingAction === "publish" || callingAction === "activate" || callingAction === "deactivate"
      ? callingAction
      : undefined;
  if (phase) {
    const mapped = mapAgentApiError(
      // Pseudo-status: the lifecycle layer doesn't surface raw HTTP status
      // up to here, so we use 0 to skip status-only patterns. Patterns that
      // also match on body text (the ones we actually care about for
      // lifecycle) still fire.
      0,
      msg,
      {
        phase,
        surface: "lifecycle",
        agentApiName,
        agentFile,
        publishFeatureRisks: featureProfile?.publish_risks,
      },
    );
    if (mapped.matched) {
      return toolError(mapped.message, undefined, mapped.recover_via);
    }
  }

  // 2. Publish can fail with a restricted-picklist error when an action
  //    target URI names a Flow/Apex/etc. target that is not available in the
  //    org's generated function-definition registry. Surface it as an action
  //    target readiness issue instead of a raw SFAP validation blob.
  if (
    /Generative AI Function Definition ID|Invocation Target|bad value for restricted picklist field/i.test(
      msg,
    )
  ) {
    return toolError(
      msg,
      "Run agentscript_authoring inspect/check_targets for a per-target breakdown. Deploy or remove missing action targets, then publish again.",
      agentFile
        ? {
            tool: "agentscript_authoring",
            params: {
              verb: "inspect",
              mode: "check_targets",
              agent_file: agentFile,
              target_org: "<alias>",
            },
          }
        : undefined,
    );
  }

  // 3. SFAP routing failure on dev / non-Agentforce orgs — the upstream
  //    layer (lifecycle.ts / preview/client.ts) already throws sfap404Message
  //    when it detects the host fallback exhausted, so we typically don't
  //    re-enter this branch with a fresh 404. We keep it as a safety net for
  //    code paths that bubble a raw 404 string up here, and we delegate to
  //    the same shared message so the wording stays consistent.
  if (/ERROR_HTTP_404|HTTP 404|URL No Longer Exists/i.test(msg)) {
    return toolError(
      sfap404Message({
        phase:
          callingAction === "publish" || callingAction === "activate"
            ? callingAction
            : callingAction === "deactivate"
              ? "activate"
              : "publish",
        agentApiName,
      }),
    );
  }

  // 3. Agent-not-found path — only suggest list_versions if the LLM was already
  //    calling something else (activate/deactivate). For list_versions itself,
  //    a recover_via pointing back at list_versions is circular and useless.
  if (/not found/i.test(msg)) {
    if (callingAction === "list_versions") {
      return toolError(
        msg,
        'Verify the DeveloperName via `sf data query -q "SELECT DeveloperName FROM BotDefinition"`. There is no enumerate-all-agents tool yet.',
      );
    }
    return toolError(msg, "Use list_versions to confirm the DeveloperName.", {
      tool: LIFECYCLE_TOOL_NAME,
      params: { action: "list_versions", agent_api_name: agentApiName },
    });
  }
  return toolError(msg);
}
