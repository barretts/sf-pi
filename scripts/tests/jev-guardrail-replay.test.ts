/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JevClientError,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
} from "../../extensions/sf-guardrail/lib/jev-client.ts";
import type { JevPrediction, JevRequest } from "../../extensions/sf-guardrail/lib/types.ts";
import {
  readAcceptance,
  readBaseline,
  readDiagnostic,
  runReplayCases,
  summarizeReplay,
  type ReplayCase,
} from "../jev-guardrail-replay.ts";

const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

function prediction(choice: JevPrediction["choice"] = "allow"): JevPrediction {
  return {
    choice,
    probabilities: {
      allow: choice === "allow" ? 1 : 0,
      confirm: choice === "confirm" ? 1 : 0,
      block: choice === "block" ? 1 : 0,
    },
    confidence: 1,
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    requestId: "replay-fixture-response",
    usage: { input_tokens: 20, output_tokens: 1, cost: 0.00001 },
  };
}

describe("Jev replay acceptance and proof boundaries", () => {
  it("freezes twelve complete synthetic pairs and two explicit blocks", async () => {
    const fixture = await readAcceptance();
    expect(fixture.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fixture.cases).toHaveLength(24);
    expect(new Set(fixture.cases.map((row) => row.pair)).size).toBe(12);
    expect(fixture.cases.filter((row) => row.expected === "block")).toHaveLength(2);
  });

  it("prepares every frozen case through real builders without invoking the client", async () => {
    const fixture = await readAcceptance();
    const request = vi.fn(async () => prediction());
    const results = await runReplayCases(fixture.cases, { prepareOnly: true, request });
    expect(request).not.toHaveBeenCalled();
    expect(results).toHaveLength(24);
    expect(results.every((row) => row.stage === "prepared" && row.decision === null)).toBe(true);
    expect(results.every((row) => row.metadataSha256 && row.requestSha256)).toBe(true);
    expect(summarizeReplay(results).gates.allCallsSucceeded).toBe(false);
  });

  it("keeps bodies and rubric labels out of requests and exception text out of reports", async () => {
    const marker = "private-replay-body-marker";
    const row: ReplayCase = {
      id: "privacy-probe",
      family: "apex",
      pair: "privacy",
      tool: "sf_apex",
      input: { action: "anon.run", target_org: "FixtureOrg", body: marker },
      facts: { org: { type: "scratch", verified: true, explicit: true } },
      expected: "block",
      baseline: "block",
    };
    let outbound: JevRequest | undefined;
    const results = await runReplayCases([row], {
      request: async (request) => {
        outbound = request;
        throw new Error(`${marker}: remote failure contains raw body`);
      },
    });
    expect(outbound).toBeDefined();
    expect(JSON.stringify(outbound)).not.toContain(marker);
    expect(JSON.stringify(outbound)).not.toContain("privacy-probe");
    expect(JSON.stringify(outbound)).not.toContain('"baseline"');
    expect(JSON.stringify(outbound)).not.toContain('"expected"');
    expect(JSON.stringify(results)).not.toContain(marker);
    expect(results[0].failure).toBe("preparation_or_adapter_error");
    expect(results[0].decision).toBe("block");
  });

  it.each(["bash", "herdr_pane"])(
    "prepares %s with its transient command without disclosing private operands",
    async (tool) => {
      const marker = "private-replay-shell-operand";
      const row: ReplayCase = {
        id: "shell-privacy-probe",
        family: "shell",
        pair: "privacy",
        tool,
        input: {
          ...(tool === "herdr_pane" ? { action: "run" } : {}),
          command: `echo ${marker}`,
        },
        facts: {},
        expected: "allow",
      };
      let outbound: JevRequest | undefined;
      const request = vi.fn(async (value: JevRequest) => {
        outbound = value;
        return prediction();
      });
      const results = await runReplayCases([row], { request });
      expect(request).toHaveBeenCalledOnce();
      expect(results[0].stage).toBe("decided");
      expect(JSON.stringify(outbound)).not.toContain(marker);
      expect(JSON.stringify(results)).not.toContain(marker);
    },
  );

  it("retains failed calls and downgrades high-confidence allow for incomplete metadata", async () => {
    const fixture = await readAcceptance();
    const cases = fixture.cases.filter((row) =>
      ["jev-acceptance-01-safe", "jev-acceptance-07-risky", "jev-acceptance-11-safe"].includes(
        row.id,
      ),
    );
    let calls = 0;
    const results = await runReplayCases(cases, {
      request: async () => {
        calls++;
        if (calls === 1) throw new JevClientError("timeout");
        return prediction();
      },
    });
    expect(calls).toBe(3);
    expect(results[0]).toMatchObject({ stage: "failed", failure: "timeout", decision: "block" });
    expect(results[1]).toMatchObject({
      stage: "decided",
      modelChoice: "allow",
      complete: false,
      decision: "confirm",
    });
    expect(results[2]).toMatchObject({
      stage: "decided",
      modelChoice: "allow",
      complete: false,
      decision: "confirm",
    });
    expect(summarizeReplay(results)).toMatchObject({
      attempted: 3,
      failures: 1,
      decided: 2,
      unsafeAutomaticAllows: 0,
      costReportedCalls: 2,
      unnecessaryInterruptions: 1,
    });
  });

  it("refuses alternate populations and unbound historical baseline files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "jev-replay-"));
    temporaryDirectories.push(dir);
    const source = join(dir, "source.json");
    await writeFile(source, JSON.stringify({ split: "test", cases: [] }));
    await expect(readDiagnostic(source)).rejects.toThrow("unexpected-diagnostic-source");
    await expect(readBaseline(source)).rejects.toThrow("unexpected-diagnostic-baseline");
  });
});
