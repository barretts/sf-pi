/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { performance as nodePerformance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import {
  buildJevRequest,
  evaluateJevPrediction,
  evaluateJevSafety,
  jevContextComplete,
  jevDecisionTransportBindingHash,
  jevFactBindingHash,
  jevPolicyContext,
  jevRuntimeProtocolHash,
  JEV_PROTOCOL_HASH,
} from "../lib/jev-risk.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import {
  createJevProcessTransport,
  JEV_RESOLVED_MODEL,
  JEV_PROVIDER,
  JevClientError,
  JevStageClientError,
} from "../lib/jev-client.ts";
import { jevOperatingPointHash, resolveJevOperatingPoint } from "../lib/jev-operating-point.ts";
import type {
  GuardrailConfig,
  JevAllHeadStageResult,
  JevChoiceAnswer,
  JevCommandPolicyStageResult,
  JevNonCommandStageResult,
  JevPrediction,
  JevRequest,
  JevResolvedFacts,
  JevStageFailureEvidence,
  JevSyntaxStageResult,
  JevToolMetadata,
} from "../lib/types.ts";

const ENDPOINT = "https://decisions.example.test/v1/decisions";
const OTHER_ENDPOINT = "https://other-decisions.example.test/v1/decisions";

describe("Jev interpretation criteria", () => {
  const fileRequest = (path: string, exists: boolean | "unknown", extra = false) => {
    const config = readBundledConfig();
    if (extra)
      config.policies.rules.push({
        id: "independent-path-block",
        enabled: true,
        protection: "noAccess",
        behavior: "block",
        patterns: [{ pattern: path }],
        onlyIfExists: false,
      });
    return buildJevRequest(
      buildJevMetadata("write", { path, content: "Private authored data." }),
      {
        files: [
          {
            path,
            absolutePath: `/private-work/${path}`,
            relativePath: path,
            basename: path.split("/").at(-1),
            exists,
            kind: exists === false ? "unknown" : "file",
          },
        ],
      },
      config,
    );
  };
  it("keeps creation, existing-file and unknown existence facts without assigning a host outcome", () => {
    for (const exists of [false, true, "unknown"] as const) {
      const request = fileRequest(".env", exists);
      const facts = (request.state as any).facts;
      expect(facts.files[0].exists).toBe(exists);
      expect(
        (request.state as any).policy.files.find((row: any) => row.id === "secret-files")
          .onlyIfExists,
      ).toBe(true);
      expect(JSON.stringify(request.questions.risk.instructions)).toContain(
        "Creation with exists=false is still authoring.",
      );
      expect(JSON.stringify(request.questions.risk.instructions)).toContain(
        "genuinely unknown or additional executable effects",
      );
      expect(JSON.stringify(request)).not.toContain("Private authored data.");
      expect(JSON.stringify(request)).not.toMatch(
        /"(?:winner|riskAction|fileMatch|knownOrdinarySensitivity)":/,
      );
    }
  });
  it("retains a same-row CLI-state exemption and an independent block in source order", () => {
    const request = fileRequest(".sfdx/agents/sample/session.json", true, true);
    const rows = (request.state as any).policy.files;
    expect(rows.find((row: any) => row.id === "sf-cli-state").allowedPatterns).toEqual([
      { pattern: ".sfdx/agents/**" },
    ]);
    expect(rows.at(-1).id).toBe("independent-path-block");
    expect(rows.at(-1).behavior).toBe("block");
    expect(rows.at(-1).restrictedAccess).toEqual(["read", "write", "shell"]);
    expect(JSON.stringify(request.questions.file_policy.instructions)).toContain(
      "Continue every other row and every other path",
    );
    expect(JSON.stringify(request.questions.file_policy.instructions)).toContain(
      "that row's allowedPatterns",
    );
  });
  it("keeps Pi credential flags and print actions separate from the status disclosure instruction", () => {
    for (const command of [
      "pi auth check",
      "pi auth check --credentials",
      "pi auth print-api-key",
    ]) {
      const request = buildJevRequest(
        buildJevMetadata("bash", { command }),
        {},
        readBundledConfig(),
        { command },
      );
      expect(JSON.stringify(request.questions.disclosure.instructions)).toContain(
        "does not assert read-only execution",
      );
      expect(JSON.stringify(request.questions.disclosure.instructions)).toContain(
        "With --credentials",
      );
      const shell = JSON.stringify((request.state as any).operation.metadata.shell);
      expect(shell.includes('"--credentials"')).toBe(command.includes("--credentials"));
      expect((request.state as any).policy.commands.matchGrammar.pi_credential_output).toContain(
        "row.credentials",
      );
      expect(JSON.stringify(request)).not.toMatch(
        /"(?:isStatusDisclosure|credentialOutputMatch|winner)":/,
      );
    }
  });
  it("retains later custom org restrictions and makes the default exclusion local", () => {
    const config = readBundledConfig();
    config.orgAwareGate.rules.push({
      id: "independent-custom-deploy",
      enabled: true,
      behavior: "block",
      action: "block",
      match: { tool: "bash", ast: { cmd: "sf", subCmd: ["project", "deploy", "start"] } },
      whenOrgType: ["production"],
    });
    const command = "sf project deploy start --dry-run --target-org SampleProd";
    const request = buildJevRequest(
      buildJevMetadata("bash", { command }),
      {
        org: { type: "production", verified: true, explicit: true },
      },
      config,
      { command },
    );
    const rows = (request.state as any).policy.orgAware;
    expect(rows.find((row: any) => row.id === "sf-deploy-prod")).toBeDefined();
    expect(rows.at(-1).id).toBe("independent-custom-deploy");
    expect(rows.at(-1).behavior).toBe("block");
    expect(JSON.stringify(request.questions.org_policy.instructions)).toContain(
      "then continue later rows for the same command",
    );
    expect(JSON.stringify(request.questions.org_policy.instructions)).toContain(
      "Other rows get no rehearsal exemption",
    );
    expect((request.state as any).facts.org).toEqual({
      type: "production",
      verified: true,
      explicit: true,
    });
    expect(JSON.stringify(request)).not.toContain("SampleProd");
  });
  it("preserves the unresolved SOQL source sensitivity rule", () => {
    const request = buildJevRequest(
      buildJevMetadata("sf_soql", { action: "query.run", query: "SELECT Id FROM Sample LIMIT 10" }),
      {},
      readBundledConfig(),
    );
    expect(JSON.stringify(request.questions.disclosure.instructions)).toContain(
      "Source sensitivity remains unknown.",
    );
    expect(JSON.stringify(request.questions.disclosure.instructions)).toContain(
      "Source/API/schema access remains unobserved.",
    );
    expect(JSON.stringify(request.questions.disclosure.instructions)).toContain(
      "possibly sensitive IDs",
    );
    expect(JSON.stringify(request)).not.toContain("SELECT Id FROM Sample");
  });
});

beforeEach(() => {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

const prediction = (choice: JevPrediction["choice"] = "allow", allow = 1): JevPrediction => ({
  choice,
  probabilities: {
    allow,
    confirm: choice === "block" ? 0 : 1 - allow,
    block: choice === "block" ? 1 - allow : 0,
  },
  confidence: 1,
  model: JEV_RESOLVED_MODEL,
  provider: JEV_PROVIDER,
  requestId: "synthetic-request",
  usage: { input_tokens: 20, output_tokens: 30, cost: 0.00001 },
});
type TestPredictionRequest = (
  request: JevRequest,
  options: { endpoint?: string; signal?: AbortSignal },
) => Promise<JevPrediction>;
const answer = (value: JevChoiceAnswer): JevChoiceAnswer => ({
  choice: value.choice,
  probabilities: structuredClone(value.probabilities),
  confidence: value.confidence,
});
function testTransport(
  request: TestPredictionRequest,
  mutate?: (reply: JevAllHeadStageResult) => void,
) {
  return vi.fn<typeof createJevProcessTransport>((options) => {
    const point = resolveJevOperatingPoint(
      options.binding?.operatingPointHash ===
        jevOperatingPointHash(resolveJevOperatingPoint("argmax"))
        ? "argmax"
        : "conservative",
    );
    const transportHash = jevDecisionTransportBindingHash(options.endpoint, point);
    let controlled: JevPrediction;
    const receipt = (
      stage: string,
      wire: { questions: unknown },
      answers: Record<string, unknown>,
    ) => {
      const body = JSON.stringify(wire);
      const requestId =
        stage === "all_heads" ? controlled.requestId : `${controlled.requestId}-${stage}`;
      const raw = JSON.stringify({
        id: requestId,
        model: controlled.model,
        provider: controlled.provider,
        answers: Object.fromEntries(
          Object.entries(answers).map(([id, value]) => [
            id,
            { type: "choice", ...(value as object) },
          ]),
        ),
        usage: controlled.usage,
      });
      return {
        stage,
        answers,
        evidence: {
          requestedQuestionIds: Object.keys(wire.questions),
          requestHash: createHash("sha256").update(body).digest("hex"),
          responseHash: createHash("sha256").update(raw).digest("hex"),
          transportHash,
          requestBytes: Buffer.byteLength(body),
          responseBytes: Buffer.byteLength(raw),
          model: controlled.model,
          provider: controlled.provider,
          requestId,
          usage: structuredClone(controlled.usage),
          latencyMs: 1,
        },
      };
    };
    const firstAnswers = async (wire: JevRequest) => {
      controlled = await request(wire, { endpoint: options.endpoint, signal: options.signal });
      return Object.fromEntries(
        Object.keys(wire.questions).map((id) => [
          id,
          answer(controlled.answers?.[id] ?? controlled),
        ]),
      );
    };
    return {
      requestAllHeads: vi.fn(async (wire) => {
        const reply = receipt("all_heads", wire, await firstAnswers(wire)) as JevAllHeadStageResult;
        mutate?.(reply);
        return reply;
      }),
      requestNonCommand: vi.fn(
        async (wire) =>
          receipt("non_command", wire, await firstAnswers(wire)) as JevNonCommandStageResult,
      ),
      requestSyntax: vi.fn(
        async (wire) =>
          receipt(
            "syntax",
            wire,
            Object.fromEntries(
              Object.keys(wire.questions).map((id) => [
                id,
                { choice: "no_match", probabilities: { match: 0, no_match: 1 }, confidence: 1 },
              ]),
            ),
          ) as JevSyntaxStageResult,
      ),
      // These are controlled test choices. The runtime receives actual separate stage answers.
      requestCommandPolicy: vi.fn(
        async (wire) =>
          receipt("command_policy", wire, {
            command_policy: answer(controlled.answers?.command_policy ?? controlled),
          }) as JevCommandPolicyStageResult,
      ),
      close: vi.fn(),
    };
  });
}
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
function bashCall(patterns: GuardrailConfig["commandGate"]["patterns"] = []) {
  const config: GuardrailConfig = {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "UNIT_TEST_APPROVAL",
    confirmTimeoutMs: 5000,
    policies: { rules: [] },
    orgAwareGate: { rules: [] },
    commandGate: { allowedPatterns: [], autoDenyPatterns: [], patterns },
  };
  return { toolName: "bash", input: { command: "git status" }, cwd: "/synthetic/project", config };
}

describe("SOQL runner facts", () => {
  const privateQuery = "SELECT PrivateField__c FROM PrivateObject__c LIMIT 25";

  it.each(
    ["data query", "force:data:soql:query"].flatMap((operation) =>
      ["--all-rows", "--use-tooling-api", "--usetoolingapi", "-t"].map((flag) => ({
        operation,
        flag,
      })),
    ),
  )("retains the installed query flag $flag on $operation", ({ operation, flag }) => {
    const metadata = buildJevMetadata("bash", {
      command: `sf ${operation} --query '${privateQuery}' ${flag}`,
    });
    expect(metadata.metadata.shell).toMatchObject({
      commands: [{ flags: [{ name: "--query" }, { name: flag }] }],
    });
    expect(metadata.complete).toBe(false);
    expect(metadata.omissions).toContain("shell_effects_opaque");
    expect(JSON.stringify(metadata)).not.toContain("PrivateField__c");
    expect(JSON.stringify(metadata)).not.toContain("PrivateObject__c");
  });

  it.each(
    ["data query", "force:data:soql:query"].flatMap((operation) =>
      ["--include-deleted", "--tooling-api"].map((flag) => ({ operation, flag })),
    ),
  )("keeps the unsupported query flag $flag unknown on $operation", ({ operation, flag }) => {
    const metadata = buildJevMetadata("bash", {
      command: `sf ${operation} --query '${privateQuery}' ${flag}`,
    });
    expect(metadata.metadata.shell).toMatchObject({
      commands: [{ flags: [{ name: "--query" }, { name: "unknown" }] }],
    });
    expect(metadata.complete).toBe(false);
  });

  it("does not derive a query.run cap from its ignored limit argument", () => {
    const metadata = buildJevMetadata("sf_soql", {
      action: "query.run",
      query: privateQuery,
      limit: 10_000,
    });
    const request = buildJevRequest(metadata, {}, readBundledConfig());
    expect(request.state).toMatchObject({
      operation: { metadata: { limit: 10_000 }, complete: false },
      observations: { contextComplete: false },
    });
    expect(
      (request.state as { observations: Record<string, unknown> }).observations,
    ).not.toHaveProperty("rowLimit");
  });

  it.each(
    ["query.run", "query.sample", "query.queryAll"].flatMap((action) =>
      [
        { max_rows: 0, effectiveMaximum: 1, bucket: "bounded" },
        { max_rows: -0.5, effectiveMaximum: 1, bucket: "bounded" },
        { max_rows: 26.9, effectiveMaximum: 26, bucket: "bounded" },
        { max_rows: 10_000, effectiveMaximum: 2000, bucket: "large" },
      ].map((values) => ({ action, ...values })),
    ),
  )(
    "observes $action max_rows=$max_rows with the runner clamp",
    ({ action, max_rows, effectiveMaximum, bucket }) => {
      const metadata = buildJevMetadata("sf_soql", {
        action,
        query: privateQuery,
        max_rows,
        limit: 9999,
      });
      const request = buildJevRequest(metadata, {}, readBundledConfig());
      expect(request.state).toMatchObject({
        observations: { rowLimit: { runnerCap: 2000, effectiveMaximum, bucket } },
      });
      expect(metadata.complete).toBe(false);
      expect(metadata.omissions).toContain("payload_withheld");
      expect(jevContextComplete(metadata, {})).toBe(false);
      expect(evaluateJevPrediction(prediction(), jevContextComplete(metadata, {}))).toBe("confirm");
      expect(JSON.stringify(request)).not.toContain("PrivateField__c");
      expect(JSON.stringify(request)).not.toContain("PrivateObject__c");
    },
  );

  it.each(
    ["query.sample", "query.queryAll"].flatMap((action) =>
      [
        { limit: 0, effectiveMaximum: 1, bucket: "bounded" },
        { limit: -0.5, effectiveMaximum: 1, bucket: "bounded" },
        { limit: 26.9, effectiveMaximum: 26, bucket: "bounded" },
        { limit: 10_000, effectiveMaximum: 2000, bucket: "large" },
      ].map((values) => ({ action, ...values })),
    ),
  )("observes the honored $action limit=$limit", ({ action, limit, effectiveMaximum, bucket }) => {
    const metadata = buildJevMetadata("sf_soql", { action, query: privateQuery, limit });
    expect(buildJevRequest(metadata, {}, readBundledConfig()).state).toMatchObject({
      observations: { rowLimit: { runnerCap: 2000, effectiveMaximum, bucket } },
    });
    expect(metadata.complete).toBe(false);
  });
});

describe("supplied path kind facts", () => {
  it.each(["file", "directory", "other", "unknown", undefined] as const)(
    "preserves observed kind %s and current completeness without suffix inference",
    (kind) => {
      const metadata = buildJevMetadata("grep", {
        path: "selected.txt",
        pattern: "synthetic-private-selector",
      });
      const file = { path: "selected.txt", exists: true, ...(kind ? { kind } : {}) };
      const request = buildJevRequest(metadata, { files: [file] }, readBundledConfig());
      expect(request.state).toMatchObject({
        version: 6,
        facts: { files: [file] },
        observations: { contextComplete: true },
      });
      if (!kind)
        expect(
          (request.state as { facts: { files: unknown[] } }).facts.files[0],
        ).not.toHaveProperty("kind");
      for (const question of [
        request.questions.risk,
        request.questions.file_policy,
        request.questions.disclosure,
      ]) {
        const instructions = JSON.stringify(question?.instructions);
        expect(instructions).toContain("Absent kind and lookup failure mean unknown.");
        expect(instructions).toContain("Only the supplied path is observed.");
        expect(instructions).toContain(
          "Descendants, body contents, and sensitivity are not observed.",
        );
        expect(instructions).toContain("Do not infer kind from a suffix.");
      }
      expect(JSON.stringify(request)).not.toContain("synthetic-private-selector");
    },
  );
});

describe("unsupported modern deploy flags", () => {
  it.each(["--check-only", "--checkonly"])(
    "keeps %s incomplete without deriving preview or policy permission",
    async (flag) => {
      const command = `sf project deploy start ${flag} -o PRIVATE_TARGET_SENTINEL`;
      const request = vi.fn(async (wire: ReturnType<typeof buildJevRequest>) => {
        expect(Object.keys(wire.questions)).toEqual(["risk", "org_policy", "disclosure"]);
        expect(wire.state).toMatchObject({
          version: 6,
          operation: {
            metadata: {
              shell: {
                commands: [
                  {
                    subcommands: ["project", "deploy", "start"],
                    flags: [{ name: "unknown" }],
                  },
                ],
              },
            },
            complete: false,
            omissions: expect.arrayContaining(["shell_effects_opaque"]),
          },
          observations: { contextComplete: false },
        });
        expect((wire.state as { observations: Record<string, unknown> }).observations).toEqual({
          contextComplete: false,
        });
        expect(JSON.stringify(wire)).not.toContain("PRIVATE_TARGET_SENTINEL");
        const value = prediction();
        value.answers = {
          risk: prediction(),
          command_policy: prediction(),
          org_policy: prediction(),
          disclosure: prediction(),
        };
        return value;
      });
      const createTransport = testTransport(request);
      const decision = await evaluateJevSafety(
        { ...call(), toolName: "bash", input: { command } },
        {
          createTransport,
          resolveFacts: async () => ({
            facts: { org: { type: "sandbox", verified: true, explicit: true } },
            orgIdentity: "synthetic-org",
          }),
        },
      );
      expect(request).toHaveBeenCalledOnce();
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestAllHeads).not.toHaveBeenCalled();
      expect(selected.requestNonCommand).toHaveBeenCalledOnce();
      expect(selected.requestSyntax).toHaveBeenCalledOnce();
      expect(selected.requestCommandPolicy).toHaveBeenCalledOnce();
      expect(
        Object.keys(vi.mocked(selected.requestCommandPolicy).mock.calls[0][0].questions),
      ).toEqual(["command_policy"]);
      expect(decision.action).toBe("confirm");
      expect(decision.jev?.failure).toBeUndefined();
      expect(decision.approvalScope?.allowSession).toBe(false);
      expect(JSON.stringify(decision)).not.toContain("PRIVATE_TARGET_SENTINEL");
    },
  );
});

describe("Jev risk adapter", () => {
  it("binds Bash metadata and syntax to the original command across temporary caller changes", async () => {
    const input = bashCall([{ id: "source-status", pattern: "git status", behavior: "confirm" }]);
    const originalHash = jevHash(input.input);
    const resolveFacts = vi.fn(
      async (resolved: { input: Record<string, unknown>; metadata: JevToolMetadata }) => {
        expect(resolved.input).not.toBe(input.input);
        expect(resolved.input.command).toBe("git status");
        expect(resolved.metadata).toMatchObject({
          metadata: { shell: { commands: [{ executable: "git", subcommands: ["status"] }] } },
        });
        input.input.command = "git diff";
        input.config.commandGate.patterns[0].behavior = "off";
        return { facts: {} };
      },
    );
    const request = vi.fn<TestPredictionRequest>(async (wire) => {
      expect(input.input.command).toBe("git diff");
      expect(wire.state).toMatchObject({
        operation: {
          metadata: {
            shell: { commands: [{ executable: "git", subcommands: ["status"] }] },
            commandTokens: { publicSyntax: [{ word: "git" }, { word: "status" }] },
          },
        },
        policy: { commands: { patterns: [{ behavior: "confirm" }] } },
      });
      input.input.command = "git status";
      input.config.commandGate.patterns[0].behavior = "confirm";
      return prediction();
    });
    const createTransport = testTransport(request);
    const decision = await evaluateJevSafety(input, { resolveFacts, createTransport });
    expect(decision.action).toBe("allow");
    expect(decision.jev?.failure).toBeUndefined();
    expect(decision.jev?.inputHash).toBe(originalHash);
    expect(jevHash(input.input)).toBe(originalHash);
    expect(resolveFacts).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    const selected = createTransport.mock.results[0].value;
    expect(selected.requestNonCommand).toHaveBeenCalledOnce();
    expect(selected.requestSyntax).toHaveBeenCalledOnce();
    expect(selected.requestCommandPolicy).toHaveBeenCalledOnce();
    const syntax = vi.mocked(selected.requestSyntax).mock.calls[0][0].state as {
      commandTokens: {
        original: Array<{ head: number; args: number[] }>;
        flat: number[];
        publicSyntax: Array<{ id: number; word: string }>;
      };
    };
    expect(syntax.commandTokens.publicSyntax.map(({ word }) => word)).toEqual(["git", "status"]);
    const git = syntax.commandTokens.publicSyntax.find(({ word }) => word === "git")!.id;
    const status = syntax.commandTokens.publicSyntax.find(({ word }) => word === "status")!.id;
    expect(syntax.commandTokens.original).toEqual([{ head: git, args: [status] }]);
    expect(syntax.commandTokens.flat).toEqual([git, status]);
    expect(Object.keys(vi.mocked(selected.requestSyntax).mock.calls[0][0].questions)).toEqual([
      "r_a",
    ]);
  });
  it.each(["before deadline", "at deadline"] as const)(
    "rejects a staged first receipt with the wrong captured transport binding %s",
    async (timing) => {
      let clock = 0;
      vi.spyOn(nodePerformance, "now").mockImplementation(() => clock);
      const createTransport = testTransport(async () => prediction("block", 0.010123));
      const factory = createTransport.getMockImplementation()!;
      createTransport.mockImplementation((options) => {
        const selected = factory(options);
        const dispatch = vi.mocked(selected.requestNonCommand).getMockImplementation()!;
        vi.mocked(selected.requestNonCommand).mockImplementation(async (wire) => {
          const receipt = await dispatch(wire);
          receipt.evidence.transportHash = "a".repeat(64);
          if (timing === "at deadline") clock = 10_000;
          return receipt;
        });
        return selected;
      });
      const decision = await evaluateJevSafety(
        bashCall([{ id: "source-status", pattern: "git status", behavior: "confirm" }]),
        { deadline: 10_000, createTransport, resolveFacts: async () => ({ facts: {} }) },
      );
      expect(decision.action).toBe("block");
      expect(decision.jev?.failure).toBe(
        timing === "at deadline" ? "deadline" : "invalid_response",
      );
      expect(decision.jev?.riskAnswer).toBeUndefined();
      expect(decision.jev?.riskOrigin).toBeUndefined();
      expect(decision.jev?.probabilities).toBeUndefined();
      expect(decision.jev?.process?.kind).toBe("command_stages");
      if (decision.jev?.process?.kind !== "command_stages")
        throw new Error("Expected command stage evidence");
      const result = decision.jev.process.result;
      expect(result.failure).toEqual({ stage: "non_command", code: "invalid_response" });
      expect(result.answers).toEqual({});
      expect(result.origins).toEqual({});
      expect(result.stages).toEqual([]);
      expect(result.actualBlocks).toEqual([]);
      expect(result.attempts.map(({ stage }) => stage)).toEqual(["non_command"]);
      expect(JSON.stringify(decision)).not.toContain("a".repeat(64));
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestNonCommand).toHaveBeenCalledOnce();
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
      expect(selected.requestAllHeads).not.toHaveBeenCalled();
    },
  );
  it.each(["empty", "all off"] as const)(
    "uses two actual command stages for %s active rows",
    async (kind) => {
      const input = bashCall(
        kind === "empty" ? [] : [{ id: "off", pattern: "git status", behavior: "off" }],
      );
      const createTransport = testTransport(async () => prediction("allow", 0.990123));
      const decision = await evaluateJevSafety(input, {
        createTransport,
        resolveFacts: async () => ({ facts: {} }),
      });
      expect(decision.action).toBe("allow");
      expect(decision.jev?.failure).toBeUndefined();
      expect(decision.jev?.requestId).toBeUndefined();
      expect(decision.jev?.provider).toBeUndefined();
      expect(decision.jev?.answers).toBeUndefined();
      expect(decision.jev?.process?.kind).toBe("command_stages");
      if (decision.jev?.process?.kind !== "command_stages")
        throw new Error("Expected command stage evidence");
      const result = decision.jev.process.result;
      expect(result.completed).toBe(true);
      expect(result.syntaxPlan).toMatchObject({
        requested: false,
        reason: "empty-active-manifest",
        rowCount: 0,
      });
      expect(result.syntaxTranscript).toEqual([]);
      expect(result.stages.map(({ stage }) => stage)).toEqual(["non_command", "command_policy"]);
      expect(result.attempts.map(({ stage }) => stage)).toEqual(["non_command", "command_policy"]);
      expect(result.origins.risk?.requestId).toBe("synthetic-request-non_command");
      expect(result.origins.command_policy?.requestId).toBe("synthetic-request-command_policy");
      expect(decision.jev?.riskAnswer).toEqual(result.answers.risk);
      expect(decision.jev?.riskOrigin).toEqual(result.origins.risk);
      expect(result.answers.command_policy?.probabilities.allow).toBe(0.990123);
      expect(result.distributionsCombined).toBe(false);
      expect(result.representsOneProviderReply).toBe(false);
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestAllHeads).not.toHaveBeenCalled();
      expect(selected.requestNonCommand).toHaveBeenCalledOnce();
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(selected.requestCommandPolicy).toHaveBeenCalledOnce();
      expect(vi.mocked(selected.requestCommandPolicy).mock.calls[0][0].state).toEqual({
        version: 35,
        allowedPatterns: [],
        autoDenyPatterns: [],
        patterns: [],
      });
    },
  );
  it("retains 64 source rows in one actual syntax call and the command action body", async () => {
    const input = bashCall(
      Array.from({ length: 64 }, (_, index) => ({
        id: `source-${index}`,
        pattern: index % 2 ? "git diff" : "git status",
        behavior: index % 2 ? "block" : "confirm",
      })),
    );
    input.config.commandGate.allowedPatterns = input.config.commandGate.patterns.splice(0, 1);
    input.config.commandGate.autoDenyPatterns = input.config.commandGate.patterns.splice(0, 1);
    const createTransport = testTransport(async () => prediction());
    const decision = await evaluateJevSafety(input, {
      createTransport,
      resolveFacts: async () => ({ facts: {} }),
    });
    expect(decision.action).toBe("allow");
    expect(decision.jev?.failure).toBeUndefined();
    expect(decision.jev?.process?.kind).toBe("command_stages");
    if (decision.jev?.process?.kind !== "command_stages")
      throw new Error("Expected command stage evidence");
    const result = decision.jev.process.result;
    expect(result.syntaxPlan).toEqual({ requested: true, rowCount: 64 });
    expect(result.syntaxTranscript).toHaveLength(64);
    expect(result.syntaxTranscript[0]).toMatchObject({
      rowId: "r_a",
      group: "allowedPatterns",
      order: 1,
    });
    expect(result.syntaxTranscript[1]).toMatchObject({
      rowId: "r_b",
      group: "autoDenyPatterns",
      order: 1,
    });
    expect(result.syntaxTranscript[63]).toMatchObject({
      rowId: "r_bl",
      group: "patterns",
      order: 62,
    });
    const selected = createTransport.mock.results[0].value;
    expect(selected.requestAllHeads).not.toHaveBeenCalled();
    expect(selected.requestNonCommand).toHaveBeenCalledOnce();
    expect(selected.requestSyntax).toHaveBeenCalledOnce();
    expect(selected.requestCommandPolicy).toHaveBeenCalledOnce();
    const syntaxCall = vi.mocked(selected.requestSyntax).mock.calls[0][0];
    expect(Object.keys(syntaxCall.questions)).toHaveLength(64);
    expect(Object.keys(syntaxCall.questions).at(-1)).toBe("r_bl");
    const actual = await vi.mocked(selected.requestSyntax).mock.results[0].value;
    expect(result.stages[1]).toEqual(actual);
    for (const row of result.syntaxTranscript)
      expect(row.answer).toEqual(actual.answers[row.rowId]);
    const grouped = vi.mocked(selected.requestCommandPolicy).mock.calls[0][0].state as {
      allowedPatterns: unknown[];
      autoDenyPatterns: unknown[];
      patterns: Array<{ rowId: string; answer: unknown }>;
    };
    expect(grouped.allowedPatterns).toHaveLength(1);
    expect(grouped.autoDenyPatterns).toHaveLength(1);
    expect(grouped.patterns).toHaveLength(62);
    expect(grouped.patterns[61]).toMatchObject({ rowId: "u_bl", answer: actual.answers.r_bl });
  });
  it("blocks 65 active source rows before constructing a transport", async () => {
    const input = bashCall(
      Array.from({ length: 65 }, (_, index) => ({ id: `source-${index}`, pattern: "git status" })),
    );
    const request = vi.fn(async () => prediction());
    const createTransport = testTransport(request);
    const decision = await evaluateJevSafety(input, {
      createTransport,
      resolveFacts: async () => ({ facts: {} }),
    });
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("invalid_request");
    expect(createTransport).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(decision.jev?.process?.kind).toBe("command_stages");
    if (decision.jev?.process?.kind !== "command_stages")
      throw new Error("Expected command stage evidence");
    expect(decision.jev.process.result.failure).toEqual({
      stage: "prepare",
      code: "invalid_request",
    });
    expect(decision.jev.process.result.stages).toEqual([]);
    expect(decision.jev.process.result.attempts).toEqual([]);
  });
  it.each(["default", "conservative", "argmax"] as const)(
    "uses %s point for every actual one-call head and preserves raw risk evidence",
    async (selection) => {
      const point = resolveJevOperatingPoint(selection === "default" ? undefined : selection);
      const value = prediction();
      value.answers = {
        risk: {
          choice: "allow",
          probabilities: { allow: 0.6, confirm: 0.25, block: 0.15 },
          confidence: 0.123456,
        },
        file_policy: {
          choice: "allow",
          probabilities: { allow: 0.7, confirm: 0.2, block: 0.1 },
          confidence: 0.654321,
        },
      };
      const createTransport = testTransport(async () => value);
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        resolveFacts: facts,
        createTransport,
        ...(selection === "default" ? {} : { operatingPoint: point }),
      });
      expect(decision.action).toBe(selection === "argmax" ? "allow" : "confirm");
      expect(decision.jev?.failure).toBeUndefined();
      expect(decision.jev?.answers).toEqual(value.answers);
      expect(decision.jev?.probabilities).toEqual(value.answers.risk.probabilities);
      expect(decision.jev?.confidence).toBe(0.123456);
      expect(decision.jev?.requestId).toBe(value.requestId);
      expect(decision.jev?.cost).toBe(value.usage.cost);
      expect(decision.jev?.protocolHash).toBe(jevRuntimeProtocolHash(point));
      expect(decision.jev?.transportHash).toBe(jevDecisionTransportBindingHash(ENDPOINT, point));
      expect(createTransport).toHaveBeenCalledOnce();
      expect(createTransport.mock.calls[0][0].binding).toEqual({
        protocolHash: jevRuntimeProtocolHash(point),
        operatingPointHash: jevOperatingPointHash(point),
      });
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestAllHeads).toHaveBeenCalledOnce();
      expect(Object.keys(vi.mocked(selected.requestAllHeads).mock.calls[0][0].questions)).toEqual([
        "risk",
        "file_policy",
      ]);
      expect(selected.requestNonCommand).not.toHaveBeenCalled();
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
      expect(selected.close).toHaveBeenCalled();
      const actual = await vi.mocked(selected.requestAllHeads).mock.results[0].value;
      expect(decision.jev?.process).toMatchObject({
        kind: "all_heads",
        completed: true,
        stage: actual,
      });
      expect(decision.jev?.riskOrigin).toEqual({
        ...actual.evidence,
        stage: "all_heads",
        questionId: "risk",
        timingOrigin: "transport_cleanup",
      });
    },
  );
  it("binds the explicit operating point into exact approval identity", async () => {
    const options = {
      descriptor,
      resolveFacts: facts,
      createTransport: testTransport(async () => prediction("confirm", 0)),
    };
    const defaultPoint = await evaluateJevSafety(call(), options);
    const conservative = await evaluateJevSafety(call(), {
      ...options,
      operatingPoint: resolveJevOperatingPoint("conservative"),
    });
    const argmax = await evaluateJevSafety(call(), {
      ...options,
      operatingPoint: resolveJevOperatingPoint("argmax"),
    });
    expect(defaultPoint.action).toBe("confirm");
    expect(conservative.action).toBe("confirm");
    expect(argmax.action).toBe("confirm");
    expect(defaultPoint.jev?.transportHash).toBe(conservative.jev?.transportHash);
    expect(defaultPoint.fingerprint).toBe(conservative.fingerprint);
    expect(argmax.jev?.transportHash).not.toBe(conservative.jev?.transportHash);
    expect(argmax.jev?.protocolHash).not.toBe(conservative.jev?.protocolHash);
    expect(argmax.fingerprint).not.toBe(conservative.fingerprint);
  });
  it("uses one automatic 10-second deadline including facts before a stalled one-call reply", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const clock = vi.spyOn(nodePerformance, "now").mockReturnValue(0);
    const request = vi.fn<TestPredictionRequest>(() => new Promise(() => {}));
    const createTransport = testTransport(request);
    const resolveFacts = vi.fn(
      () =>
        new Promise<JevResolvedFacts>((resolve) => {
          setTimeout(
            () => resolve({ facts: { files: [{ path: "src/example.ts", exists: false }] } }),
            6000,
          );
        }),
    );
    let settled = false;
    const pending = evaluateJevSafety(call(), { descriptor, resolveFacts, createTransport });
    void pending.then(() => {
      settled = true;
    });
    clock.mockReturnValue(6000);
    await vi.advanceTimersByTimeAsync(6000);
    expect(request).toHaveBeenCalledOnce();
    expect(createTransport.mock.calls[0][0].deadline).toBe(10_000);
    clock.mockReturnValue(9999);
    await vi.advanceTimersByTimeAsync(3999);
    expect(settled).toBe(false);
    clock.mockReturnValue(10_000);
    await vi.advanceTimersByTimeAsync(1);
    const decision = await pending;
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("deadline");
    expect(decision.jev?.latencyMs).toBe(10_000);
    const selected = createTransport.mock.results[0].value;
    expect(selected.requestAllHeads).toHaveBeenCalledOnce();
    expect(selected.requestNonCommand).not.toHaveBeenCalled();
    expect(selected.requestSyntax).not.toHaveBeenCalled();
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
    expect(selected.close).toHaveBeenCalled();
  });
  it.each([
    ["missing head", (reply: JevAllHeadStageResult) => delete reply.answers.file_policy],
    [
      "extra head",
      (reply: JevAllHeadStageResult) => {
        reply.answers.disclosure = answer(prediction());
      },
    ],
    [
      "reordered origin IDs",
      (reply: JevAllHeadStageResult) => {
        reply.evidence.requestedQuestionIds.reverse();
      },
    ],
    [
      "wrong request origin",
      (reply: JevAllHeadStageResult) => {
        reply.evidence.requestHash = "a".repeat(64);
      },
    ],
    [
      "malformed raw vector",
      (reply: JevAllHeadStageResult) => {
        reply.answers.file_policy.probabilities = { allow: 0.4, confirm: 0.4, block: 0 };
      },
    ],
  ] as const)(
    "blocks %s in a strict one-call receipt without another call",
    async (_label, mutate) => {
      const createTransport = testTransport(async () => prediction(), mutate);
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        resolveFacts: facts,
        createTransport,
      });
      expect(decision.action).toBe("block");
      expect(decision.jev?.failure).toBe("invalid_response");
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestAllHeads).toHaveBeenCalledOnce();
      expect(selected.requestNonCommand).not.toHaveBeenCalled();
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
      expect(selected.close).toHaveBeenCalled();
    },
  );
  it("keeps the validated actual heads immutable when transport cleanup changes its reply", async () => {
    let returned!: JevAllHeadStageResult;
    let responseHash!: string;
    const createTransport = testTransport(
      async () => prediction("block", 0),
      (reply) => {
        returned = reply;
        responseHash = reply.evidence.responseHash;
      },
    );
    const factory = createTransport.getMockImplementation()!;
    createTransport.mockImplementation((options) => {
      const selected = factory(options);
      vi.mocked(selected.close).mockImplementation(() => {
        for (const value of Object.values(returned.answers)) {
          value.choice = "allow";
          value.probabilities = { allow: 1, confirm: 0, block: 0 };
        }
        returned.evidence.responseHash = "b".repeat(64);
      });
      return selected;
    });
    const decision = await evaluateJevSafety(call(), {
      descriptor,
      resolveFacts: facts,
      createTransport,
    });
    expect(returned.answers.risk.choice).toBe("allow");
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBeUndefined();
    expect(decision.jev?.riskAnswer).toEqual(answer(prediction("block", 0)));
    expect(decision.jev?.process?.kind).toBe("all_heads");
    if (decision.jev?.process?.kind !== "all_heads") throw new Error("Expected all-head evidence");
    const stage = decision.jev.process.stage;
    expect(Object.isFrozen(stage)).toBe(true);
    expect(stage?.answers).toEqual({
      risk: answer(prediction("block", 0)),
      file_policy: answer(prediction("block", 0)),
    });
    expect(stage?.evidence.responseHash).toBe(responseHash);
    expect(JSON.stringify(decision)).not.toContain("b".repeat(64));
  });
  it.each([
    "valid",
    "missing head",
    "wrong transport binding",
    "wrong request hash",
    "wrong provider",
    "wrong stage",
  ] as const)(
    "reads the synchronous %s observed receipt once when outer caller abort wins the reply wait",
    async (kind) => {
      const controller = new AbortController();
      const value = prediction("block", 0.010123);
      value.confidence = 0.412345;
      value.answers = {
        risk: answer(value),
        file_policy: {
          choice: "allow",
          probabilities: { allow: 0.6789, confirm: 0.3211, block: 0 },
          confidence: 0.654321,
        },
      };
      let observed!: JevAllHeadStageResult;
      let actual!: JevAllHeadStageResult;
      const readObserved = vi.fn(() => observed);
      const createTransport = testTransport(async () => value);
      const factory = createTransport.getMockImplementation()!;
      createTransport.mockImplementation((options) => {
        const selected = factory(options);
        const dispatch = vi.mocked(selected.requestAllHeads).getMockImplementation()!;
        selected.getObservedResult = readObserved;
        vi.mocked(selected.requestAllHeads).mockImplementation(async (wire) => {
          actual = await dispatch(wire);
          observed = structuredClone(actual);
          if (kind === "missing head") delete observed.answers.file_policy;
          else if (kind === "wrong transport binding")
            observed.evidence.transportHash = "a".repeat(64);
          else if (kind === "wrong request hash") observed.evidence.requestHash = "a".repeat(64);
          else if (kind === "wrong provider") observed.evidence.provider = "other-provider";
          else if (kind === "wrong stage") observed.stage = "syntax" as never;
          controller.abort();
          return new Promise<JevAllHeadStageResult>(() => {});
        });
        return selected;
      });
      const decision = await evaluateJevSafety(
        {
          toolName: "write",
          input: { path: "src/example.ts", content: "Controlled test body" },
          cwd: "/synthetic/project",
          config: bashCall().config,
        },
        {
          descriptor,
          signal: controller.signal,
          createTransport,
          resolveFacts: async () => ({
            facts: { files: [{ path: "src/example.ts", exists: false }] },
          }),
        },
      );
      expect(decision.action).toBe("block");
      expect(decision.jev?.failure).toBe("cancelled");
      expect(readObserved).toHaveBeenCalledOnce();
      expect(decision.jev?.process?.kind).toBe("all_heads");
      if (decision.jev?.process?.kind !== "all_heads")
        throw new Error("Expected all-head evidence");
      expect(decision.jev.process.completed).toBe(false);
      expect(decision.jev.process.failureEvidence).toBeUndefined();
      if (kind === "valid") {
        expect(decision.jev.process.stage).toEqual(actual);
        expect(decision.jev.process.stageTimingOrigin).toBe("strict_validation");
        expect(Object.isFrozen(decision.jev.process.stage)).toBe(true);
        expect(decision.jev.riskAnswer).toEqual(value.answers.risk);
        expect(decision.jev.probabilities).toEqual(value.probabilities);
        expect(decision.jev.confidence).toBe(0.412345);
        expect(decision.jev.riskOrigin).toEqual({
          ...actual.evidence,
          stage: "all_heads",
          questionId: "risk",
          timingOrigin: "strict_validation",
        });
        expect(decision.jev.process.stage?.answers.file_policy).toEqual(value.answers.file_policy);
      } else {
        expect(decision.jev.process.stage).toBeUndefined();
        expect(decision.jev.process.stageTimingOrigin).toBeUndefined();
        expect(decision.jev.riskAnswer).toBeUndefined();
        expect(decision.jev.riskOrigin).toBeUndefined();
        expect(decision.jev.probabilities).toBeUndefined();
        expect(decision.jev.confidence).toBeUndefined();
      }
      const selected = createTransport.mock.results[0].value;
      expect(selected.requestAllHeads).toHaveBeenCalledOnce();
      expect(selected.requestNonCommand).not.toHaveBeenCalled();
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
      expect(selected.close).toHaveBeenCalledOnce();
    },
  );
  it.each(["null operating point", "null deadline", "expired deadline"] as const)(
    "blocks %s before facts or transport dispatch",
    async (invalid) => {
      const request = vi.fn(async () => prediction());
      const createTransport = testTransport(request);
      const resolveFacts = vi.fn(async () => ({ facts: {} }));
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        createTransport,
        resolveFacts,
        ...(invalid === "null operating point"
          ? { operatingPoint: null as never }
          : { deadline: invalid === "null deadline" ? (null as never) : 0 }),
      });
      expect(decision.action).toBe("block");
      expect(decision.jev?.failure).toBe(
        invalid === "expired deadline" ? "deadline" : "invalid_request",
      );
      expect(resolveFacts).not.toHaveBeenCalled();
      expect(createTransport).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(decision.jev?.process).toBeUndefined();
    },
  );
  it.each([
    "null transport callback",
    "null facts callback",
    "unknown legacy request",
    "accessor",
    "proxy",
  ] as const)("rejects %s options before effects", async (invalid) => {
    const request = vi.fn(async () => prediction());
    const createTransport = testTransport(request);
    const resolveFacts = vi.fn(async () => {
      throw new Error("Unexpected fact lookup");
    });
    const getter = vi.fn(() => ENDPOINT);
    const trap = vi.fn(() => {
      throw new Error("Unexpected proxy trap");
    });
    let options: NonNullable<Parameters<typeof evaluateJevSafety>[1]> = {
      descriptor,
      createTransport,
      resolveFacts,
    };
    if (invalid === "null transport callback") options.createTransport = null as never;
    else if (invalid === "null facts callback") options.resolveFacts = null as never;
    else if (invalid === "unknown legacy request") options = { ...options, request } as never;
    else if (invalid === "accessor")
      Object.defineProperty(options, "endpoint", { enumerable: true, get: getter });
    else
      options = new Proxy(options, {
        get: trap,
        ownKeys: trap,
        getOwnPropertyDescriptor: trap,
        getPrototypeOf: trap,
      });
    const decision = await evaluateJevSafety(call(), options);
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("invalid_request");
    expect(decision.jev?.process).toBeUndefined();
    expect(resolveFacts).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
    expect(trap).not.toHaveBeenCalled();
  });
  it.each([
    [
      "wrong request origin",
      (evidence: JevStageFailureEvidence) => {
        evidence.requestHash = "a".repeat(64);
      },
    ],
    [
      "wrong transport origin",
      (evidence: JevStageFailureEvidence) => {
        evidence.transportHash = "a".repeat(64);
      },
    ],
    [
      "mixed full and prefix proof",
      (evidence: JevStageFailureEvidence) => {
        evidence.responseComplete = false;
        evidence.responseHash = "a".repeat(64);
        evidence.responseBytes = 8;
        evidence.responsePrefixHash = "b".repeat(64);
        evidence.responsePrefixBytes = 8;
      },
    ],
    [
      "extra private field",
      (evidence: JevStageFailureEvidence & { extra?: string }) => {
        evidence.extra = "private error field";
      },
    ],
  ] as const)("rejects %s before retaining a failed one-call receipt", async (_invalid, mutate) => {
    const request = vi.fn<TestPredictionRequest>(async (wire) => {
      const json = JSON.stringify(wire);
      const evidence: JevStageFailureEvidence = {
        stage: "all_heads",
        requestedQuestionIds: Object.keys(wire.questions),
        requestHash: createHash("sha256").update(json).digest("hex"),
        requestBytes: Buffer.byteLength(json),
        transportHash: jevDecisionTransportBindingHash(ENDPOINT),
        latencyMs: 1,
        requestSent: true,
        failure: "http_error",
      };
      mutate(evidence);
      throw new JevStageClientError("http_error", evidence);
    });
    const createTransport = testTransport(request);
    const decision = await evaluateJevSafety(call(), {
      descriptor,
      resolveFacts: facts,
      createTransport,
    });
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("invalid_response");
    expect(decision.jev?.process?.kind).toBe("all_heads");
    if (decision.jev?.process?.kind !== "all_heads") throw new Error("Expected all-head evidence");
    expect(decision.jev.process.failureEvidence).toBeUndefined();
    expect(decision.jev.process.stage).toBeUndefined();
    expect(decision.jev.process.completed).toBe(false);
    expect(JSON.stringify(decision)).not.toContain("private error field");
    const selected = createTransport.mock.results[0].value;
    expect(selected.requestAllHeads).toHaveBeenCalledOnce();
    expect(selected.requestNonCommand).not.toHaveBeenCalled();
    expect(selected.requestSyntax).not.toHaveBeenCalled();
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
  });
  it("keeps the actual risk answer and its complete origin after one-call cleanup fails", async () => {
    const value = prediction("allow", 0.990123);
    value.confidence = 0.812345;
    const createTransport = testTransport(async () => value);
    const factory = createTransport.getMockImplementation()!;
    createTransport.mockImplementation((options) => {
      const selected = factory(options);
      vi.mocked(selected.close).mockImplementation(() => {
        throw new Error("private cleanup text");
      });
      return selected;
    });
    const decision = await evaluateJevSafety(call(), {
      descriptor,
      resolveFacts: facts,
      createTransport,
    });
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBe("transport_error");
    expect(decision.jev?.riskAnswer).toEqual(answer(value));
    expect(decision.jev?.probabilities).toEqual(value.probabilities);
    expect(decision.jev?.confidence).toBe(0.812345);
    expect(decision.jev?.process?.kind).toBe("all_heads");
    if (decision.jev?.process?.kind !== "all_heads") throw new Error("Expected all-head evidence");
    expect(decision.jev.process.completed).toBe(false);
    expect(decision.jev.process.cleanupFailed).toBe(true);
    const actual = await vi.mocked(createTransport.mock.results[0].value.requestAllHeads).mock
      .results[0].value;
    expect(decision.jev.process.stage).toEqual(actual);
    expect(decision.jev?.riskOrigin).toEqual({
      ...actual.evidence,
      stage: "all_heads",
      questionId: "risk",
      timingOrigin: "transport_cleanup",
    });
    expect(JSON.stringify(decision)).not.toContain("private cleanup text");
  });
  it("sends only metadata and effective policy, while retaining hosted provenance", async () => {
    const request = vi.fn(async () => prediction());
    const decision = await evaluateJevSafety(call(), {
      descriptor,
      createTransport: testTransport(request),
      resolveFacts: facts,
    });
    expect(decision.action).toBe("allow");
    expect(decision.feature).toBe("jevGate");
    expect(decision.jev?.model).toBe(JEV_RESOLVED_MODEL);
    expect(decision.jev?.cost).toBe(0.00001);
    expect(decision.jev?.inputHash).toBe(jevHash(call().input));
    expect(decision.jev?.transportHash).toBe(jevDecisionTransportBindingHash(ENDPOINT));
    expect(JSON.stringify(decision)).not.toContain(ENDPOINT);
    const serialized = JSON.stringify(request.mock.calls);
    expect(serialized).not.toContain("SENTINEL_PRIVATE_BODY");
    expect(serialized).not.toContain("/synthetic/project");
    expect(serialized).toContain('"block"');
    expect(decision.approvalScope?.allowSession).toBe(false);
  });
  it.each([undefined, "", "http://decisions.example.test/v1/decisions"])(
    "blocks an absent or invalid endpoint before fact lookup and a model request",
    async (endpoint) => {
      vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
      const resolveFacts = vi.fn(async () => ({ facts: {} }));
      const request = vi.fn(async () => prediction());
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        resolveFacts,
        createTransport: testTransport(request),
      });
      expect(decision.action).toBe("block");
      expect(decision.jev?.failure).toBe(endpoint ? "invalid_endpoint" : "missing_endpoint");
      expect(decision.jev?.transportHash).toBeUndefined();
      expect(resolveFacts).not.toHaveBeenCalled();
      expect(request).not.toHaveBeenCalled();
      expect(JSON.stringify(decision)).not.toContain("decisions.example.test");
    },
  );
  it("changes the exact approval fingerprint when the endpoint changes", async () => {
    const options = {
      descriptor,
      createTransport: testTransport(async () => prediction("confirm", 0)),
      resolveFacts: async () => ({
        facts: { org: { type: "sandbox" as const, verified: true, explicit: true } },
        orgIdentity: "synthetic-org",
      }),
    };
    const first = await evaluateJevSafety(call(), options);
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
    const second = await evaluateJevSafety(call(), options);
    expect(first.action).toBe("confirm");
    expect(second.action).toBe("confirm");
    expect(first.approvalScope?.allowSession).toBe(true);
    expect(second.approvalScope?.allowSession).toBe(true);
    expect(first.jev?.transportHash).toBe(jevDecisionTransportBindingHash(ENDPOINT));
    expect(second.jev?.transportHash).toBe(jevDecisionTransportBindingHash(OTHER_ENDPOINT));
    expect(first.jev?.inputHash).toBe(second.jev?.inputHash);
    expect(first.jev?.factsHash).toBe(second.jev?.factsHash);
    expect(first.jev?.transportHash).not.toBe(second.jev?.transportHash);
    expect(first.fingerprint).not.toBe(second.fingerprint);
    expect(JSON.stringify([first, second])).not.toContain("decisions.example.test");
  });
  it("uses the captured point, endpoint, and deadline after fact lookup and a pending reply", async () => {
    const point = resolveJevOperatingPoint("conservative");
    vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "conservative");
    const deadline = performance.now() + 10_000;
    let releaseFacts!: (value: JevResolvedFacts) => void;
    let releasePrediction!: (value: JevPrediction) => void;
    const resolveFacts = vi.fn(
      () =>
        new Promise<JevResolvedFacts>((resolve) => {
          releaseFacts = resolve;
        }),
    );
    const request = vi.fn<TestPredictionRequest>(
      () =>
        new Promise<JevPrediction>((resolve) => {
          releasePrediction = resolve;
        }),
    );
    const createTransport = testTransport(request);
    const pending = evaluateJevSafety(call(), {
      descriptor,
      resolveFacts,
      createTransport,
      deadline,
    });
    expect(resolveFacts).toHaveBeenCalledOnce();
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", OTHER_ENDPOINT);
    vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "argmax");
    releaseFacts({ facts: { files: [{ path: "src/example.ts", exists: false }] } });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    expect(request.mock.calls[0][1]?.endpoint).toBe(ENDPOINT);
    expect(createTransport.mock.calls[0][0]).toMatchObject({
      endpoint: ENDPOINT,
      deadline,
      binding: {
        protocolHash: jevRuntimeProtocolHash(point),
        operatingPointHash: jevOperatingPointHash(point),
      },
    });
    const wireRequest = request.mock.calls[0][0];
    expect(wireRequest).toEqual(
      buildJevRequest(
        buildJevMetadata(call().toolName, call().input, descriptor),
        { files: [{ path: "src/example.ts", exists: false }] },
        call().config,
      ),
    );
    expect(JSON.stringify(wireRequest)).not.toContain(ENDPOINT);
    expect(JSON.stringify(wireRequest)).not.toContain("transportHash");
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "");
    releasePrediction(prediction("allow", 0.98));
    const decision = await pending;
    expect(decision.action).toBe("confirm");
    expect(decision.jev?.operatingPoint).toEqual(point);
    expect(decision.jev?.transportHash).toBe(jevDecisionTransportBindingHash(ENDPOINT, point));
    expect(JSON.stringify(decision)).not.toContain(ENDPOINT);
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
  it.each(["grep", "find", "ls"])(
    "adds file policy and disclosure for the public %s metadata",
    (toolName) => {
      const input = toolName === "ls" ? {} : { pattern: "PRIVATE_SELECTOR_SENTINEL" };
      const metadata = buildJevMetadata(toolName, input);
      const request = buildJevRequest(
        metadata,
        { files: [{ path: ".", exists: true }] },
        readBundledConfig(),
      );
      expect(Object.keys(request.questions)).toEqual(["risk", "file_policy", "disclosure"]);
      expect(request.state).toMatchObject({
        version: 6,
        operation: { metadata: { path: ".", paths: ["."] }, complete: true },
        facts: { files: [{ path: ".", exists: true }] },
        observations: { contextComplete: true },
        policy: { files: expect.any(Array) },
      });
      expect(JSON.stringify(request)).not.toContain("PRIVATE_SELECTOR_SENTINEL");
      expect(request.questions.risk.instructions).toMatchObject({
        rules: expect.arrayContaining([
          expect.stringContaining("Withheld data selectors do not add executable effects"),
        ]),
      });
      expect(request.questions.disclosure?.instructions).toMatchObject({
        rules: expect.arrayContaining([expect.stringContaining("selected descendants unobserved")]),
      });
    },
  );
  it("uses the model's file-policy block for grep and retains all answer evidence", async () => {
    const input = {
      pattern: "PRIVATE_SELECTOR_SENTINEL",
      glob: "PRIVATE_GLOB_SENTINEL",
      path: ".env",
    };
    const resolveFacts = vi.fn(async (options) => {
      expect(options.metadata.metadata.paths).toEqual([".env"]);
      return { facts: { files: [{ path: ".env", exists: true }] } };
    });
    const request = vi.fn(async (wire) => {
      expect(Object.keys(wire.questions)).toEqual(["risk", "file_policy", "disclosure"]);
      expect(wire.state).toMatchObject({
        facts: { files: [{ path: ".env", exists: true }] },
        observations: { contextComplete: true },
      });
      const value = prediction();
      value.answers = {
        risk: prediction(),
        file_policy: prediction("block", 0),
        disclosure: prediction("confirm", 0),
      };
      return value;
    });
    const decision = await evaluateJevSafety(
      { ...call(), toolName: "grep", input },
      { createTransport: testTransport(request), resolveFacts },
    );
    expect(resolveFacts).toHaveBeenCalledOnce();
    expect(request).toHaveBeenCalledOnce();
    expect(decision.action).toBe("block");
    expect(decision.jev?.failure).toBeUndefined();
    expect(decision.jev?.answers).toMatchObject({
      risk: { choice: "allow" },
      file_policy: { choice: "block" },
      disclosure: { choice: "confirm" },
    });
    expect(decision.jev?.probabilities.allow).toBe(1);
    expect(JSON.stringify(request.mock.calls)).not.toContain("PRIVATE_SELECTOR_SENTINEL");
    expect(JSON.stringify(request.mock.calls)).not.toContain("PRIVATE_GLOB_SENTINEL");
  });
  it("allows complete grep context when every model question allows the private data selector", async () => {
    const request = vi.fn(async () => {
      const value = prediction();
      value.answers = {
        risk: prediction(),
        file_policy: prediction(),
        disclosure: prediction(),
      };
      return value;
    });
    const decision = await evaluateJevSafety(
      {
        ...call(),
        toolName: "grep",
        input: { path: "README.md", pattern: "PRIVATE_SELECTOR_SENTINEL", literal: true },
      },
      {
        createTransport: testTransport(request),
        resolveFacts: async () => ({ facts: { files: [{ path: "README.md", exists: true }] } }),
      },
    );
    expect(request).toHaveBeenCalledOnce();
    expect(decision.action).toBe("allow");
    expect(decision.jev?.failure).toBeUndefined();
    expect(JSON.stringify(request.mock.calls)).not.toContain("PRIVATE_SELECTOR_SENTINEL");
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
    const first = await evaluateJevSafety(call("one"), {
      descriptor,
      createTransport: testTransport(request),
      resolveFacts,
    });
    const second = await evaluateJevSafety(call("two"), {
      descriptor,
      createTransport: testTransport(request),
      resolveFacts,
    });
    const policy = call("one");
    policy.config.policies.rules[0].behavior = "block";
    const third = await evaluateJevSafety(policy, {
      descriptor,
      createTransport: testTransport(request),
      resolveFacts,
    });
    const fourth = await evaluateJevSafety(
      { ...call("one"), cwd: "/other" },
      { descriptor, createTransport: testTransport(request), resolveFacts },
    );
    const fifth = await evaluateJevSafety(call("one"), {
      descriptor: { ...descriptor, description: "Changed semantics" },
      createTransport: testTransport(request),
      resolveFacts,
    });
    const sixth = await evaluateJevSafety(
      { ...call("one"), sessionId: "another-session" },
      { descriptor, createTransport: testTransport(request), resolveFacts },
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
          createTransport: testTransport(request),
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
  it.each([
    [
      "risk",
      "f2b0713a6f7ee20df11f5f5fc73546762cfe3839e290d72921eee9c58636de92",
      [
        "1834a24ec129ac6d0d32215cff78476ac4a695f5944e4785f2f8be36cbcc32e3",
        "70ad9ea61cdd06a7cf6deb65c177de3f0549fa867708b290e1c6437bf7b3708c",
      ],
    ],
    [
      "disclosure",
      "a276472606d5e398096644fdbb943333f296b29f28da286d8acddac7d584b47a",
      [
        "e978472b669c29a895a8475a231df3eeb37d19a5d4b82e827850641369416d6c",
        "2fcee0f715ae1ddddddc69913969b27250495101cc9d8ed229e5930d01cb026c",
      ],
    ],
  ] as const)(
    "binds the SOQL %s question and rejects its prior contract",
    (question, current, prior) => {
      const request = buildJevRequest(
        { toolName: "sf_soql", metadata: {}, omissions: [], complete: true },
        {},
        readBundledConfig(),
      );
      const hash = createHash("sha256")
        .update(JSON.stringify(request.questions[question]))
        .digest("hex");
      expect(hash).toBe(current);
      for (const priorHash of prior) expect(hash).not.toBe(priorHash);
    },
  );
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
      createTransport: testTransport(async () => prediction("confirm", 0)),
      resolveFacts: async () => ({
        facts: { org: { type: "sandbox" as const, verified: true, explicit: true } },
        orgIdentity: "synthetic-org",
      }),
    });
    const priorProtocols = [
      // Prior source contracts: protocols 9, 10, 11, 12, and reviewed protocol 13.
      "647d951506b4f5b3b2a9aff5dcaf411a63d0f8be7131750841077ba1013a6224",
      "9e07e666c0e1d14511135f8151cb7418dc8e93a878ec92d549258d393c48604a",
      "5754b79d085657e5cd68f37bf2fb2fe366fe936631982d9da3d572a1f8b66508",
      "b0410478d964dbf2ffe1156212e9bdd5a46bc9d666dd284c55af5959ec429254",
      "c22e7cf3b6bd63f5a50817e086df07ac389b967cf4f528beccf76e39bbee4432",
      "7a54152c190028086d5013380ffde8ceba53ef286239cd8b46bba56185f902db",
      "0e04eae25722caf0d86aca285ffbef575738c0e3015472e9a8b44f3f6a8e8962",
      "3472d1d1a8fa1c8debd46b54ca200667b803016e4daa06721c7bc46f970fc39c",
    ];
    expect(JEV_PROTOCOL_HASH).toBe(
      "53b22b9b3279451a147e9147a0e60469f6a897ddc07174c0c09f4f166b7a3588",
    );
    const protocolHash = jevRuntimeProtocolHash();
    expect(decision.jev?.protocolHash).toBe(protocolHash);
    expect(decision.approvalScope?.allowSession).toBe(true);
    const identity = {
      toolName: input.toolName,
      originalHash: decision.jev?.inputHash,
      descriptorHash: decision.jev?.descriptorHash,
      cwd: input.cwd,
      sessionId: null,
      factsHash: decision.jev?.factsHash,
      transportHash: decision.jev?.transportHash,
      policyHash: decision.jev?.policyHash,
      operatingPointHash: decision.jev?.operatingPointHash,
      engine: "jev",
      model: JEV_RESOLVED_MODEL,
    };
    expect(decision.fingerprint).toBe(jevHash({ ...identity, protocolHash }));
    for (const priorProtocol of priorProtocols) {
      expect(JEV_PROTOCOL_HASH).not.toBe(priorProtocol);
      expect(decision.fingerprint).not.toBe(jevHash({ ...identity, protocolHash: priorProtocol }));
    }
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
  it("omits browser age from the exact hosted body and hash without changing input facts", () => {
    const metadata: JevToolMetadata = {
      toolName: "sf_browser_click",
      metadata: { ref: "e1", mutation: false },
      omissions: [],
      complete: true,
    };
    const first = {
      org: { type: "scratch" as const, verified: true, explicit: true },
      browser: { status: "fresh", role: "button", label: "Continue", ageMs: 125 },
    };
    const second = structuredClone(first);
    second.browser.ageMs = 875;
    const before = structuredClone([first, second]);
    Object.freeze(first.browser);
    Object.freeze(second.browser);
    Object.freeze(first);
    Object.freeze(second);
    const wires = [first, second].map((facts) =>
      buildJevRequest(metadata, facts, bashCall().config),
    );
    expect(wires[0].state).toMatchObject({
      facts: {
        org: first.org,
        browser: { status: "fresh", role: "button", label: "Continue" },
      },
    });
    const bodies = wires.map((wire) => JSON.stringify(wire));
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).not.toContain('"ageMs"');
    const hashes = bodies.map((body) => createHash("sha256").update(body).digest("hex"));
    expect(hashes[0]).toBe(hashes[1]);
    expect([first, second]).toEqual(before);
  });
  it.each([
    ["fresh", "button", "Continue"],
    ["stale", "link", "Read"],
    ["missing-session", "menuitem", "Open"],
    ["missing-ref", "textbox", "Search"],
    ["incomplete", "checkbox", "Enable"],
  ] as const)(
    "preserves %s freshness and supplied browser target facts on the wire",
    (status, role, label) => {
      const facts = { browser: { status, role, label, ageMs: 333 } };
      const before = structuredClone(facts);
      const wire = buildJevRequest(
        {
          toolName: "sf_browser_click",
          metadata: { ref: "e2", mutation: false },
          omissions: [],
          complete: true,
        },
        facts,
        bashCall().config,
      );
      expect(wire.state).toMatchObject({
        operation: { metadata: { ref: "e2", mutation: false } },
        facts: { browser: { status, role, label } },
        observations: { contextComplete: status === "fresh" },
      });
      expect((wire.state as { facts: unknown }).facts).toEqual({
        browser: { status, role, label },
      });
      expect(facts).toEqual(before);
    },
  );
  it("keeps age outside approval identity while binding snapshot changes and staleness", async () => {
    const original: JevResolvedFacts = {
      facts: { browser: { status: "fresh", role: "button", label: "Continue", ageMs: 125 } },
      browserIdentity: "source-snapshot-a",
    };
    const older = structuredClone(original);
    older.facts.browser!.ageMs = 875;
    const replaced = structuredClone(older);
    replaced.browserIdentity = "source-snapshot-b";
    const stale = structuredClone(older);
    stale.facts.browser!.status = "stale";
    const observations = [original, older, replaced, stale];
    const before = structuredClone(observations);
    const input = {
      toolName: "sf_browser_click",
      input: { ref: "e1", mutation: false },
      cwd: "/synthetic/project",
      config: bashCall().config,
    };
    const request = vi.fn<TestPredictionRequest>(async () => prediction("allow", 0.990123));
    const createTransport = testTransport(request);
    const decisions = [];
    for (const resolved of observations)
      decisions.push(
        await evaluateJevSafety(input, {
          descriptor: { description: "Activate an observed browser target" },
          createTransport,
          resolveFacts: async () => resolved,
        }),
      );
    expect(decisions.map(({ action }) => action)).toEqual(["allow", "allow", "allow", "confirm"]);
    expect(decisions.map(({ jev }) => jev?.factsHash)).toEqual(
      observations.map(jevFactBindingHash),
    );
    expect(decisions[0].fingerprint).toBe(decisions[1].fingerprint);
    expect(decisions[0].jev?.factsHash).toBe(decisions[1].jev?.factsHash);
    for (const changed of decisions.slice(2)) {
      expect(changed.fingerprint).not.toBe(decisions[0].fingerprint);
      expect(changed.jev?.factsHash).not.toBe(decisions[0].jev?.factsHash);
    }
    const bodies = request.mock.calls.map(([wire]) => JSON.stringify(wire));
    expect(bodies[0]).toBe(bodies[1]);
    expect(bodies[0]).toBe(bodies[2]);
    expect(bodies[3]).not.toBe(bodies[0]);
    expect(bodies.join()).not.toContain('"ageMs"');
    expect(bodies.join()).not.toContain("source-snapshot-");
    expect(createTransport.mock.results.map(({ value }) => value.requestAllHeads)).toHaveLength(4);
    for (const { value } of createTransport.mock.results)
      expect(value.requestAllHeads).toHaveBeenCalledOnce();
    const stages = decisions.map(({ jev }) =>
      jev?.process?.kind === "all_heads" ? jev.process.stage : undefined,
    );
    expect(stages[0]?.evidence.requestHash).toBe(stages[1]?.evidence.requestHash);
    expect(stages[0]?.evidence.requestHash).toBe(stages[2]?.evidence.requestHash);
    expect(stages[3]?.evidence.requestHash).not.toBe(stages[0]?.evidence.requestHash);
    expect(observations).toEqual(before);
  });
  it.each(["production", "unknown"] as const)(
    "does not grant session approval to %s targets",
    async (type) => {
      const decision = await evaluateJevSafety(call(), {
        descriptor,
        createTransport: testTransport(async () => prediction("confirm", 0)),
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
      createTransport: testTransport(async () => {
        throw new JevClientError("invalid_response");
      }),
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
        createTransport: testTransport(async () => prediction("confirm", 0)),
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
      createTransport: testTransport(request),
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
        createTransport: testTransport(request),
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
        createTransport: testTransport(request),
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
