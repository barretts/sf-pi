/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-guardrail status/audit rendering. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderAudit, renderStatus } from "../lib/status.ts";
import { readBundledConfig } from "../lib/config.ts";
import { recordDecision } from "../lib/approval-ledger.ts";
import { evaluateJevSafety } from "../lib/jev-risk.ts";
import { JEV_RESOLVED_MODEL } from "../lib/jev-client.ts";
import type { Data360ExecutionChainEntryData } from "../lib/approval-ledger.ts";
import type { DecisionEntryData } from "../lib/types.ts";
import { controlledAllHeadTransport } from "./jev-controlled-transport.ts";

const chain: Data360ExecutionChainEntryData = {
  timestamp: Date.UTC(2026, 6, 6, 20, 0, 0),
  sessionId: "session-1",
  parentTool: "data360_orchestrate",
  parentAction: "manifest.run",
  targetOrg: "AgentforceSTDM",
  journey_fingerprint: "abc123def4567890",
  ok: true,
  executionChain: [
    {
      tool: "data360_connect",
      action: "source_schema.put",
      ok: true,
      summary: "schema uploaded",
    },
    {
      tool: "data360_prepare",
      action: "ingest_job.upload_csv",
      ok: true,
      summary: "uploaded csv",
    },
  ],
};

beforeEach(() => {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "https://decisions.example.invalid/v1/decisions");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sf-guardrail status rendering", () => {
  it("shows an independent file-policy block alongside the actual operational risk allow", async () => {
    const answers = {
      risk: {
        choice: "allow" as const,
        probabilities: { allow: 1, confirm: 0, block: 0 },
        confidence: 0.83,
      },
      file_policy: {
        choice: "block" as const,
        probabilities: { allow: 0.02, confirm: 0.03, block: 0.95 },
        confidence: 0.95,
      },
    };
    const createTransport = controlledAllHeadTransport((id) => answers[id], {
      requestId: "synthetic-independent-answer-request",
      usage: { input_tokens: 20, output_tokens: 30 },
    });
    const decision = await evaluateJevSafety(
      {
        toolName: "write",
        input: { path: ".env", content: "PRIVATE_FILE_BODY_SENTINEL" },
        cwd: "/synthetic/project",
        config: readBundledConfig(),
      },
      {
        createTransport,
        resolveFacts: async () => ({ facts: { files: [{ path: ".env", exists: true }] } }),
      },
    );
    expect(createTransport).toHaveBeenCalledOnce();
    expect(createTransport.mock.results[0].value.requestAllHeads).toHaveBeenCalledOnce();
    expect(decision.action).toBe("block");
    const recent: DecisionEntryData[] = [];
    const pi = {
      appendEntry: (_type: string, entry: DecisionEntryData) => recent.push(entry),
    } as unknown as Parameters<typeof recordDecision>[0];
    recordDecision(
      pi,
      decision,
      decision.action === "block" ? "hard_block" : "allow_auto",
      "write",
    );
    const audit = renderAudit(recent);
    expect(audit).toContain("hard_block");
    expect(audit).toContain("risk P(allow)=1.0000; risk confidence=0.8300");
    expect(audit).toContain("risk=allow (P(allow)=1.0000; confidence=0.8300)");
    expect(audit).toContain("file_policy=block (P(allow)=0.0200; confidence=0.9500)");
    expect(audit).not.toContain("PRIVATE_FILE_BODY_SENTINEL");
  });

  it("labels historical risk-only evidence without requiring independent answers", () => {
    const recent: DecisionEntryData[] = [
      {
        timestamp: Date.UTC(2026, 6, 6, 20, 0, 0),
        toolName: "read",
        subject: "read metadata",
        feature: "jevGate",
        ruleId: "jev-risk",
        outcome: "allow_auto",
        fingerprint: "exact-call",
        reason: "Allowed.",
        jev: {
          model: JEV_RESOLVED_MODEL,
          latencyMs: 150,
          probabilities: { allow: 0.999, confirm: 0.001, block: 0 },
          confidence: 0.999,
          policyHash: "policy",
          protocolHash: "protocol",
        },
      },
    ];
    expect(renderAudit(recent)).toContain("risk P(allow)=0.9990; risk confidence=0.9990");
    expect(renderAudit(recent)).not.toContain("file_policy=");
  });

  it("shows Jev readiness, failures, and disabled legacy automation", () => {
    const recent: DecisionEntryData[] = [
      {
        timestamp: Date.UTC(2026, 6, 6, 20, 0, 0),
        toolName: "read",
        subject: "read metadata",
        feature: "jevGate",
        ruleId: "jev-unavailable",
        outcome: "hard_block",
        fingerprint: "exact-call",
        reason: "Jev unavailable.",
        jev: {
          model: "typesafe/jev-1.13-20260917",
          latencyMs: 1500,
          failure: "timeout",
          policyHash: "policy",
          protocolHash: "protocol",
        },
      },
    ];
    const text = renderStatus({
      config: readBundledConfig(),
      configSource: "settings",
      recent,
      hasUI: false,
      headlessEnabled: true,
      operatorAutoApproveEnabled: true,
      powerTool: { mode: "all", productionUnknown: true },
      engine: "jev",
      jevModel: "typesafe/jev-1.13-20260917",
      jevEndpointStatus: "missing",
      jevCredentialReady: false,
    });
    expect(text).toContain("decision engine: jev");
    expect(text).toContain("Decisions provider connection: missing");
    expect(text).toContain("Jev API key: unavailable");
    expect(text).toContain("recent Jev failures: timeout");
    expect(text).toContain("headless mode: fail-closed");
    expect(text).toContain("power tool mode: disabled for Jev");
    expect(text).toContain("operator auto-approve env: disabled for Jev");
    expect(renderAudit(recent)).toContain(
      "model=typesafe/jev-1.13-20260917; 1500ms; failure=timeout",
    );
  });

  it.each(["ready", "missing", "invalid"] as const)(
    "shows a fixed %s connection status",
    (jevEndpointStatus) => {
      const text = renderStatus({
        config: readBundledConfig(),
        configSource: "settings",
        recent: [],
        hasUI: true,
        headlessEnabled: false,
        operatorAutoApproveEnabled: false,
        engine: "jev",
        jevEndpointStatus,
        jevCredentialReady: true,
      });
      expect(text).toContain(`Decisions provider connection: ${jevEndpointStatus}`);
      expect(text).toContain("Jev API key: ready");
    },
  );

  it("does not print an unexpected connection status value", () => {
    const endpoint = "https://decisions.example.invalid/private-gateway/v1/decisions";
    const text = renderStatus({
      config: readBundledConfig(),
      configSource: "settings",
      recent: [],
      hasUI: true,
      headlessEnabled: false,
      operatorAutoApproveEnabled: false,
      engine: "jev",
      jevEndpointStatus: endpoint,
    });
    expect(text).toContain("Decisions provider connection: invalid");
    expect(text).not.toContain(endpoint);
  });

  it("surfaces Data 360 execution chains separately from guardrail decisions", () => {
    const text = renderAudit([], [chain]);

    expect(text).toContain("No guardrail decisions recorded this session.");
    expect(text).toContain("related Data 360 execution chains (1)");
    expect(text).toContain("data360_orchestrate manifest.run");
    expect(text).toContain("data360_connect source_schema.put");
    expect(text).toContain("data360_prepare ingest_job.upload_csv");
  });

  it("includes recent Data 360 execution chains in status output", () => {
    const text = renderStatus({
      config: readBundledConfig(),
      configSource: "bundled",
      recent: [],
      data360ExecutionChains: [chain],
      hasUI: false,
      headlessEnabled: false,
      operatorAutoApproveEnabled: false,
    });

    expect(text).toContain("no guardrail decisions this session");
    expect(text).toContain("related Data 360 execution chains (1)");
    expect(text).toContain("org=AgentforceSTDM");
  });
});
