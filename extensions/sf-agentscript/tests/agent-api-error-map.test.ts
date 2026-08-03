/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Server-error → actionable diagnostic mapping. Locks in the patterns that
 * most often confuse the LLM, with chain-able recover_via where possible.
 * Preview and lifecycle share this canonical map.
 */

import { describe, expect, test } from "vitest";
import { mapAgentApiError } from "../lib/errors/agent-api-error-map.ts";

describe("mapAgentApiError (preview surface)", () => {
  test("version-cache-miss → bundle-meta / publish hint", () => {
    const m = mapAgentApiError(
      500,
      {
        message: "Attempted to retrieve bot version ID to insert into cache, but record not found",
      },
      { phase: "start", surface: "agent_file", agentName: "Hello_Bot" },
    );
    expect(m.matched).toBe("version-cache-miss");
    expect(m.message).toMatch(/agentVersion\.developerName|<target>/i);
    expect(m.message).toMatch(/v0|v1/);
  });

  test("surface population failure → connection surface guidance", () => {
    const m = mapAgentApiError(
      500,
      {
        errorCode: "Error",
        message:
          "Failed to populate planner surface. Make sure the surface type is valid and org has access to it: ServiceEmail",
      },
      { phase: "start", surface: "agent_file", agentFile: "/tmp/X.agent" },
    );
    expect(m.matched).toBe("surface-population-failed");
    expect(m.message).toMatch(/connection surface/i);
    expect(m.message).toMatch(/response_formats/i);
    expect(m.recover_via).toEqual({
      tool: "agentscript_authoring",
      params: { verb: "inspect", mode: "structure", agent_file: "/tmp/X.agent" },
    });
  });

  test("session-not-found → recover_via start", () => {
    const m = mapAgentApiError(
      500,
      { message: "V6Session not found for sessionId: xyz" },
      { phase: "send", surface: "api_name", agentApiName: "Bot" },
    );
    expect(m.matched).toBe("session-not-found");
    expect(m.recover_via).toEqual({
      tool: "agentscript_preview",
      params: { action: "start" },
    });
  });

  test("session-not-found also matches v1.1 wording", () => {
    const m = mapAgentApiError(
      500,
      { message: "Session not found for sessionId: abc" },
      { phase: "send", surface: "agent_file" },
    );
    expect(m.matched).toBe("session-not-found");
  });

  test("invalid-user-id → Service vs Employee guidance", () => {
    const svc = mapAgentApiError(
      400,
      { message: "Bad Request: Invalid user ID provided on start session: " },
      { phase: "start", surface: "api_name", agentApiName: "Bot" },
    );
    expect(svc.matched).toBe("invalid-user-id");
    // Now points at our own verb instead of the sf CLI command — we ship
    // provision_agent_user as the canonical fix.
    expect(svc.message).toMatch(/provision_agent_user/);
    expect(svc.message).toMatch(/Einstein Agent User/);

    const emp = mapAgentApiError(
      400,
      { message: "Bad Request: Invalid user ID provided on start session: " },
      { phase: "start", surface: "agent_file" },
    );
    expect(emp.matched).toBe("invalid-user-id");
    expect(emp.message).toMatch(/AgentforceEmployeeAgent/);
  });

  test("inactive-agent → activate recover_via", () => {
    const m = mapAgentApiError(
      412,
      {
        message:
          '412 [{"errorCode":"PRECONDITION_FAILED","message":"No access to Einstein Copilot."}]',
      },
      { phase: "start", surface: "api_name", agentApiName: "My_Bot" },
    );
    expect(m.matched).toBe("inactive-agent");
    expect(m.recover_via).toEqual({
      tool: "agentscript_lifecycle",
      params: { action: "activate", agent_api_name: "My_Bot" },
    });
  });

  test("412 status alone (without the canonical message) still maps to inactive-agent", () => {
    const m = mapAgentApiError(
      412,
      { message: "Some other 412" },
      { phase: "start", surface: "api_name", agentApiName: "X" },
    );
    expect(m.matched).toBe("inactive-agent");
  });

  test("sfap-404 → transient-first wording, no false claim that the org isn't Agentforce-enabled", () => {
    // Issue 5: previous wording asserted the org wasn't Agentforce-enabled,
    // which fired immediately after a successful publish in the same
    // session. The rewritten message states what happened, calls out
    // 404s as usually transient, and lists possible permanent causes
    // without claiming any of them are true.
    const m = mapAgentApiError(
      404,
      { errorCode: "ERROR_HTTP_404", message: "" },
      { phase: "start", surface: "agent_file" },
    );
    expect(m.matched).toBe("sfap-404");
    expect(m.message).toMatch(/usually transient/i);
    expect(m.message).toMatch(/host fallback/i);
    expect(m.message).toMatch(/may not be Agentforce-enabled/);
    expect(m.message).toMatch(/may lack the right permission/);
    // No retry-30s claim baked into the literal text? Yes — we expect it.
    expect(m.message).toMatch(/retry in 30s/i);
  });

  test("sfap-404 includes a list_versions hint when agentApiName is known", () => {
    const m = mapAgentApiError(
      404,
      { errorCode: "ERROR_HTTP_404", message: "" },
      { phase: "start", surface: "api_name", agentApiName: "My_Bot" },
    );
    expect(m.matched).toBe("sfap-404");
    expect(m.message).toMatch(/list_versions/);
    expect(m.message).toMatch(/My_Bot/);
  });

  test("bootstrap-failed → JWT scopes hint", () => {
    const m = mapAgentApiError(
      401,
      { message: "Agent API auth bootstrap failed at /agentforce/bootstrap/nameduser" },
      { phase: "start", surface: "agent_file" },
    );
    expect(m.matched).toBe("bootstrap-failed");
    expect(m.message).toMatch(/sfap_api/);
  });

  test("server compile 422 with compatibility risks explains local/org compiler skew", () => {
    const m = mapAgentApiError(
      400,
      {
        message:
          "422 Unprocessable Entity from POST https://compiler.invalid/afscript/v2/parseandcompile",
      },
      {
        phase: "start",
        surface: "agent_file",
        agentFile: "/tmp/Capability.agent",
        publishFeatureRisks: [
          {
            code: "runtime_org_compiler_compatibility",
            message: "config.runtime may not be accepted by the target org compiler.",
            evidence: ["config.runtime"],
          },
        ],
      },
    );
    expect(m.matched).toBe("org-compiler-feature-skew");
    expect(m.message).toMatch(/local compiler/i);
    expect(m.message).toMatch(/target org/i);
    expect(m.message).toContain("config.runtime");
    expect(m.message).not.toContain("compiler.invalid");
  });

  test("HTTP 200 server compile failure maps experimental collect skew", () => {
    const m = mapAgentApiError(
      200,
      {
        status: "failure",
        errors: [{ errorType: "CompilationError", description: "Syntax error" }],
      },
      {
        phase: "start",
        surface: "agent_file",
        publishFeatureRisks: [
          {
            code: "collect_org_compiler_compatibility",
            message: "collect may not be accepted by the target org compiler.",
            evidence: ["collect statement"],
          },
        ],
      },
    );
    expect(m.matched).toBe("org-compiler-feature-skew");
    expect(m.message).toContain("collect_org_compiler_compatibility");
    expect(m.message).not.toContain("CompilationError");
  });

  test("unknown errors pass through verbatim with matched=null", () => {
    const m = mapAgentApiError(
      500,
      { message: "Some new server error we haven't seen before" },
      { phase: "send", surface: "agent_file" },
    );
    expect(m.matched).toBeNull();
    expect(m.message).toMatch(/HTTP 500/);
    expect(m.message).toMatch(/new server error/);
    expect(m.recover_via).toBeUndefined();
  });

  test("string body is handled (some routes return text/plain)", () => {
    const m = mapAgentApiError(500, "V6Session not found for sessionId: abc", {
      phase: "send",
      surface: "api_name",
    });
    expect(m.matched).toBe("session-not-found");
  });

  test("null/empty body still produces a non-empty message", () => {
    const m = mapAgentApiError(500, null, { phase: "start", surface: "agent_file" });
    expect(m.matched).toBeNull();
    expect(m.message).toBeTruthy();
  });
});

describe("mapAgentApiError (lifecycle surface, Issue 4 patterns)", () => {
  test("should-have-user-assigned → provision_agent_user recover_via", () => {
    const m = mapAgentApiError(
      0,
      "Activation request did not succeed: This Agent Type should have a user assigned.",
      {
        phase: "activate",
        surface: "lifecycle",
        agentApiName: "Demo_Greeter",
        agentFile: "/tmp/Demo_Greeter.agent",
      },
    );
    expect(m.matched).toBe("should-have-user-assigned");
    expect(m.message).toMatch(/Service Agents need an Einstein Agent User/);
    expect(m.message).toMatch(/sf project deploy/i);
    expect(m.recover_via).toEqual({
      tool: "agentscript_lifecycle",
      params: {
        action: "provision_agent_user",
        agent_file: "/tmp/Demo_Greeter.agent",
        dry_run: true,
      },
    });
  });

  test("should-have-user-assigned without agentFile — still rewrites message, omits recover_via", () => {
    const m = mapAgentApiError(0, "This Agent Type should have a user assigned", {
      phase: "activate",
      surface: "lifecycle",
      agentApiName: "X",
    });
    expect(m.matched).toBe("should-have-user-assigned");
    expect(m.recover_via).toBeUndefined();
  });

  test("internal-error-publish with channel-gated features → feature entitlement hint", () => {
    const m = mapAgentApiError(
      500,
      { message: "Internal Error, try again later" },
      {
        phase: "publish",
        surface: "lifecycle",
        agentApiName: "Voice_Bot",
        agentFile: "/tmp/Voice_Bot.agent",
        publishFeatureRisks: [
          {
            code: "voice_modality_publish_may_require_channel_entitlement",
            message: "modality voice may require voice-channel support",
            evidence: ["modality voice"],
          },
        ],
      },
    );
    expect(m.matched).toBe("feature-gated-publish-internal-error");
    expect(m.message).toMatch(/channel\/surface-gated/i);
    expect(m.message).toMatch(/modality voice/);
    expect(m.recover_via).toEqual({
      tool: "agentscript_authoring",
      params: {
        verb: "inspect",
        mode: "context_profile",
        agent_file: "/tmp/Voice_Bot.agent",
      },
    });
  });

  test("internal-error-publish (HTTP 500 on publish) → diagnose hint", () => {
    const m = mapAgentApiError(
      500,
      { errorCode: "Error", message: "Internal Error, try again later" },
      {
        phase: "publish",
        surface: "lifecycle",
        agentApiName: "X",
        agentFile: "/tmp/X.agent",
      },
    );
    expect(m.matched).toBe("internal-error-publish");
    expect(m.message).toMatch(/AgentforceServiceAgentUser/);
    expect(m.recover_via).toEqual({
      tool: "agentscript_lifecycle",
      params: { action: "diagnose_agent_user", agent_file: "/tmp/X.agent" },
    });
  });

  test("internal-error-publish only fires on lifecycle.publish (not on preview)", () => {
    const m = mapAgentApiError(
      500,
      { message: "Internal Error, try again later" },
      { phase: "start", surface: "agent_file" },
    );
    // 500-on-preview falls through to default; should NOT match
    // internal-error-publish.
    expect(m.matched).not.toBe("internal-error-publish");
  });

  test("deactivation dependency lock explains ordering and propagation", () => {
    const m = mapAgentApiError(
      0,
      "Activation request did not succeed: Agent you are trying to deactivate is in use by other agents",
      {
        phase: "deactivate",
        surface: "lifecycle",
        agentApiName: "Shared_Helper",
      },
    );
    expect(m.matched).toBe("deactivation-dependent-agent");
    expect(m.message).toMatch(/dependent .*agents/i);
    expect(m.message).toMatch(/propagat/i);
    expect(m.message).not.toMatch(/agent_type/);
  });

  test("activation-rejected catch-all → inspect hint", () => {
    const m = mapAgentApiError(
      0,
      "Activation request did not succeed: Some new validation we haven't seen.",
      {
        phase: "activate",
        surface: "lifecycle",
        agentApiName: "X",
        agentFile: "/tmp/X.agent",
      },
    );
    expect(m.matched).toBe("activation-rejected");
    expect(m.message).toMatch(/Some new validation/);
    expect(m.recover_via).toEqual({
      tool: "agentscript_authoring",
      params: { verb: "inspect", mode: "structure", agent_file: "/tmp/X.agent" },
    });
  });

  test("more-specific should-have-user-assigned wins over the activation-rejected catch-all", () => {
    const m = mapAgentApiError(
      0,
      "Activation request did not succeed: This Agent Type should have a user assigned.",
      { phase: "activate", surface: "lifecycle", agentApiName: "X" },
    );
    expect(m.matched).toBe("should-have-user-assigned");
  });
});
