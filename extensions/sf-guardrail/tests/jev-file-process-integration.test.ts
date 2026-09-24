/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import {
  buildJevRequest,
  evaluateJevSafety,
  jevRuntimeProtocolHash,
  jevDecisionTransportBindingHash,
  jevConfigHash,
  jevFactBindingHash,
} from "../lib/jev-risk.ts";
import {
  createJevProcessTransport,
  createJevFileMatchProcessTransport,
  JEV_RESOLVED_MODEL,
  JEV_PROVIDER,
} from "../lib/jev-client.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { resolveJevOperatingPoint } from "../lib/jev-operating-point.ts";
import { decodeJevFileTranscript, prepareJevFileProcess } from "../lib/jev-file-process.ts";
import type { SafetyKernelInput } from "../lib/safety-kernel.ts";
import type { JevAction, JevFileMatchChoice, JevRequest, JevResolvedFacts } from "../lib/types.ts";

const ENDPOINT = "https://private-decisions.example.test/v1/decisions";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const file = (path = "notes.txt") => ({
  path,
  relativePath: path,
  absolutePath: `/private-work/${path}`,
  basename: path.split("/").at(-1),
  exists: true as const,
  kind: "file" as const,
});
function call(bash = false): SafetyKernelInput {
  const config = readBundledConfig();
  config.policies.rules = [
    {
      id: "own-rule",
      enabled: true,
      protection: "noAccess",
      behavior: "block",
      patterns: [{ pattern: "**/*.private" }],
      allowedPatterns: [{ pattern: "allowed/**" }],
      onlyIfExists: true,
    },
  ];
  return {
    toolName: bash ? "bash" : "write",
    input: bash
      ? { command: "cat notes.txt" }
      : { path: "notes.txt", content: "Private authored data." },
    cwd: "/private-work",
    sessionId: "inert-session",
    toolCallId: "inert-call",
    config,
    engine: "jev",
  };
}
function facts(input: SafetyKernelInput): JevResolvedFacts {
  return {
    facts: { files: [file(typeof input.input.path === "string" ? input.input.path : "notes.txt")] },
  };
}
function harness(
  input = call(),
  options: {
    action?: JevAction;
    choice?: JevFileMatchChoice;
    selected?: number;
    point?: "conservative" | "argmax";
    onReply?: (ordinal: number, body: JevRequest) => void;
  } = {},
) {
  const point = resolveJevOperatingPoint(options.point ?? "conservative");
  const bodies: JevRequest[] = [];
  const selected = options.selected ?? 1;
  const choice = options.choice ?? "no_match";
  const fetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
    const request = JSON.parse(init!.body as string) as JevRequest;
    bodies.push(request);
    const ids = Object.keys(request.questions);
    const ternary = ids[0]?.startsWith("f_");
    const syntax = ids[0]?.startsWith("r_");
    const action = options.action ?? "allow";
    const answers = Object.fromEntries(
      ids.map((id) => [
        id,
        ternary
          ? {
              type: "choice",
              choice,
              probabilities: Object.fromEntries(
                ["match", "no_match", "unknown"].map((name) => [
                  name,
                  name === choice
                    ? selected
                    : name === (choice === "match" ? "no_match" : "match")
                      ? 1 - selected
                      : 0,
                ]),
              ),
              confidence: 1,
            }
          : syntax
            ? {
                type: "choice",
                choice: "no_match",
                probabilities: { match: 0, no_match: 1 },
                confidence: 0.83,
              }
            : {
                type: "choice",
                choice: action,
                probabilities: {
                  allow: action === "allow" ? 1 : 0,
                  confirm: action === "confirm" ? 1 : 0,
                  block: action === "block" ? 1 : 0,
                },
                confidence: 0.91,
              },
      ]),
    );
    options.onReply?.(bodies.length, request);
    return new Response(
      JSON.stringify({
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        id: `actual-controlled-stage-${bodies.length}`,
        answers,
        usage: { input_tokens: 35, output_tokens: 16, cost: 0.00003 },
      }),
    );
  });
  const resolveFacts = vi.fn<
    NonNullable<NonNullable<Parameters<typeof evaluateJevSafety>[1]>["resolveFacts"]>
  >(async () => structuredClone(facts(input)));
  const createFileTransport = vi.fn<typeof createJevFileMatchProcessTransport>((options) =>
    createJevFileMatchProcessTransport({ ...options, fetch }),
  );
  const createTransport = vi.fn<typeof createJevProcessTransport>((options) =>
    createJevProcessTransport({ ...options, fetch }),
  );
  const evaluate = (extra: Partial<Parameters<typeof evaluateJevSafety>[1]> = {}) =>
    evaluateJevSafety(input, {
      endpoint: ENDPOINT,
      operatingPoint: point,
      resolveFacts,
      createFileTransport,
      createTransport,
      ...extra,
    });
  return {
    input,
    point,
    bodies,
    fetch,
    resolveFacts,
    createFileTransport,
    createTransport,
    evaluate,
  };
}
beforeEach(() => {
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "synthetic-process-test-key");
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "conservative");
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("actual file matching then actual policy calls", () => {
  it("keeps two separate actual receipts and the lossless transcript without a synthetic risk head", async () => {
    const h = harness();
    const original = buildJevRequest(
      buildJevMetadata(h.input.toolName, h.input.input),
      facts(h.input).facts,
      h.input.config,
    );
    const decision = await h.evaluate();
    expect(decision.action, JSON.stringify(decision)).toBe("allow");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    expect(h.bodies[0].state).toEqual(original.state);
    expect(decision.jev?.process?.kind).toBe("all_heads");
    const process = decision.jev!.process!;
    if (process.kind !== "all_heads") throw new Error("Wrong actual process.");
    const prefix = process.fileStage!;
    expect(prefix.match!.evidence.requestId).toBe("actual-controlled-stage-1");
    expect(process.stage!.evidence.requestId).toBe("actual-controlled-stage-2");
    expect(decision.jev!.riskOrigin!.requestId).toBe("actual-controlled-stage-2");
    expect(prefix.selectedProbabilityFloor).toBe(0.99);
    const plan = prepareJevFileProcess(original, false);
    expect(
      decodeJevFileTranscript(
        plan,
        prefix.transcript!,
        decision.jev!.transportHash!,
        prefix.match!,
      ),
    ).toEqual(prefix.match);
    expect(hash(JSON.stringify(h.bodies[0]))).toBe(prefix.match!.evidence.requestHash);
    expect(hash(JSON.stringify(h.bodies[1]))).toBe(process.stage!.evidence.requestHash);
    const downstream = h.bodies[1] as JevRequest;
    for (const id of Object.keys(original.questions).filter((id) => id !== "file_policy"))
      expect(downstream.questions[id]).toEqual(original.questions[id]);
    expect(JSON.stringify(downstream.questions.file_policy!.instructions)).toContain(
      "Do not rematch raw patterns",
    );
    expect(h.bodies.every((body) => Buffer.byteLength(JSON.stringify(body)) <= 32768)).toBe(true);
    const bindings = [
      h.createFileTransport.mock.calls[0][0].binding,
      h.createTransport.mock.calls[0][0].binding,
    ];
    expect(bindings[0]).toEqual(bindings[1]);
    expect(bindings[0]!.protocolHash).toBe(jevRuntimeProtocolHash(h.point));
    expect(prefix.match!.evidence.transportHash).toBe(
      jevDecisionTransportBindingHash(ENDPOINT, h.point),
    );
  });
  it.each(["match", "no_match", "unknown"] as const)(
    "requires the captured floor for %s without treating it as a permission",
    async (choice) => {
      const conservative = harness(call(), { choice, selected: 0.51 });
      expect((await conservative.evaluate()).action).toBe("confirm");
      expect(conservative.bodies[1].state).toMatchObject({ fileMatch: expect.any(String) });
      const argmax = harness(call(), { choice, selected: 0.51, point: "argmax" });
      expect((await argmax.evaluate()).action).toBe("allow");
      const block = harness(call(), { choice, selected: 0.51, action: "block" });
      expect((await block.evaluate()).action).toBe("block");
    },
  );
  it("treats a tied selected head as a fallible premise under the conservative floor", async () => {
    const h = harness(call(), { choice: "unknown", selected: 0.5 });
    const result = await h.evaluate();
    expect(result.action).toBe("confirm");
    expect(result.jev!.process!.fileStage!.match!.answers.f_a).toMatchObject({
      choice: "unknown",
      confidence: 1,
      probabilities: { match: 0.5, no_match: 0, unknown: 0.5 },
    });
  });
  it("keeps all actual command stages and binds each to the same total deadline", async () => {
    const h = harness(call(true));
    const deadline = performance.now() + 10000;
    const decision = await h.evaluate({ deadline });
    expect(decision.action, JSON.stringify(decision)).toBe("allow");
    expect(h.bodies.map((body) => Object.keys(body.questions)[0])).toEqual([
      "f_a",
      "risk",
      "r_a",
      "command_policy",
    ]);
    expect(h.createFileTransport.mock.calls[0][0].deadline).toBe(deadline);
    expect(h.createTransport.mock.calls[0][0].deadline).toBe(deadline);
    const process = decision.jev!.process!;
    if (process.kind !== "command_stages") throw new Error("Wrong process.");
    expect(process.fileStage!.match!.evidence.requestId).toBe("actual-controlled-stage-1");
    expect(process.result.stages.map((stage) => stage.evidence.requestId)).toEqual([
      "actual-controlled-stage-2",
      "actual-controlled-stage-3",
      "actual-controlled-stage-4",
    ]);
    expect(decision.jev!.riskAnswer).toEqual(process.result.answers.risk);
    expect(process.result.distributionsCombined).toBe(false);
    expect(h.bodies[1].state).toHaveProperty("fileMatch");
    expect(h.bodies[2].state).not.toHaveProperty("fileMatch");
    expect(h.bodies[3].state).not.toHaveProperty("fileMatch");
  });
  it("selects exact legacy bytes for more than eight heads, before the match factory", async () => {
    const input = call();
    input.config.policies.rules = [
      ...readBundledConfig().policies.rules,
      {
        id: "independent-extra",
        enabled: false,
        protection: "none",
        behavior: "off",
        patterns: [{ pattern: "**" }],
        onlyIfExists: false,
      },
    ];
    const h = harness(input);
    const original = buildJevRequest(
      buildJevMetadata(input.toolName, input.input),
      facts(input).facts,
      input.config,
    );
    const decision = await h.evaluate();
    expect(decision.action, JSON.stringify(decision)).toBe("allow");
    expect(h.createFileTransport).not.toHaveBeenCalled();
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(h.bodies[0])).toBe(JSON.stringify(original));
    expect(decision.jev!.process!.fileStage!.format).toBe("legacy");
  });
  it("blocks an invalid complete original command route before either factory", async () => {
    const input = call(true);
    input.config.commandGate.patterns = Array.from({ length: 65 }, (_, n) => ({
      id: `command${n}`,
      pattern: `command${n}`,
      behavior: "block" as const,
    }));
    const h = harness(input);
    expect((await h.evaluate()).action).toBe("block");
    expect(h.createFileTransport).not.toHaveBeenCalled();
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(h.fetch).not.toHaveBeenCalled();
  });
});

describe("captured source context before every dispatch", () => {
  it.each(["input", "settings", "descriptor"] as const)(
    "stops first dispatch after %s changes during facts",
    async (field) => {
      const h = harness();
      const descriptor = { description: "Original supplied tool.", parameters: { type: "object" } };
      let fresh = true;
      h.resolveFacts.mockImplementationOnce(async () => {
        if (field === "input") h.input.input.path = "changed.txt";
        if (field === "settings") h.input.config.policies.rules[0].behavior = "off";
        if (field === "descriptor") descriptor.description = "Changed supplied tool.";
        fresh = false;
        return facts(call());
      });
      const result = await h.evaluate({ descriptor, recheckContext: () => fresh });
      expect(result.action).toBe("block");
      expect(h.createFileTransport).not.toHaveBeenCalled();
      expect(h.createTransport).not.toHaveBeenCalled();
      expect(h.fetch).not.toHaveBeenCalled();
    },
  );
  it("stops the policy factory after settings change during the first actual reply", async () => {
    let fresh = true;
    const h = harness(call(), {
      onReply: (ordinal) => {
        if (ordinal === 1) fresh = false;
      },
    });
    const decision = await h.evaluate({ recheckContext: () => fresh });
    expect(decision.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(decision.jev!.process!.kind).toBe("file_stages");
    expect(decision.jev!.process!.fileStage!.match!.evidence.requestId).toBe(
      "actual-controlled-stage-1",
    );
    expect(decision.jev!.riskOrigin).toBeUndefined();
    expect(decision.jev!.riskAnswer).toBeUndefined();
  });
  it("rechecks basic context again after a later facts await", async () => {
    const h = harness();
    let fresh = true;
    h.resolveFacts
      .mockImplementationOnce(async () => facts(h.input))
      .mockImplementationOnce(async () => {
        fresh = false;
        return facts(h.input);
      });
    expect((await h.evaluate({ recheckContext: () => fresh })).action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
  });
  it("stops a later command dispatch and retains an earlier actual block", async () => {
    let fresh = true;
    const h = harness(call(true), {
      action: "block",
      onReply: (ordinal) => {
        if (ordinal === 2) fresh = false;
      },
    });
    const result = await h.evaluate({ recheckContext: () => fresh });
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    const process = result.jev!.process!;
    if (process.kind !== "command_stages") throw new Error("Wrong process.");
    expect(process.result.actualBlocks.length).toBeGreaterThan(0);
    expect(process.result.stages.map((stage) => stage.evidence.requestId)).toEqual([
      "actual-controlled-stage-2",
    ]);
  });
  it("blocks observed fact changes after matching, with no retry or legacy request", async () => {
    const h = harness();
    h.resolveFacts
      .mockImplementationOnce(async () => facts(h.input))
      .mockImplementationOnce(async () => ({
        facts: { files: [{ ...file(), exists: false, kind: "unknown" }] },
      }));
    const result = await h.evaluate();
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
  });
  it("uses the original deadline for late context checks and creates no next transport", async () => {
    const h = harness();
    let checks = 0;
    const deadline = performance.now() + 50;
    const result = await h.evaluate({
      deadline,
      recheckContext: async () => {
        if (++checks > 2) await new Promise((resolve) => setTimeout(resolve, 75));
        return true;
      },
    });
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(result.jev!.process!.fileStage!.match).toBeDefined();
  });
  it("keeps an actual prefix receipt when synchronous cleanup fails", async () => {
    const h = harness();
    h.createFileTransport.mockImplementationOnce((options) => {
      const real = createJevFileMatchProcessTransport({ ...options, fetch: h.fetch });
      return {
        ...real,
        close: () => {
          real.close();
          throw new Error("Controlled cleanup failure.");
        },
      };
    });
    const result = await h.evaluate();
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(result.jev!.process!.fileStage).toMatchObject({
      cleanupFailed: true,
      matchTimingOrigin: "strict_validation",
      match: { evidence: { requestId: "actual-controlled-stage-1" } },
    });
  });
});

describe("truthful partial file process failures", () => {
  it("retains the complete bad reply hash without inventing a match or risk answer", async () => {
    const h = harness();
    const raw = JSON.stringify({
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      id: "synthetic-incomplete-file-response",
      answers: {
        f_a: {
          type: "choice",
          choice: "match",
          probabilities: { match: 1, no_match: 0, unknown: 0 },
          confidence: 1,
        },
      },
      usage: { input_tokens: 5, output_tokens: 2 },
    });
    h.fetch.mockImplementationOnce(async () => new Response(raw));
    const result = await h.evaluate();
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
    const prefix = result.jev!.process!.fileStage!;
    expect(prefix.match).toBeUndefined();
    expect(result.jev!.riskAnswer).toBeUndefined();
    expect(prefix.failureEvidence).toMatchObject({
      stage: "file_match",
      requestSent: true,
      responseComplete: true,
      requestHash: prefix.selection.matchRequestHash,
      responseHash: hash(raw),
      responseBytes: Buffer.byteLength(raw),
    });
  });
  it("keeps the actual match receipt after a later action reply fails strict coverage", async () => {
    const h = harness();
    const original = h.fetch.getMockImplementation()!;
    h.fetch.mockImplementationOnce(original).mockImplementationOnce(async () => new Response("{}"));
    const result = await h.evaluate();
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledTimes(2);
    const process = result.jev!.process!;
    if (process.kind !== "all_heads") throw new Error("Wrong process.");
    expect(process.fileStage!.match!.evidence.requestId).toBe("actual-controlled-stage-1");
    expect(process.completed).toBe(false);
    expect(process.stage).toBeUndefined();
    expect(process.failureEvidence).toMatchObject({
      stage: "all_heads",
      requestSent: true,
      responseComplete: true,
      responseHash: hash("{}"),
    });
    expect(result.jev!.riskOrigin).toBeUndefined();
  });
  it("retains a fully strict observed prefix after the outer cancellation race", async () => {
    const h = harness();
    const controller = new AbortController();
    h.createFileTransport.mockImplementationOnce((options) => {
      const real = createJevFileMatchProcessTransport({ ...options, fetch: h.fetch });
      return {
        ...real,
        requestFileMatch: async (body) => {
          const result = await real.requestFileMatch(body);
          controller.abort();
          return result;
        },
      };
    });
    const result = await h.evaluate({ signal: controller.signal });
    expect(result.action).toBe("block");
    expect(result.jev!.failure).toBe("cancelled");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createTransport).not.toHaveBeenCalled();
    expect(result.jev!.process!.fileStage).toMatchObject({
      completed: false,
      matchTimingOrigin: "strict_validation",
      match: { evidence: { requestId: "actual-controlled-stage-1" } },
    });
    expect(result.jev!.riskOrigin).toBeUndefined();
  });
  it("rechecks facts on the exact legacy route before later command dispatch", async () => {
    const input = call(true);
    input.config.policies.rules.push(
      ...Array.from({ length: 4 }, (_, n) => ({
        ...structuredClone(input.config.policies.rules[0]),
        id: `off-row-${n}`,
        enabled: false,
        behavior: "off" as const,
      })),
    );
    const h = harness(input, { action: "block" });
    h.resolveFacts
      .mockImplementationOnce(async () => facts(input))
      .mockImplementationOnce(async () => ({ facts: { files: [{ ...file(), exists: false }] } }));
    const result = await h.evaluate();
    expect(result.action).toBe("block");
    expect(h.fetch).toHaveBeenCalledOnce();
    expect(h.createFileTransport).not.toHaveBeenCalled();
    const process = result.jev!.process!;
    if (process.kind !== "command_stages") throw new Error("Wrong process.");
    expect(process.fileStage!.format).toBe("legacy");
    expect(process.result.actualBlocks.length).toBeGreaterThan(0);
    expect(process.result.stages.map((stage) => stage.stage)).toEqual(["non_command"]);
  });
});

describe("detached resolver arguments preserve original policy and input", () => {
  it.each(["initial", "later"] as const)(
    "preserves every original row when the %s resolver mutates its copies",
    async (phase) => {
      const h = harness();
      const originalInput = structuredClone(h.input.input);
      const originalConfig = structuredClone(h.input.config);
      const original = buildJevRequest(
        buildJevMetadata(h.input.toolName, originalInput),
        facts(h.input).facts,
        originalConfig,
      );
      const argumentsSeen: Parameters<
        NonNullable<NonNullable<Parameters<typeof evaluateJevSafety>[1]>["resolveFacts"]>
      >[0][] = [];
      h.resolveFacts.mockImplementation(async (options) => {
        argumentsSeen.push(options);
        expect(options.input).toEqual(originalInput);
        expect(options.config).toEqual(originalConfig);
        if (
          (phase === "initial" && argumentsSeen.length === 1) ||
          (phase === "later" && argumentsSeen.length > 1)
        ) {
          options.config.policies.rules.splice(0);
          options.input.path = "changed-private-operand.txt";
        }
        return structuredClone(facts(h.input));
      });
      const result = await h.evaluate();
      expect(result.action, JSON.stringify(result)).toBe("allow");
      expect(h.fetch).toHaveBeenCalledTimes(2);
      expect(argumentsSeen.length).toBeGreaterThan(1);
      expect(new Set(argumentsSeen.map((options) => options.input)).size).toBe(
        argumentsSeen.length,
      );
      expect(new Set(argumentsSeen.map((options) => options.config)).size).toBe(
        argumentsSeen.length,
      );
      expect(h.input.input).toEqual(originalInput);
      expect(h.input.config).toEqual(originalConfig);
      for (const wire of h.bodies) {
        expect((wire.state as any).policy.files).toEqual((original.state as any).policy.files);
        expect((wire.state as any).operation).toEqual((original.state as any).operation);
        expect(JSON.stringify(wire)).not.toContain("changed-private-operand.txt");
      }
      expect(result.jev!.process!.fileStage!.selection.originalRequestHash).toBe(
        hash(JSON.stringify(original)),
      );
      expect(result.jev!.inputHash).toBe(jevHash(originalInput));
      expect(result.jev!.policyHash).toBe(jevConfigHash(originalConfig));
    },
  );
});

describe("detached returned facts preserve original approval identity", () => {
  it.each(["staged", "legacy"] as const)(
    "keeps production display and session exclusion after a retained %s result changes",
    async (format) => {
      vi.spyOn(performance, "now").mockReturnValue(1000);
      const input = call();
      if (format === "legacy")
        input.config.policies.rules.push(
          ...Array.from({ length: 4 }, (_, n) => ({
            ...structuredClone(input.config.policies.rules[0]),
            id: `retained-off-${n}`,
            enabled: false,
            behavior: "off" as const,
          })),
        );
      const original: JevResolvedFacts = {
        ...facts(input),
        orgIdentity: "synthetic-production-identity",
      };
      original.facts.org = { type: "production", verified: true, explicit: true };
      const retained = structuredClone(original);
      const h = harness(input, {
        action: "confirm",
        onReply: (_ordinal, body) => {
          if (Object.hasOwn(body.questions, "risk")) {
            retained.facts.org!.type = "sandbox";
            retained.orgIdentity = "changed-synthetic-identity";
            retained.facts.files![0].path = "changed-after-wire.txt";
          }
        },
      });
      h.resolveFacts.mockImplementationOnce(async () => retained);
      h.resolveFacts.mockImplementation(async () => structuredClone(original));
      const baseline = harness(structuredClone(input), { action: "confirm" });
      baseline.resolveFacts.mockImplementation(async () => structuredClone(original));
      const expected = await baseline.evaluate();
      const decision = await h.evaluate();
      expect(decision.action, JSON.stringify(decision)).toBe("confirm");
      expect(decision.jev!.failure).toBeUndefined();
      expect(decision.jev!.process!.fileStage!.format).toBe(
        format === "legacy" ? "legacy" : "file_match_then_policy",
      );
      expect(decision.orgType).toBe("production");
      expect(decision.subject).toBe(expected.subject);
      expect(decision.subject).toContain("org=production (verified)");
      expect(decision.approvalScope!.detail).toContain("org=production (verified)");
      expect(decision.approvalScope!.allowSession).toBe(false);
      expect(decision.jev!.factsHash).toBe(jevFactBindingHash(original));
      expect(decision.jev!.factsHash).toBe(expected.jev!.factsHash);
      expect(h.bodies.map((body) => JSON.stringify(body))).toEqual(
        baseline.bodies.map((body) => JSON.stringify(body)),
      );
      expect(h.bodies.every((body) => JSON.stringify(body).includes('"type":"production"'))).toBe(
        true,
      );
      expect(retained.facts.org!.type).toBe("sandbox");
      expect(retained.facts.files![0].path).toBe("changed-after-wire.txt");
      expect(Object.isFrozen(retained)).toBe(false);
      expect(h.resolveFacts.mock.calls.length).toBeGreaterThan(1);
    },
  );

  it.each(["getter", "class", "proxy", "cycle"] as const)(
    "rejects a malformed returned %s before any transport factory",
    async (kind) => {
      const h = harness();
      const getter = vi.fn(() => facts(h.input).facts);
      const proxyGet = vi.fn((target: object, key: string | symbol, receiver: unknown) =>
        Reflect.get(target, key, receiver),
      );
      class UnsupportedResult {
        facts = facts(h.input).facts;
      }
      const result: JevResolvedFacts =
        kind === "class"
          ? new UnsupportedResult()
          : kind === "getter"
            ? (Object.defineProperty({}, "facts", {
                enumerable: true,
                get: getter,
              }) as JevResolvedFacts)
            : kind === "proxy"
              ? new Proxy<JevResolvedFacts>(facts(h.input), { get: proxyGet })
              : facts(h.input);
      if (kind === "cycle") (result.facts as any).cycle = result;
      h.resolveFacts.mockResolvedValueOnce(result);
      const decision = await h.evaluate();
      expect(decision.action).toBe("block");
      expect(decision.jev!.failure).toBe("invalid_request");
      expect(getter).not.toHaveBeenCalled();
      expect(proxyGet.mock.calls.every(([, key]) => key === "then")).toBe(true);
      expect(h.fetch).not.toHaveBeenCalled();
      expect(h.createTransport).not.toHaveBeenCalled();
      expect(h.createFileTransport).not.toHaveBeenCalled();
    },
  );
});
