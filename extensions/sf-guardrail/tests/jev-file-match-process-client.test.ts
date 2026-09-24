/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJevFileMatchProcessTransport,
  createJevFileMatchTransport,
  createJevProcessTransport,
  JevClientError,
  JevFileMatchClientError,
  JEV_FILE_MATCH_PROCESS_PROTOCOL,
  JEV_FILE_MATCH_PROTOCOL,
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_TRANSPORT_BINDING_CONTRACT,
} from "../lib/jev-client.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { jevOperatingPointHash, resolveJevOperatingPoint } from "../lib/jev-operating-point.ts";
import type {
  JevAllHeadRequest,
  JevFileMatchChoice,
  JevFileMatchProcessTransportBinding,
  JevFileMatchQuestionId,
  JevFileMatchRequest,
  JevFileMatchStageResult,
} from "../lib/types.ts";

const files = vi.hoisted(() => ({
  openSync: vi.fn(() => {
    throw new Error("No key-file access is allowed in this test.");
  }),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  openSync: files.openSync,
}));

const KEY = "sk-test-file-stage-candidate-only";
const ENDPOINT = "https://file-stage.example.test/decisions";
const LABELS: JevFileMatchChoice[] = ["match", "no_match", "unknown"];
let clients: Array<{ close(): void }>;
function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function binding(name: "conservative" | "argmax" = "conservative") {
  const point = resolveJevOperatingPoint(name);
  const operatingPointHash = jevOperatingPointHash(point);
  return {
    protocolHash: jevHash({ fileMatching: JEV_FILE_MATCH_PROCESS_PROTOCOL, operatingPointHash }),
    operatingPointHash,
  };
}
function transportHash(processBinding = binding()) {
  return jevHash({ contract: JEV_TRANSPORT_BINDING_CONTRACT, endpoint: ENDPOINT, processBinding });
}
function request(rowCount = 1): JevFileMatchRequest {
  const record = {
    path: "workspace/synthetic.record",
    relativePath: "workspace/synthetic.record",
    exists: "unknown",
    kind: "unknown",
  };
  const rows = Array.from({ length: rowCount }, (_, rowOrdinal) => ({
    id: `synthetic-row-${rowOrdinal}`,
    enabled: false,
    patterns: [{ pattern: "workspace/**" }],
    allowedPatterns: [],
    protection: "noAccess",
    onlyIfExists: true,
    behavior: "off",
    restrictedAccess: ["read", "write", "shell"],
  }));
  const questions: JevFileMatchRequest["questions"] = {};
  for (const [rowOrdinal, row] of rows.entries()) {
    for (const [listOrdinal, listName] of (["patterns", "allowedPatterns"] as const).entries()) {
      const id =
        `f_${String.fromCharCode(97 + rowOrdinal * 2 + listOrdinal)}` as JevFileMatchQuestionId;
      questions[id] = {
        type: "choice",
        instructions: {
          question: "Does this synthetic record match this row's named list?",
          recordOrdinal: 0,
          rowOrdinal,
          listName,
          record: structuredClone(record),
          row: structuredClone(row),
          boundary: "Classify matching only.",
          matchingGrammar: "Use the supplied synthetic matching grammar.",
          scope: "Use the complete supplied operands.",
          empty: "An empty list has no matching item.",
        },
        criteria: { match: "Match.", no_match: "No match.", unknown: "Unresolved match." },
      };
    }
  }
  return {
    model: JEV_MODEL,
    provider: { only: ["typesafe"], allow_fallbacks: false },
    state: {
      version: 6,
      operation: { toolName: "read", metadata: { fileAccess: "read" } },
      facts: { files: [record] },
      policy: { files: rows },
      observations: { contextComplete: false },
    },
    questions,
  };
}
function reply(value = request()) {
  return {
    id: "gen-synthetic-file-stage",
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    answers: Object.fromEntries(
      Object.keys(value.questions).map((id, index) => {
        const choice = LABELS[(index + 2) % LABELS.length];
        return [
          id,
          {
            type: "choice",
            choice,
            probabilities: Object.fromEntries(
              LABELS.map((label) => [
                label,
                label === choice
                  ? 0.970123
                  : label === LABELS[(LABELS.indexOf(choice) + 1) % LABELS.length]
                    ? 0.019877
                    : 0.01,
              ]),
            ) as Record<JevFileMatchChoice, number>,
            confidence: 0.4567890123,
          },
        ];
      }),
    ),
    usage: { input_tokens: 23, output_tokens: 11, cost: 0.000987654321 },
  };
}
function fetchReply(value: unknown = reply()) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value)));
}
function client(
  fetch: typeof globalThis.fetch,
  options: Partial<Parameters<typeof createJevFileMatchProcessTransport>[0]> = {},
) {
  const value = createJevFileMatchProcessTransport({
    deadline: performance.now() + 9_900,
    endpoint: ENDPOINT,
    binding: binding(),
    fetch,
    ...options,
  });
  clients.push(value);
  return value;
}
beforeEach(() => {
  clients = [];
  files.openSync.mockClear();
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
});
afterEach(() => {
  clients.forEach((value) => value.close());
  expect(files.openSync).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("file matching with the actual decision process binding", () => {
  it("exports a frozen process contract and retains the diagnostic contract", () => {
    function frozen(value: unknown) {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(frozen);
    }
    frozen(JEV_FILE_MATCH_PROCESS_PROTOCOL);
    expect(JEV_FILE_MATCH_PROCESS_PROTOCOL).toMatchObject({
      stage: "file_match",
      answerChoices: LABELS,
      questionLimit: 8,
      bindingFields: ["protocolHash", "operatingPointHash"],
      transportBinding: "ordinary-decision-process-binding",
      maxRequestBytes: 32_768,
      maxResponseBytes: 65_536,
      totalTimeoutMs: 10_000,
      policyAction: false,
    });
    expect(JEV_FILE_MATCH_PROTOCOL.bindingFields).toEqual(["protocolHash", "diagnosticHash"]);
    expect(jevHash(JEV_FILE_MATCH_PROTOCOL)).not.toBe(jevHash(JEV_FILE_MATCH_PROCESS_PROTOCOL));
  });

  it.each(["conservative", "argmax"] as const)(
    "binds file and actual action receipts to one %s point",
    async (name) => {
      const processBinding = binding(name);
      const value = request();
      const body = JSON.stringify(value);
      const actualReply = reply(value);
      const raw = ` \n${JSON.stringify(actualReply)}\n`;
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
      const transport = client(fetch, { binding: processBinding });
      expect(Object.keys(transport)).toEqual(["requestFileMatch", "getObservedResult", "close"]);
      expect(fetch).not.toHaveBeenCalled();
      const result = await transport.requestFileMatch(value);
      expect(result).toMatchObject({
        stage: "file_match",
        answers: {
          f_a: {
            choice: "unknown",
            probabilities: { match: 0.019877, no_match: 0.01, unknown: 0.970123 },
            confidence: 0.4567890123,
          },
        },
        evidence: {
          requestedQuestionIds: ["f_a", "f_b"],
          requestHash: hash(body),
          requestBytes: Buffer.byteLength(body),
          responseHash: hash(raw),
          responseBytes: Buffer.byteLength(raw),
          transportHash: transportHash(processBinding),
          model: JEV_RESOLVED_MODEL,
          provider: JEV_PROVIDER,
          requestId: actualReply.id,
          usage: actualReply.usage,
        },
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0]).toMatchObject([
        ENDPOINT,
        { body, redirect: "error", headers: { Authorization: `Bearer ${KEY}` } },
      ]);
      expect(result.answers).not.toHaveProperty("risk");
      expect(result).not.toHaveProperty("gate");

      const actionRequest: JevAllHeadRequest = {
        model: JEV_MODEL,
        provider: { only: ["typesafe"], allow_fallbacks: false },
        state: { synthetic: true },
        questions: {
          risk: {
            type: "choice",
            instructions: "Choose the synthetic action.",
            criteria: { allow: "Allow.", confirm: "Confirm.", block: "Block." },
          },
        },
      };
      const actionFetch = fetchReply({
        id: "gen-synthetic-action-stage",
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        answers: {
          risk: {
            type: "choice",
            choice: "block",
            probabilities: { allow: 0.01, confirm: 0.02, block: 0.97 },
            confidence: 0.7123456789,
          },
        },
        usage: { input_tokens: 7, output_tokens: 5 },
      });
      const decisionTransport = createJevProcessTransport({
        deadline: performance.now() + 9_900,
        endpoint: ENDPOINT,
        fetch: actionFetch,
        binding: processBinding,
      });
      clients.push(decisionTransport);
      const action = await decisionTransport.requestAllHeads(actionRequest);
      expect(action.evidence.transportHash).toBe(result.evidence.transportHash);
      expect(action.answers.risk.choice).toBe("block");
      expect(actionFetch).toHaveBeenCalledOnce();
    },
  );

  it("retains all eight ordered operands without deciding eligibility or action", async () => {
    const value = request(4);
    const fetch = fetchReply(reply(value));
    const result = await client(fetch).requestFileMatch(value);
    expect(Object.keys(result.answers)).toEqual([
      "f_a",
      "f_b",
      "f_c",
      "f_d",
      "f_e",
      "f_f",
      "f_g",
      "f_h",
    ]);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(value));
    expect(result.answers.f_a.choice).toBe("unknown");
  });

  it("captures the binding once and reads credentials lazily once per factory", async () => {
    const processBinding = binding();
    const expectedHash = transportHash(processBinding);
    const getBinding = vi.fn(() => processBinding);
    const fetch = fetchReply();
    const options = { deadline: performance.now() + 9_900, endpoint: ENDPOINT, fetch };
    Object.defineProperty(options, "binding", { get: getBinding, enumerable: true });
    const transport = createJevFileMatchProcessTransport(
      options as typeof options & { binding: JevFileMatchProcessTransportBinding },
    );
    clients.push(transport);
    expect(getBinding).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    processBinding.protocolHash = "c".repeat(64);
    processBinding.operatingPointHash = "d".repeat(64);
    const first = await transport.requestFileMatch(request());
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "sk-test-different-synthetic-key");
    const second = await transport.requestFileMatch(request());
    expect(first.evidence.transportHash).toBe(expectedHash);
    expect(second.evidence.transportHash).toBe(expectedHash);
    expect(getBinding).toHaveBeenCalledOnce();
    expect(fetch.mock.calls.map(([, init]) => init.headers)).toEqual([
      { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
    ]);
  });

  it.each(["protocolHash", "operatingPointHash"] as const)(
    "changes identity when %s changes",
    async (field) => {
      const first = await client(fetchReply()).requestFileMatch(request());
      const changed = { ...binding(), [field]: "e".repeat(64) };
      const second = await client(fetchReply(), { binding: changed }).requestFileMatch(request());
      expect(second.evidence.transportHash).toBe(transportHash(changed));
      expect(second.evidence.transportHash).not.toBe(first.evidence.transportHash);
    },
  );

  it("keeps the diagnostic route and hash separate", async () => {
    const diagnosticBinding = { protocolHash: "a".repeat(64), diagnosticHash: "b".repeat(64) };
    const transport = createJevFileMatchTransport({
      deadline: performance.now() + 9_900,
      endpoint: ENDPOINT,
      fetch: fetchReply(),
      binding: diagnosticBinding,
    });
    clients.push(transport);
    const result = await transport.requestFileMatch(request());
    expect(result.evidence.transportHash).toBe(
      jevHash({ contract: JEV_FILE_MATCH_PROTOCOL, endpoint: ENDPOINT, diagnosticBinding }),
    );
    expect(result.evidence.transportHash).not.toBe(transportHash());
  });
});

describe("strict process factory controls", () => {
  it.each([
    () => undefined,
    () => null,
    () => ({ protocolHash: "a".repeat(64), diagnosticHash: "b".repeat(64) }),
    () => ({ ...binding(), diagnosticHash: "b".repeat(64) }),
    () => ({ ...binding(), extra: true }),
    () => ({ ...binding(), protocolHash: "A".repeat(64) }),
    () => ({ ...binding(), operatingPointHash: "b".repeat(63) }),
    () => ({ ...binding(), operatingPointHash: 1 }),
    () => Object.assign(Object.create({ inherited: true }), binding()),
    () => Object.defineProperty(binding(), "protocolHash", { enumerable: false }),
    () => ({ ...binding(), [Symbol("extra")]: true }),
  ])("rejects bad binding %s before endpoint or credentials", (build) => {
    const getEndpoint = vi.fn(() => ENDPOINT);
    const fetch = fetchReply();
    const options = { deadline: performance.now() + 9_900, fetch, binding: build() };
    Object.defineProperty(options, "endpoint", { get: getEndpoint, enumerable: true });
    expect(() =>
      createJevFileMatchProcessTransport(
        options as Parameters<typeof createJevFileMatchProcessTransport>[0],
      ),
    ).toThrow(expect.objectContaining({ code: "invalid_request" }));
    expect(getEndpoint).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a binding accessor without invoking it", () => {
    const getHash = vi.fn(() => "a".repeat(64));
    const processBinding = binding();
    Object.defineProperty(processBinding, "protocolHash", { get: getHash, enumerable: true });
    expect(() => client(fetchReply(), { binding: processBinding })).toThrow(JevClientError);
    expect(getHash).not.toHaveBeenCalled();
  });

  it.each(["decision", "binary", "over_cap"] as const)(
    "rejects %s requests without dispatch",
    async (kind) => {
      const value = kind === "over_cap" ? request(5) : request();
      if (kind === "decision")
        value.questions = {
          risk: {
            type: "choice",
            instructions: "Choose an action.",
            criteria: { allow: "Allow.", confirm: "Ask.", block: "Block." },
          },
        } as unknown as JevFileMatchRequest["questions"];
      if (kind === "binary") delete value.questions.f_a.criteria.unknown;
      const fetch = fetchReply();
      const error = await client(fetch)
        .requestFileMatch(value)
        .catch((caught) => caught);
      expect(error).toBeInstanceOf(JevFileMatchClientError);
      expect(error).toMatchObject({
        code: "invalid_request",
        evidence: { stage: "file_match", requestSent: false, transportHash: transportHash() },
      });
      expect(error.observedResult).toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects complete request overflow before a credential read", async () => {
    const value = request();
    (value.state as Record<string, unknown>).padding = "x".repeat(32_768);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid");
    const fetch = fetchReply();
    const error = await client(fetch)
      .requestFileMatch(value)
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "invalid_request",
      evidence: { requestSent: false, requestedQuestionIds: [], transportHash: transportHash() },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["duplicate", "reordered", "extra"] as const)(
    "rejects %s actual raw coverage without retaining answers",
    async (kind) => {
      const value = reply();
      if (kind === "reordered") value.answers = { f_b: value.answers.f_b, f_a: value.answers.f_a };
      if (kind === "extra") value.answers.extra = value.answers.f_a;
      const raw =
        kind === "duplicate"
          ? JSON.stringify(value).replace('"f_a":', '"f_a":{},"f_a":')
          : JSON.stringify(value);
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
      const transport = client(fetch);
      const error = await transport.requestFileMatch(request()).catch((caught) => caught);
      expect(error).toBeInstanceOf(JevFileMatchClientError);
      expect(error).toMatchObject({
        code: "invalid_response",
        evidence: {
          stage: "file_match",
          responseComplete: true,
          responseHash: hash(raw),
          responseBytes: Buffer.byteLength(raw),
          transportHash: transportHash(),
        },
      });
      expect(error.observedResult).toBeUndefined();
      expect(transport.getObservedResult()).toBeUndefined();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("rejects observed redirects without retry or fallback", async () => {
    const response = new Response(JSON.stringify(reply()));
    Object.defineProperty(response, "redirected", { value: true });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);
    const error = await client(fetch)
      .requestFileMatch(request())
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: { transportHash: transportHash(), requestSent: true },
    });
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].redirect).toBe("error");
  });

  it("uses the original absolute ten-second caller deadline after idle time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const transport = client(fetch, { deadline: 10_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    const settled = transport.requestFileMatch(request()).catch((caught) => caught);
    await vi.advanceTimersByTimeAsync(5_999);
    expect(transport.getObservedResult()).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1);
    const error = await settled;
    expect(error).toMatchObject({
      code: "timeout",
      evidence: {
        stage: "file_match",
        latencyMs: 6_000,
        requestSent: true,
        transportHash: transportHash(),
      },
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("retains immutable raw heads and process origins if synchronous cleanup reaches the deadline", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const raw = JSON.stringify(reply());
    let observedAtCancel: JevFileMatchStageResult | undefined;
    const reader = {
      read: vi
        .fn()
        .mockResolvedValueOnce({ done: false, value: Buffer.from(raw) })
        .mockResolvedValueOnce({ done: true }),
      cancel: vi.fn(() => {
        observedAtCancel = transport.getObservedResult();
        now = 10_000;
        return Promise.resolve();
      }),
    };
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers(),
          body: { getReader: () => reader },
        }) as unknown as Response,
    );
    const transport = client(fetch, { deadline: 10_000 });
    const error = await transport.requestFileMatch(request()).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevFileMatchClientError);
    expect(error).toMatchObject({
      code: "timeout",
      evidence: { responseComplete: true, responseHash: hash(raw), transportHash: transportHash() },
    });
    expect(error.observedResult).toBe(observedAtCancel);
    expect(observedAtCancel.answers.f_a.choice).toBe("unknown");
    expect(observedAtCancel.answers.f_a.probabilities.unknown).toBe(0.970123);
    expect(observedAtCancel.evidence).toMatchObject({
      requestId: "gen-synthetic-file-stage",
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      responseHash: hash(raw),
      transportHash: transportHash(),
      usage: reply().usage,
    });
    expect(Object.isFrozen(observedAtCancel.answers.f_a.probabilities)).toBe(true);
    expect(Object.isFrozen(observedAtCancel.evidence.usage)).toBe(true);
    expect(Object.isFrozen(observedAtCancel.evidence.requestedQuestionIds)).toBe(true);
    transport.close();
    expect(transport.getObservedResult()).toBe(observedAtCancel);
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
