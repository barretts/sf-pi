/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for sf-guardrail status/audit rendering. */
import { describe, expect, it } from "vitest";

import { renderAudit, renderStatus } from "../lib/status.ts";
import { readBundledConfig } from "../lib/config.ts";
import type { Data360ExecutionChainEntryData } from "../lib/approval-ledger.ts";
import type { DecisionEntryData } from "../lib/types.ts";

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

describe("sf-guardrail status rendering", () => {
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
      jevCredentialReady: false,
    });
    expect(text).toContain("decision engine: jev");
    expect(text).toContain("OpenRouter credentials: unavailable");
    expect(text).toContain("recent Jev failures: timeout");
    expect(text).toContain("headless mode: fail-closed");
    expect(text).toContain("power tool mode: disabled for Jev");
    expect(text).toContain("operator auto-approve env: disabled for Jev");
    expect(renderAudit(recent)).toContain(
      "model=typesafe/jev-1.13-20260917; 1500ms; failure=timeout",
    );
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
