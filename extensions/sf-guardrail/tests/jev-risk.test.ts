/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import {
  buildJevRequest,
  evaluateJevPrediction,
  evaluateJevSafety,
  jevContextComplete,
  jevPolicyContext,
  JEV_PROTOCOL_HASH,
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
      version: 6,
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
  it.each([
    {
      toolName: "bash",
      input: {
        command:
          "curl --request POST https://example.test/resource && sf org display --target-org ScratchExample",
      },
    },
    ...[
      "kubectl delete pods --all --context ClusterExample",
      "redis-cli --host RedisExample FLUSHALL",
      "docker --context ContextExample system prune --force",
      "terraform destroy -auto-approve",
      "agent-browser reload",
      "dropdb --host DatabaseExample --if-exists",
    ].map((command) => ({
      toolName: "bash",
      input: { command: `${command} && sf org display --target-org ScratchExample` },
    })),
    ...[
      "sf plugins reset --hard",
      "sf package delete --package PackageExample --target-dev-hub DevHubExample",
      "sf package version delete --package PackageVersionExample --target-dev-hub DevHubExample",
      "sf package version promote --package PackageVersionExample --target-dev-hub DevHubExample",
      "sf package push-upgrade schedule --package PackageVersionExample --target-dev-hub DevHubExample",
      "sf package push-upgrade abort --push-request-id RequestExample --target-dev-hub DevHubExample",
      "sf package install --package PackageVersionExample --target-dev-hub DevHubExample",
      "sf org logout --all",
    ].map((command) => ({ toolName: "bash", input: { command } })),
    {
      toolName: "bash",
      input: {
        command:
          "sf api request rest /services/data/v64.0/example --method POST --target-org ScratchExample",
      },
    },
    {
      toolName: "data360_api",
      input: {
        action: "rest.request",
        dry_run: false,
        target_org: "ScratchExample",
        params: { method: "POST", path: "/services/data/v64.0/example" },
      },
    },
  ])(
    "keeps outbound/raw transports allow-once despite unrelated verified org facts",
    async (operation) => {
      expect(buildJevMetadata(operation.toolName, operation.input).complete).toBe(true);
      const request = vi.fn(async () => prediction("confirm", 0));
      const decision = await evaluateJevSafety(
        { ...call(), ...operation },
        {
          request,
          resolveFacts: async () => ({
            facts: { org: { type: "scratch", verified: true, explicit: true } },
            orgIdentity: "synthetic-scratch",
          }),
        },
      );
      expect(request).toHaveBeenCalledOnce();
      expect(decision.jev?.failure).toBeUndefined();
      expect(decision.action).toBe("confirm");
      expect(decision.approvalScope?.allowSession).toBe(false);
    },
  );
  it("binds existing public CLI flag names to their actual token IDs", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "git reset --soft" }),
      {},
      readBundledConfig(),
      { command: "git reset --soft" },
    );
    const tokens = (
      request.state as {
        operation: {
          metadata: {
            commandTokens: {
              publicSyntax: Array<{ word: string; id: number }>;
              original: Array<{ head: number; args: number[] }>;
            };
          };
        };
      }
    ).operation.metadata.commandTokens;
    expect(tokens.publicSyntax.map((item) => item.word)).toEqual(["git", "reset", "--soft"]);
    expect(tokens.publicSyntax.find((item) => item.word === "--soft")?.id).toBe(
      tokens.original[0].args[1],
    );
  });
  it("omits inactive allow and deny rows from effective command policy", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [
      { id: "disabled-allow", pattern: "git push", behavior: "off" },
    ];
    config.commandGate.autoDenyPatterns = [{ id: "disabled-deny", pattern: "rm", behavior: "off" }];
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "git status" }),
      {},
      config,
      {
        command: "git status",
      },
    );
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          allowedPatterns: [],
          autoDenyPatterns: [],
          effectWaivers: [],
        },
      },
    });
  });
  it("refuses shell request construction without its original token source", () => {
    expect(() =>
      buildJevRequest(buildJevMetadata("bash", { command: "git status" }), {}, readBundledConfig()),
    ).toThrow("missing-command-token-source");
  });
  it("projects effective runner flag observations without mistaking ignored intent for a preview", () => {
    for (const [tool, action, expectedDisclosure] of [
      ["data360_prepare", "stream.delete", false],
      ["data360_orchestrate", "cleanup.run", true],
      ["data360_orchestrate", "cleanup.plan", false],
      ["data360_orchestrate", "unregistered.plan", true],
    ] as const) {
      const metadata = buildJevMetadata(tool, { action, dry_run: true });
      const request = buildJevRequest(metadata, {}, readBundledConfig());
      expect(request.questions.disclosure !== undefined).toBe(expectedDisclosure);
      expect(JSON.stringify(request.questions.risk.instructions)).toContain(
        "ignored/unknown does not prove a preview",
      );
    }
    const publish = buildJevRequest(
      buildJevMetadata("agentscript_lifecycle", {
        action: "publish",
        dry_run: true,
        agent_file: "agent.json",
      }),
      {},
      readBundledConfig(),
    );
    expect(publish.state).toMatchObject({
      operation: { metadata: { executionFlags: { dryRun: "ignored" } } },
    });
    expect(JSON.stringify(publish.questions.risk.instructions)).toContain(
      "publish/activate/deactivate ignore it",
    );
  });
  it("uses explicit allow and block behavior for enabled special lists", () => {
    const config = readBundledConfig();
    config.commandGate.allowedPatterns = [{ id: "allow-exception", pattern: "git status" }];
    config.commandGate.autoDenyPatterns = [{ id: "hard-deny", pattern: "rm" }];
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "git status" }),
      {},
      config,
      {
        command: "git status",
      },
    );
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          allowedPatterns: [{ kind: "tokens", tokens: expect.any(Array), behavior: "allow" }],
          autoDenyPatterns: [{ kind: "tokens", tokens: expect.any(Array), behavior: "block" }],
        },
      },
    });
    expect(JSON.stringify(request.state)).not.toContain('"defaults"');
  });
  it("keeps active pattern order and separates ordinary effect waivers without executable filtering", () => {
    const config = readBundledConfig();
    config.commandGate.patterns[0].behavior = "off";
    config.commandGate.patterns.push({
      id: "custom-argument-block",
      pattern: "custom-token",
      behavior: "block",
    });
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "cat shred" }),
      {},
      config,
      { command: "cat shred" },
    );
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          patterns: expect.any(Array),
        },
      },
    });
    const rows = (
      request.state as { policy: { commands: { patterns: Array<{ behavior: string }> } } }
    ).policy.commands.patterns;
    expect(rows).toHaveLength(config.commandGate.patterns.length - 1);
    expect(rows.every((row) => row.behavior !== "off")).toBe(true);
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          effectWaivers: [
            {
              kind: "find_delete",
              behavior: "off",
              head: expect.any(Number),
              arg: expect.any(Number),
            },
          ],
        },
      },
    });
    expect(rows.at(-1)?.behavior).toBe("block");
    expect(JSON.stringify(request.state)).toContain("quoted-token boundaries");
    expect(JSON.stringify(request.state)).toContain("command/wrapper expansion order");
  });
  it("shares exact matching grammar with independently evaluated waiver questions", () => {
    const command = "sf org auth show-access-token --target-org ScratchExample";
    const request = buildJevRequest(
      buildJevMetadata("bash", { command }),
      { org: { type: "scratch", verified: true, explicit: true } },
      readBundledConfig(),
      { command },
    );
    expect(Object.keys(request.questions)).toEqual([
      "risk",
      "command_policy",
      "org_policy",
      "disclosure",
    ]);
    expect(request.state).toMatchObject({
      policy: {
        commands: {
          matchGrammar: {
            encoding: expect.stringContaining("separate namespaces"),
            tokens: expect.stringContaining("consecutive equal IDs"),
            pi_credential_output: expect.stringContaining("piArgs"),
          },
        },
      },
    });
    for (const id of ["risk", "command_policy", "org_policy", "disclosure"])
      expect(JSON.stringify(request.questions[id].instructions)).toContain(
        "policy.commands.matchGrammar",
      );
  });
  it("asks only applicable policy dimensions for a complete ordinary Git status", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "git status" }),
      {},
      readBundledConfig(),
      { command: "git status" },
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
      { command: "env git status" },
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
    const request = buildJevRequest(buildJevMetadata("bash", input), {}, config, input);
    expect((request.state as { policy: { orgAware: unknown[] } }).policy.orgAware).toHaveLength(
      config.orgAwareGate.rules.length,
    );
  });
  it("does not treat withheld scalar arguments as hidden command heads when structure is complete", () => {
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "echo private-value" }),
      {},
      readBundledConfig(),
      { command: "echo private-value" },
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
      { command: "git status # omitted && sf project deploy start -o Production" },
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
      { command: "shred archive.txt" },
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
        { command },
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
  it("sends private operands and custom deny words as opaque equality IDs", () => {
    const config = readBundledConfig();
    config.commandGate.autoDenyPatterns.push({
      id: "custom-literal-deny",
      pattern: "restricted-token",
    });
    const request = buildJevRequest(
      buildJevMetadata("bash", { command: "echo PRIVATE_ECHO_SENTINEL" }),
      {},
      config,
      { command: "echo PRIVATE_ECHO_SENTINEL" },
    );
    expect(JSON.stringify(request)).not.toContain("PRIVATE_ECHO_SENTINEL");
    expect(request.state).toMatchObject({
      operation: { omissions: ["tool_description_unavailable", "shell_values_withheld"] },
      policy: {
        commands: {
          autoDenyPatterns: expect.arrayContaining([
            {
              kind: "tokens",
              tokens: expect.any(Array),
              behavior: "block",
              publicNames: { tokens: [null] },
            },
          ]),
        },
      },
    });
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "Private values and comments are present as opaque token IDs",
    );
    expect(JSON.stringify(request.questions.command_policy?.instructions)).toContain(
      "Do not invent a match",
    );
    expect(JSON.stringify(request)).not.toContain("restricted-token");
  });
  it("uses operation names for whole-token labels and keeps off waivers and private IDs", () => {
    const config = readBundledConfig();
    config.commandGate.patterns = [
      { id: "private-policy", pattern: "git status PRIVATE_POLICY_WORD", behavior: "confirm" },
      { id: "effect-only", pattern: "git status", behavior: "off" },
    ];
    config.commandGate.allowedPatterns = [];
    config.commandGate.autoDenyPatterns = [];
    const command = "git status --short PRIVATE_ARG";
    const metadata = buildJevMetadata("bash", { command });
    const before = JSON.stringify({ config, metadata });
    const request = buildJevRequest(metadata, {}, config, { command });
    expect(request.state).toMatchObject({
      operation: {
        metadata: {
          commandTokens: {
            publicSyntax: [
              { id: expect.any(Number), word: "git" },
              { id: expect.any(Number), word: "status" },
              { id: expect.any(Number), word: "--short" },
            ],
          },
        },
      },
      policy: {
        commands: {
          patterns: [
            {
              behavior: "confirm",
              tokens: expect.any(Array),
              publicNames: { tokens: ["git", "status", null] },
            },
          ],
          effectWaivers: [
            {
              behavior: "off",
              tokens: expect.any(Array),
              publicNames: { tokens: ["git", "status"] },
            },
          ],
        },
      },
    });
    const wire = JSON.stringify(request);
    expect(wire).not.toContain("PRIVATE_POLICY_WORD");
    expect(wire).not.toContain("PRIVATE_ARG");
    expect(JSON.stringify({ config, metadata })).toBe(before);
  });
  it("keeps equals and dot prefixes separate from whole-token labels", () => {
    const config = readBundledConfig();
    config.commandGate.patterns = [
      { id: "output", pattern: "dd of=", behavior: "confirm" },
      { id: "format", pattern: "mkfs.*", behavior: "block" },
    ];
    config.commandGate.allowedPatterns = [];
    config.commandGate.autoDenyPatterns = [];
    const command = "dd of=PRIVATE_TARGET";
    const request = buildJevRequest(buildJevMetadata("bash", { command }), {}, config, { command });
    const rows = (
      request.state as { policy: { commands: { patterns: Record<string, unknown>[] } } }
    ).policy.commands.patterns;
    expect(rows).toMatchObject([
      { equalsPrefix: expect.any(Number), publicNames: { head: "dd" } },
      { dotPrefix: expect.any(Number), publicNames: { exact: null } },
    ]);
    for (const row of rows) {
      expect(Object.hasOwn(row.publicNames as object, "equalsPrefix")).toBe(false);
      expect(Object.hasOwn(row.publicNames as object, "dotPrefix")).toBe(false);
    }
    const state = request.state as {
      operation: { metadata: { commandTokens: unknown } };
      policy: { commands: unknown };
    };
    expect(JSON.stringify(state.operation.metadata.commandTokens)).not.toContain("PRIVATE_TARGET");
    expect(JSON.stringify(state.policy.commands)).not.toContain("PRIVATE_TARGET");
  });
  // These hashes record the prior native question bytes.
  it.each([
    ["sf_apex", "7101702f8502bcb31b19bb50e52a6b67f99b0b29e72205b97d378c4dc3e9d6fe"],
    ["sf_soql", "70ad9ea61cdd06a7cf6deb65c177de3f0549fa867708b290e1c6437bf7b3708c"],
    ["agentscript_lifecycle", "c5f7084da7a2906893801b49438bc5b4ffca28c66484d6238a6e6274647d3cfc"],
    ["data360_prepare", "12a2ab8081d05421bcd509c8aabf3abda204395b8bb4f412448f5af550782ae7"],
    ["slack_canvas", "ab48204c6ad9de54233d9fc78e76d642487d2d101e1527f48bd5c2b85844e0d9"],
    ["sf_browser_press", "dc79f9ea16888014244b015ab53434a5c58e4d45413e0ad3d1a6aaf8b73b819e"],
  ])("keeps the prior native risk question for %s", (toolName, expectedHash) => {
    const request = buildJevRequest(
      { toolName, metadata: {}, omissions: [], complete: true },
      {},
      readBundledConfig(),
    );
    expect(createHash("sha256").update(JSON.stringify(request.questions.risk)).digest("hex")).toBe(
      expectedHash,
    );
  });
  it.each([
    ["sf_soql", "disclosure", "2fcee0f715ae1ddddddc69913969b27250495101cc9d8ed229e5930d01cb026c"],
    [
      "data360_prepare",
      "disclosure",
      "5eb4e1d5c765831037da1c878eea5fd58709c1a62eaede165b2599ac35f79774",
    ],
    [
      "sf_browser_press",
      "authority",
      "eb4014bca1154165eb86084c8fc0c4923f1c8847621cc30b62c990f833942fe8",
    ],
  ] as const)("keeps the prior %s %s question", (toolName, question, expectedHash) => {
    const request = buildJevRequest(
      { toolName, metadata: {}, omissions: [], complete: true },
      {},
      readBundledConfig(),
    );
    expect(
      createHash("sha256").update(JSON.stringify(request.questions[question])).digest("hex"),
    ).toBe(expectedHash);
  });
  it("uses the unknown domain for a tool name that is an object prototype key", () => {
    const request = buildJevRequest(
      { toolName: "constructor", metadata: {}, omissions: [], complete: false },
      {},
      readBundledConfig(),
    );
    expect(JSON.stringify(request.questions.risk.instructions)).toContain("Unfamiliar/opaque");
  });
  it("applies the full request bound after it adds public names", () => {
    const config = readBundledConfig();
    config.commandGate.patterns = Array.from({ length: 100 }, (_, index) => ({
      id: `repeated-${index}`,
      pattern: Array(20).fill("git status").join(" "),
      behavior: "confirm" as const,
    }));
    config.commandGate.allowedPatterns = [];
    config.commandGate.autoDenyPatterns = [];
    const command = "git status";
    expect(() =>
      buildJevRequest(buildJevMetadata("bash", { command }), {}, config, { command }),
    ).toThrow("request-too-large");
  });
  it("changes the grant key for the new contract and keeps local authoring session approval", async () => {
    const input = call();
    const decision = await evaluateJevSafety(input, {
      descriptor,
      request: async () => prediction("confirm", 0),
      resolveFacts: async () => ({
        facts: { org: { type: "sandbox" as const, verified: true, explicit: true } },
        orgIdentity: "synthetic-org",
      }),
    });
    const priorProtocol = "fe49ed0f497a0ef2820225d9006647c8c17c3dde2561dcfb99580c5976c73a6d";
    expect(JEV_PROTOCOL_HASH).not.toBe(priorProtocol);
    expect(decision.jev?.protocolHash).toBe(JEV_PROTOCOL_HASH);
    expect(decision.approvalScope?.allowSession).toBe(true);
    const priorFingerprint = jevHash({
      toolName: input.toolName,
      originalHash: decision.jev?.inputHash,
      descriptorHash: decision.jev?.descriptorHash,
      cwd: input.cwd,
      sessionId: null,
      factsHash: decision.jev?.factsHash,
      policyHash: decision.jev?.policyHash,
      protocolHash: priorProtocol,
      engine: "jev",
      model: JEV_RESOLVED_MODEL,
    });
    expect(decision.fingerprint).not.toBe(priorFingerprint);
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
