/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import {
  buildJevRequest,
  evaluateJevPrediction,
  evaluateJevSafety,
  jevContextComplete,
  jevPolicyContext,
} from "../lib/jev-risk.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { JEV_RESOLVED_MODEL, JEV_PROVIDER, JevClientError } from "../lib/jev-client.ts";
import type { JevPrediction, JevToolMetadata } from "../lib/types.ts";

const prediction = (choice: JevPrediction["choice"] = "allow", allow = 1): JevPrediction => ({
  choice,
  probabilities: {
    allow,
    confirm: choice === "confirm" ? 1 - allow : 0,
    block: choice === "block" ? 1 - allow : 0,
  },
  confidence: 1,
  model: JEV_RESOLVED_MODEL,
  provider: JEV_PROVIDER,
  requestId: "synthetic-request",
  usage: { input_tokens: 20, output_tokens: 30, cost: 0.00001 },
});
const descriptor = {
  description: "Write a project file",
  parameters: {
    type: "object",
    properties: { path: { type: "string" }, content: { type: "string" } },
  },
};
const call = (content = "SENTINEL_PRIVATE_BODY") => ({
  toolName: "write",
  input: { path: "src/example.ts", content },
  cwd: "/synthetic/project",
  config: readBundledConfig(),
});
const facts = vi.fn(async () => ({
  facts: { files: [{ path: "src/example.ts", exists: false }] },
}));

describe("Jev risk adapter", () => {
  it("sends only metadata and effective policy, while retaining hosted provenance", async () => {
    const request = vi.fn(async () => prediction());
    const decision = await evaluateJevSafety(call(), { descriptor, request, resolveFacts: facts });
    expect(decision.action).toBe("allow");
    expect(decision.feature).toBe("jevGate");
    expect(decision.jev?.model).toBe(JEV_RESOLVED_MODEL);
    expect(decision.jev?.cost).toBe(0.00001);
    expect(decision.jev?.inputHash).toBe(jevHash(call().input));
    const serialized = JSON.stringify(request.mock.calls);
    expect(serialized).not.toContain("SENTINEL_PRIVATE_BODY");
    expect(serialized).not.toContain("/synthetic/project");
    expect(serialized).toContain('"block"');
    expect(decision.approvalScope?.allowSession).toBe(false);
  });
  it.each([
    [prediction("allow", 1), true, "allow"],
    [prediction("allow", 0.99), true, "allow"],
    [prediction("allow", 0.989), true, "confirm"],
    [prediction("allow", 1), false, "confirm"],
    [prediction("confirm", 0), true, "confirm"],
    [prediction("block", 0), false, "block"],
  ] as const)("maps probabilities and completeness conservatively", (value, complete, expected) => {
    expect(evaluateJevPrediction(value, complete)).toBe(expected);
  });
  it("changed omitted bodies, policy, model context, cwd, and descriptors change grant keys", async () => {
    const request = async () => prediction("confirm", 0);
    const resolveFacts = async () => ({
      facts: { org: { type: "sandbox" as const, verified: true, explicit: true } },
      orgIdentity: "synthetic-org",
    });
    const first = await evaluateJevSafety(call("one"), { descriptor, request, resolveFacts });
    const second = await evaluateJevSafety(call("two"), { descriptor, request, resolveFacts });
    const policy = call("one");
    policy.config.policies.rules[0].behavior = "block";
    const third = await evaluateJevSafety(policy, { descriptor, request, resolveFacts });
    const fourth = await evaluateJevSafety(
      { ...call("one"), cwd: "/other" },
      { descriptor, request, resolveFacts },
    );
    const fifth = await evaluateJevSafety(call("one"), {
      descriptor: { ...descriptor, description: "Changed semantics" },
      request,
      resolveFacts,
    });
    const sixth = await evaluateJevSafety(
      { ...call("one"), sessionId: "another-session" },
      { descriptor, request, resolveFacts },
    );
    expect(first.approvalScope?.allowSession).toBe(true);
    expect(
      new Set([first, second, third, fourth, fifth, sixth].map((value) => value.fingerprint)).size,
    ).toBe(6);
  });
  it("preserves disabled special command entries in the policy sent to Jev", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [
      { id: "disabled-allow", pattern: "git push", behavior: "off" },
    ];
    config.commandGate.autoDenyPatterns = [{ id: "disabled-deny", pattern: "rm", behavior: "off" }];
    const policy = jevPolicyContext(config);
    expect(policy.commands).toMatchObject({
      allowedPatterns: [{ id: "disabled-allow", behavior: "off" }],
      autoDenyPatterns: [{ id: "disabled-deny", behavior: "off" }],
    });
  });
  it("projects enabled special lists using their effective allow/block semantics", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [{ id: "allow-exception", pattern: "git status" }];
    config.commandGate.autoDenyPatterns = [{ id: "hard-deny", pattern: "rm" }];
    expect(jevPolicyContext(config).commands).toMatchObject({
      allowedPatterns: [{ id: "allow-exception", behavior: "allow" }],
      autoDenyPatterns: [{ id: "hard-deny", behavior: "block" }],
    });
  });
  it.each(["production", "unknown"] as const)(
    "does not grant session approval to %s targets",
    async (type) => {
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        request: async () => prediction("confirm", 0),
        resolveFacts: async () => ({
          facts: { org: { type, verified: type !== "unknown", explicit: true } },
          orgIdentity: "synthetic-org",
        }),
      });
      expect(decision.approvalScope?.allowSession).toBe(false);
    },
  );
  it("keeps failures blocked without any old-engine fallback or raw error details", async () => {
    const decision = await evaluateJevSafety(call(), {
      descriptor,
      resolveFacts: facts,
      request: async () => {
        throw new JevClientError("invalid_response");
      },
    });
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("invalid_response");
    expect(JSON.stringify(decision)).not.toContain("SENTINEL_PRIVATE_BODY");
  });
  it("shows the sanitized REST method and resource in an exact-call approval", async () => {
    const decision = await evaluateJevSafety(
      {
        ...call(),
        toolName: "data360_api",
        input: { action: "request", params: { method: "DELETE", path: "/fixture/resources/item" } },
      },
      {
        descriptor: { description: "Request a Data 360 resource" },
        request: async () => prediction("confirm", 0),
        resolveFacts: async () => ({ facts: {} }),
      },
    );
    expect(decision.approvalScope?.detail).toContain("DELETE");
    expect(decision.approvalScope?.detail).toContain("/fixture/resources/item");
  });
  it("cancels a provider that ignores abort and blocks its late reply", async () => {
    const controller = new AbortController();
    let resolvePrediction!: (result: JevPrediction) => void;
    const request = vi.fn(
      () =>
        new Promise<JevPrediction>((resolve) => {
          resolvePrediction = resolve;
        }),
    );
    const pending = evaluateJevSafety(call(), {
      descriptor,
      resolveFacts: facts,
      request,
      signal: controller.signal,
    });
    await vi.waitFor(() => expect(request).toHaveBeenCalled());
    controller.abort();
    const decision = await pending;
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("cancelled");
    resolvePrediction(prediction());
    expect(decision.action).toBe("block");
  });
  it("bounds the full fact+provider path", async () => {
    vi.useFakeTimers();
    try {
      // Node AbortSignal.timeout uses its own clock; use external cancellation to exercise the same path.
      const controller = new AbortController();
      const request = vi.fn();
      const pending = evaluateJevSafety(call(), {
        descriptor,
        signal: controller.signal,
        request,
        resolveFacts: () => new Promise(() => {}),
      });
      controller.abort();
      const result = await pending;
      expect(result.action).toBe("block");
      expect(request).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
  it("unknown tools still receive a classification request but cannot auto-allow opaque effects", async () => {
    const request = vi.fn(async () => prediction());
    const result = await evaluateJevSafety(
      {
        ...call(),
        toolName: "custom_remote",
        input: { action: "execute", body: "PRIVATE_UNKNOWN_BODY" },
      },
      {
        descriptor: { description: "Custom action" },
        request,
        resolveFacts: async () => ({ facts: {} }),
      },
    );
    expect(request).toHaveBeenCalledOnce();
    expect(result.action).toBe("confirm");
    expect(JSON.stringify(request.mock.calls)).not.toContain("PRIVATE_UNKNOWN_BODY");
  });
  it("unknown existence, unverified orgs and stale browser facts prevent automatic execution", () => {
    const metadata: JevToolMetadata = {
      toolName: "read",
      metadata: {},
      omissions: [],
      complete: true,
    };
    expect(jevContextComplete(metadata, { files: [{ path: "x", exists: "unknown" }] })).toBe(false);
    expect(
      jevContextComplete(metadata, { org: { type: "sandbox", verified: false, explicit: true } }),
    ).toBe(false);
    expect(jevContextComplete(metadata, { browser: { status: "stale" } })).toBe(false);
  });
  it("withholds alias identities from policy context and rejects oversized requests", () => {
    const config = readBundledConfig();
    config.productionAliases = ["PRIVATE_ORG_ALIAS"];
    const metadata: JevToolMetadata = {
      toolName: "read",
      metadata: { path: "source.ts" },
      omissions: [],
      complete: true,
    };
    expect(JSON.stringify(buildJevRequest(metadata, {}, config))).not.toContain(
      "PRIVATE_ORG_ALIAS",
    );
    config.policies.rules[0].description = "x".repeat(40_000);
    expect(() => buildJevRequest(metadata, {}, config)).toThrow();
  });
  it("hashes key order consistently and rejects serializers, cycles, and excessive inputs", () => {
    expect(jevHash({ a: 1, b: 2 })).toBe(jevHash({ b: 2, a: 1 }));
    expect(() => jevHash({ toJSON: () => "hidden" })).toThrow();
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    expect(() => jevHash(cycle)).toThrow();
    expect(() => jevHash("x".repeat(4 * 1024 * 1024))).toThrow();
  });
});
