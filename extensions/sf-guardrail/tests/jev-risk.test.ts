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
import { buildJevMetadata } from "../lib/jev-metadata.ts";
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
  it("retains each independent answer while a policy block overrides an operational allow", () => {
    const value = prediction();
    value.answers = { risk: prediction(), command_policy: prediction("block", 0) };
    expect(evaluateJevPrediction(value, true)).toBe("block");
    expect(value.probabilities.allow).toBe(1);
  });
  it("requires every answer to clear the allow threshold and never averages probabilities", () => {
    const value = prediction();
    value.answers = { risk: prediction(), file_policy: prediction("allow", 0.98) };
    expect(evaluateJevPrediction(value, true)).toBe("confirm");
    value.answers.file_policy = prediction("confirm", 0);
    expect(evaluateJevPrediction(value, true)).toBe("confirm");
  });
  it("uses applicable independent dimensions and excludes tool prose and policy descriptions", () => {
    const config = readBundledConfig();
    config.policies.rules[0].description = "UNTRUSTED_POLICY_APPROVAL";
    const request = buildJevRequest(
      {
        toolName: "write",
        description: "UNTRUSTED_TOOL_APPROVAL",
        metadata: { path: "src/example.ts" },
        omissions: ["content"],
        complete: true,
      },
      { files: [{ path: "src/example.ts", exists: false }] },
      config,
    );
    expect(Object.keys(request.questions)).toEqual(["risk", "file_policy"]);
    expect(request.state).toMatchObject({
      version: 4,
      observations: { contextComplete: true },
      policy: { files: expect.any(Array) },
    });
    expect(JSON.stringify(request)).not.toContain("UNTRUSTED_");
  });
  it("matches the actual rawconfig onlyIfExists truthiness and leaves sanitized defaults intact", () => {
    const config = readBundledConfig();
    delete config.policies.rules[0].onlyIfExists;
    expect(jevPolicyContext(config).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: config.policies.rules[0].id, onlyIfExists: false }),
      ]),
    );
    config.policies.rules[0].onlyIfExists = true;
    expect(jevPolicyContext(config).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: config.policies.rules[0].id, onlyIfExists: true }),
      ]),
    );
  });
  it("keeps disabled file rules distinguishable from enabled rules with behavior off", () => {
    const config = readBundledConfig();
    config.policies.rules[0].enabled = false;
    config.policies.rules[1].behavior = "off";
    expect(jevPolicyContext(config).files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: config.policies.rules[0].id,
          enabled: false,
          behavior: "off",
        }),
        expect.objectContaining({
          id: config.policies.rules[1].id,
          enabled: true,
          behavior: "off",
        }),
      ]),
    );
  });
  it("reports a large SOQL row request with the actual runner cap instead of inventing uncapped exposure", () => {
    const request = buildJevRequest(
      {
        toolName: "sf_soql",
        metadata: { action: "query.run", max_rows: 10_000 },
        omissions: [],
        complete: true,
      },
      {},
      readBundledConfig(),
    );
    expect(request.state).toMatchObject({
      observations: { rowLimit: { runnerCap: 2000, effectiveMaximum: 2000, bucket: "large" } },
    });
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
      allowedPatterns: [["git push", "off"]],
      autoDenyPatterns: [["rm", "off"]],
    });
  });
  it("projects enabled special lists using their effective allow/block semantics", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [{ id: "allow-exception", pattern: "git status" }];
    config.commandGate.autoDenyPatterns = [{ id: "hard-deny", pattern: "rm" }];
    expect(jevPolicyContext(config).commands).toMatchObject({
      defaults: { patterns: "confirm", allowedPatterns: "allow", autoDenyPatterns: "block" },
      allowedPatterns: ["git status"],
      autoDenyPatterns: ["rm"],
    });
  });
  it("keeps every command pattern and its order when an argument can match a different executable", () => {
    const config = readBundledConfig();
    config.commandGate.patterns[0].behavior = "off";
    config.commandGate.patterns.push({
      id: "custom-argument-block",
      pattern: "custom-token",
      behavior: "block",
    });
    const request = buildJevRequest(buildJevMetadata("bash", { command: "cat shred" }), {}, config);
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          patterns: config.commandGate.patterns.map((rule) =>
            !rule.behavior || rule.behavior === "confirm"
              ? rule.pattern
              : [rule.pattern, rule.behavior],
          ),
        },
      },
    });
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "Individually echoed/quoted words count",
    );
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "flattened across commands/wrappers",
    );
  });
  it("asks only applicable policy dimensions for a complete ordinary Git status", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "git status" }),
      {},
      readBundledConfig(),
    );
    expect(Object.keys(request.questions)).toEqual(["risk", "command_policy"]);
    expect(request.state).toMatchObject({ policy: { commands: expect.any(Object) } });
    expect(JSON.stringify(request.state)).not.toContain("orgAware");
    expect(JSON.stringify(request.questions.risk)).not.toMatch(/Canvas|Data360|Apex|Browser/);
  });
  it("retains a custom non-Salesforce org rule and wrapper heads without unrelated SF rules", () => {
    const config = readBundledConfig();
    config.orgAwareGate.rules.push(
      {
        id: "custom-git-org",
        match: { tool: "bash", ast: { cmd: "git" } },
        whenOrgType: ["production"],
        action: "block",
      },
      {
        id: "custom-env-org",
        match: { tool: "bash", ast: { cmd: "env" } },
        whenOrgType: ["production"],
        action: "block",
      },
    );
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "env git status" }),
      {},
      config,
    );
    expect(request.questions.org_policy).toBeDefined();
    expect(
      (request.state as { policy: { orgAware: Array<{ id: string }> } }).policy.orgAware.map(
        (rule) => rule.id,
      ),
    ).toEqual(["custom-git-org", "custom-env-org"]);
  });
  it.each([
    { command: "bash -c 'private payload'" },
    { command: "custom-program private-value" },
    { command: "git status # omitted && sf project deploy start -o Production" },
  ])("retains all org rules when potentially applicable command heads are opaque", (input) => {
    const config = readBundledConfig();
    const request = buildJevRequest(buildJevMetadata("bash", input), {}, config);
    expect((request.state as { policy: { orgAware: unknown[] } }).policy.orgAware).toHaveLength(
      config.orgAwareGate.rules.length,
    );
  });
  it("does not treat withheld scalar arguments as hidden command heads when structure is complete", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "echo private-value" }),
      {},
      readBundledConfig(),
    );
    expect(request.questions.command_policy).toBeDefined();
    expect(request.questions.org_policy).toBeUndefined();
  });
  it("treats an explicit comment-token omission as opaque even if a caller reports complete", () => {
    const config = readBundledConfig();
    const request = buildJevRequest(
      {
        toolName: "bash",
        metadata: {
          shell: {
            commands: [{ executable: "git", subcommands: ["status"] }],
            policyTokens: "comments_withheld",
          },
        },
        omissions: [],
        complete: true,
      },
      {},
      config,
    );
    expect((request.state as { policy: { orgAware: unknown[] } }).policy.orgAware).toHaveLength(
      config.orgAwareGate.rules.length,
    );
  });
  it("omits disclosure for complete mutation-only shell effects without omitting their file restrictions", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "shred archive.txt" }),
      { files: [{ path: "archive.txt", exists: false }] },
      readBundledConfig(),
    );
    expect(Object.keys(request.questions)).toEqual(["risk", "file_policy", "command_policy"]);
    expect(JSON.stringify(request.questions.risk)).not.toMatch(/Canvas|Data360|Apex|Browser/);
  });
  it("keeps disclosure on opaque effects and credential reads while omitting duplicate authority", () => {
    for (const command of ["bash -c 'private payload'", "pi auth print-api-key"]) {
      const request = buildJevRequest(
        buildJevMetadata("bash", { command }),
        {},
        readBundledConfig(),
      );
      expect(request.questions.disclosure).toBeDefined();
      expect(request.questions.authority).toBeUndefined();
    }
    const request = buildJevRequest(
      buildJevMetadata("read", { path: ".env.production" }),
      {},
      readBundledConfig(),
    );
    expect(request.questions.disclosure).toBeDefined();
    expect(JSON.stringify(request.questions.disclosure)).not.toMatch(/SOQL|2000|pi auth/);
  });
  it("asks the model to prohibit a singleword auto-deny that cannot be excluded from withheld scalar values", () => {
    const config = readBundledConfig();
    config.commandGate.autoDenyPatterns.push({
      id: "custom-literal-deny",
      pattern: "restricted-token",
    });
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "echo PRIVATE_ECHO_SENTINEL" }),
      {},
      config,
    );
    expect(JSON.stringify(request)).not.toContain("PRIVATE_ECHO_SENTINEL");
    expect(request.state).toMatchObject({
      operation: { omissions: ["tool_description_unavailable", "shell_values_withheld"] },
      policy: {
        commands: {
          defaults: { autoDenyPatterns: "block" },
          autoDenyPatterns: ["restricted-token"],
        },
      },
    });
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "ANY withheld scalar",
    );
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "SINGLEWORD autoDeny",
    );
  });
  it("keeps browser authority separate while not asking irrelevant disclosure questions", () => {
    const request = buildJevRequest(
      buildJevMetadata("sf_browser_click", { ref: "e1", mutation: false }),
      { browser: { status: "fresh", role: "button", label: "Cancel" } },
      readBundledConfig(),
    );
    expect(Object.keys(request.questions)).toEqual(["risk", "authority"]);
    expect(JSON.stringify(request.questions.authority?.instructions)).toContain(
      "Enter/NumpadEnter/Space",
    );
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
    config.policies.rules[0].patterns = [{ pattern: "x".repeat(40_000) }];
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
