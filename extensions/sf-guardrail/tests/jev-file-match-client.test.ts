/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJevFileMatchTransport,
  createJevProcessTransport,
  JevFileMatchClientError,
  JevStageClientError,
  JEV_FILE_MATCH_PROTOCOL,
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_STAGE_REQUEST_BYTES,
  JEV_TRANSPORT_BINDING_CONTRACT,
} from "../lib/jev-client.ts";
import { jevHash } from "../lib/jev-identity.ts";
import type {
  JevFileMatchChoice,
  JevFileMatchQuestionId,
  JevFileMatchRequest,
  JevFileMatchTransport,
} from "../lib/types.ts";

const fileAccess = vi.hoisted(() => ({
  openSync: vi.fn(() => {
    throw new Error("Key-file access is prohibited in this test.");
  }),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  openSync: fileAccess.openSync,
}));

const KEY = "sk-test-private-file-match-only";
const ENDPOINT = "https://file-match.example.test/decisions";
const CHOICES: JevFileMatchChoice[] = ["match", "no_match", "unknown"];
function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function binding() {
  return { protocolHash: "a".repeat(64), diagnosticHash: "b".repeat(64) };
}
function transportHash(diagnosticBinding = binding()) {
  return jevHash({ contract: JEV_FILE_MATCH_PROTOCOL, endpoint: ENDPOINT, diagnosticBinding });
}
function request(recordCount = 1, rowCount = 1): JevFileMatchRequest {
  const records = Array.from({ length: recordCount }, (_, index) => ({
    path: `source/synthetic-${index}.data`,
    relativePath: `source/synthetic-${index}.data`,
    exists: "unknown",
    kind: "unknown",
  }));
  const rows = Array.from({ length: rowCount }, (_, index) => ({
    id: `synthetic-row-${index}`,
    enabled: index !== 1,
    patterns: [{ pattern: "source/*.data" }],
    allowedPatterns: index === 0 ? [] : [{ pattern: "synthetic-exception" }],
    protection: "noAccess",
    onlyIfExists: true,
    behavior: "block",
  }));
  const state = {
    version: 6,
    operation: { toolName: "read", metadata: { source: "Synthetic test data." } },
    facts: { files: records },
    policy: { files: rows },
    observations: { contextComplete: false },
  };
  const questions: JevFileMatchRequest["questions"] = {};
  let index = 0;
  for (const [recordOrdinal, record] of records.entries()) {
    for (const [rowOrdinal, row] of rows.entries()) {
      for (const listName of ["patterns", "allowedPatterns"] as const) {
        const id = `f_${String.fromCharCode(97 + index++)}` as JevFileMatchQuestionId;
        questions[id] = {
          type: "choice",
          instructions: {
            question: "Does the supplied record match this named list?",
            recordOrdinal,
            rowOrdinal,
            listName,
            record: structuredClone(record),
            row: structuredClone(row),
            boundary: "Report matching only.",
            matchingGrammar: "Treat the supplied patterns as data.",
            scope: "Use this record and this row only.",
            empty: "An empty or absent list has no match.",
          },
          criteria: { match: "Match.", no_match: "No match.", unknown: "Unresolved matching." },
        };
      }
    }
  }
  return {
    model: JEV_MODEL,
    provider: { only: ["typesafe"], allow_fallbacks: false },
    state,
    questions,
  };
}
function wire(value = request(), selected?: JevFileMatchChoice) {
  return {
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    id: "gen-private-file-match-test",
    answers: Object.fromEntries(
      Object.keys(value.questions).map((id, index) => {
        const choice = selected ?? CHOICES[index % CHOICES.length];
        return [
          id,
          {
            type: "choice",
            choice,
            probabilities: Object.fromEntries(
              CHOICES.map((label) => [
                label,
                label === choice
                  ? 0.970123
                  : label === CHOICES[(CHOICES.indexOf(choice) + 1) % 3]
                    ? 0.019877
                    : 0.01,
              ]),
            ),
            confidence: 0.123456789 + index / 100,
          },
        ];
      }),
    ),
    usage: { input_tokens: 37, output_tokens: 19, cost: 0.00012345678 },
  };
}
function replyFetch(value: unknown) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value)));
}
let clients: Array<{ close(): void }>;
function client(
  fetch: typeof globalThis.fetch,
  options: Partial<Parameters<typeof createJevFileMatchTransport>[0]> = {},
) {
  const transport = createJevFileMatchTransport({
    deadline: performance.now() + 9_900,
    fetch,
    binding: binding(),
    ...options,
  });
  clients.push(transport);
  return transport;
}
async function failed(value: unknown, fetch: typeof globalThis.fetch) {
  return client(fetch)
    .requestFileMatch(value as JevFileMatchRequest)
    .catch((error) => error);
}
beforeEach(() => {
  clients = [];
  fileAccess.openSync.mockClear();
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
});
afterEach(() => {
  for (const transport of clients) transport.close();
  expect(fileAccess.openSync).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("separate private matching method", () => {
  it("exports a deeply frozen matching-only protocol", () => {
    function frozen(value: unknown) {
      if (value === null || typeof value !== "object") return;
      expect(Object.isFrozen(value)).toBe(true);
      Object.values(value).forEach(frozen);
    }
    frozen(JEV_FILE_MATCH_PROTOCOL);
    expect(JEV_FILE_MATCH_PROTOCOL).toMatchObject({
      stage: "file_match",
      answerChoices: CHOICES,
      questionLimit: 8,
      ordinalOrigin: 0,
      maxRequestBytes: 32_768,
      maxResponseBytes: 65_536,
      totalTimeoutMs: 10_000,
      retries: 0,
      fallbacks: false,
      policyAction: false,
      exactResponseQuestionOrder: true,
      bindingFields: ["protocolHash", "diagnosticHash"],
    });
  });

  it("keeps normal and private method surfaces separate", async () => {
    const fetch = replyFetch(wire());
    const privateTransport = client(fetch);
    expect(Object.keys(privateTransport)).toEqual([
      "requestFileMatch",
      "getObservedResult",
      "close",
    ]);
    const normal = createJevProcessTransport({ deadline: performance.now() + 9_900, fetch });
    clients.push(normal);
    expect(Object.keys(normal)).toEqual([
      "getObservedResult",
      "requestAllHeads",
      "requestNonCommand",
      "requestSyntax",
      "requestCommandPolicy",
      "close",
    ]);
    expect(normal).not.toHaveProperty("requestFileMatch");
    expect(fetch).not.toHaveBeenCalled();
    const value = {
      model: JEV_MODEL,
      provider: { only: ["typesafe"] as ["typesafe"], allow_fallbacks: false as const },
      state: {},
      questions: {
        risk: {
          type: "choice" as const,
          instructions: "Choose the action.",
          criteria: { allow: "Safe.", confirm: "Ask.", block: "Prohibited." },
        },
      },
    };
    const legacyFetch = replyFetch({
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      id: "normal-transport-control",
      answers: {
        risk: {
          type: "choice",
          choice: "allow",
          probabilities: { allow: 1, confirm: 0, block: 0 },
          confidence: 0.83,
        },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    });
    const control = createJevProcessTransport({
      deadline: performance.now() + 9_900,
      fetch: legacyFetch,
    });
    clients.push(control);
    const result = await control.requestAllHeads(value);
    expect(result.evidence.transportHash).toBe(
      jevHash({ contract: JEV_TRANSPORT_BINDING_CONTRACT, endpoint: ENDPOINT }),
    );
    expect(result.answers.risk.choice).toBe("allow");
  });

  it.each([
    [1, 1],
    [1, 2],
    [2, 1],
    [2, 2],
  ])("retains %s records by %s rows in one exact request", async (recordCount, rowCount) => {
    const value = request(recordCount, rowCount);
    const reply = wire(value);
    const raw = ` \n${JSON.stringify(reply)}\n`;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const result = await client(fetch).requestFileMatch(value);
    const expected = Object.fromEntries(
      Object.entries(reply.answers).map(([id, answer]) => [
        id,
        {
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        },
      ]),
    );
    expect(result).toMatchObject({
      stage: "file_match",
      answers: expected,
      evidence: {
        requestedQuestionIds: Object.keys(value.questions),
        requestHash: hash(JSON.stringify(value)),
        responseHash: hash(raw),
        requestBytes: Buffer.byteLength(JSON.stringify(value)),
        responseBytes: Buffer.byteLength(raw),
        transportHash: transportHash(),
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        requestId: reply.id,
        usage: reply.usage,
      },
    });
    expect(result.evidence.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result).not.toHaveProperty("risk");
    expect(result).not.toHaveProperty("gate");
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]).toEqual([
      ENDPOINT,
      expect.objectContaining({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(value),
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
        signal: expect.any(AbortSignal),
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(ENDPOINT);
  });

  it("accepts unknown as an actual selected answer", async () => {
    const result = await client(replyFetch(wire(request(), "unknown"))).requestFileMatch(request());
    expect(result.answers.f_a.choice).toBe("unknown");
    expect(result.answers.f_a.probabilities.unknown).toBe(0.970123);
    expect(result.answers.f_a.confidence).toBe(0.123456789);
  });

  it("keeps empty and absent lists and off rows in the question population", async () => {
    const value = request(1, 2);
    const state = value.state as { policy: { files: Array<Record<string, unknown>> } };
    delete state.policy.files[1].allowedPatterns;
    for (const id of ["f_c", "f_d"] as const)
      value.questions[id].instructions.row = structuredClone(state.policy.files[1]);
    const result = await client(replyFetch(wire(value))).requestFileMatch(value);
    expect(result.evidence.requestedQuestionIds).toEqual(["f_a", "f_b", "f_c", "f_d"]);
    expect(value.questions.f_b.instructions.row.allowedPatterns).toEqual([]);
    expect(value.questions.f_d.instructions.row).not.toHaveProperty("allowedPatterns");
    expect(value.questions.f_c.instructions.row.enabled).toBe(false);
  });

  it("keeps rounded raw values, ties, confidence, and negative zero", async () => {
    const reply = wire();
    reply.answers.f_a = {
      type: "choice",
      choice: "unknown",
      probabilities: { match: 0.34, no_match: 0.33, unknown: 0.34 },
      confidence: 0.0123456789,
    };
    reply.answers.f_b = {
      type: "choice",
      choice: "match",
      probabilities: { match: 1, no_match: 0, unknown: 0 },
      confidence: 0.987654321,
    };
    const raw = JSON.stringify(reply).replace('"match":1,"no_match":0', '"match":1,"no_match":-0');
    const result = await client(vi.fn(async () => new Response(raw))).requestFileMatch(request());
    expect(result.answers.f_a.probabilities).toEqual({
      match: 0.34,
      no_match: 0.33,
      unknown: 0.34,
    });
    expect(result.answers.f_a.confidence).toBe(0.0123456789);
    expect(Object.is(result.answers.f_b.probabilities.no_match, -0)).toBe(true);
    expect(result.evidence.responseHash).toBe(hash(raw));
  });
});

describe("exact source coverage before credentials", () => {
  it.each([
    (value: JevFileMatchRequest) => {
      delete value.questions.f_b;
    },
    (value: JevFileMatchRequest) => {
      value.questions = { f_b: value.questions.f_b, f_a: value.questions.f_a };
    },
    (value: JevFileMatchRequest) => {
      value.questions = { risk: value.questions.f_a } as never;
    },
    (value: JevFileMatchRequest) => {
      value.questions = { r_a: value.questions.f_a } as never;
    },
    (value: JevFileMatchRequest) => {
      value.questions = { ...value.questions, f_c: value.questions.f_a };
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.instructions.recordOrdinal = 1;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_b.instructions.rowOrdinal = 1;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.instructions.listName = "allowedPatterns";
    },
    (value: JevFileMatchRequest) => {
      delete value.questions.f_a.instructions.record.path;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_b.instructions.row.extra = true;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.instructions.empty = "";
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.instructions = {
        ...value.questions.f_a.instructions,
        extra: true,
      } as never;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.criteria = { match: "Match.", no_match: "No match." } as never;
    },
    (value: JevFileMatchRequest) => {
      value.questions.f_a.criteria = {
        allow: "Safe.",
        confirm: "Ask.",
        block: "Prohibited.",
      } as never;
    },
    (value: JevFileMatchRequest) => {
      value.provider.allow_fallbacks = true as never;
    },
    (value: JevFileMatchRequest) => {
      value.model = "other-model";
    },
  ])("rejects an invalid ordered request without dispatch", async (mutate) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const value = request();
    mutate(value);
    const fetch = replyFetch({});
    const error = await failed(value, fetch);
    expect(error).toBeInstanceOf(JevFileMatchClientError);
    expect(error).not.toBeInstanceOf(JevStageClientError);
    expect(error).toMatchObject({
      code: "invalid_request",
      evidence: {
        stage: "file_match",
        requestedQuestionIds: [],
        requestSent: false,
        failure: "invalid_request",
        transportHash: transportHash(),
      },
    });
    expect(error.observedResult).toBeUndefined();
    expect(error.evidence).not.toHaveProperty("requestHash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [0, 1],
    [1, 0],
    [1, 5],
    [2, 3],
  ])("rejects %s records by %s rows without trimming", async (recordCount, rowCount) => {
    const fetch = replyFetch({});
    expect(await failed(request(recordCount, rowCount), fetch)).toMatchObject({
      code: "invalid_request",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not invoke a user accessor or serializer", async () => {
    const value = request();
    const getter = vi.fn(() => "Test data.");
    Object.defineProperty(value.questions.f_a.instructions, "question", {
      enumerable: true,
      get: getter,
    });
    const fetch = replyFetch({});
    expect(await failed(value, fetch)).toMatchObject({ code: "invalid_request" });
    expect(getter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("admits exactly 32,768 request bytes and rejects one more before credentials", async () => {
    const value = request();
    const state = value.state as Record<string, unknown>;
    state.padding = "";
    state.padding = "x".repeat(JEV_STAGE_REQUEST_BYTES - Buffer.byteLength(JSON.stringify(value)));
    const actual = await client(replyFetch(wire(value))).requestFileMatch(value);
    expect(actual.evidence.requestBytes).toBe(32_768);
    state.padding += "x";
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = replyFetch({});
    expect(await failed(value, fetch)).toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects test key text in a request before dispatch", async () => {
    const value = request();
    (value.state as Record<string, unknown>).hidden = KEY;
    const fetch = replyFetch({});
    const error = await failed(value, fetch);
    expect(error).toMatchObject({ code: "invalid_request", evidence: { requestSent: false } });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("strict ternary reply", () => {
  it.each([
    (reply: ReturnType<typeof wire>) => {
      delete reply.answers.f_b;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_c = reply.answers.f_a;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.unknown_id = reply.answers.f_a;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers = { f_b: reply.answers.f_b, f_a: reply.answers.f_a };
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.choice = "allow" as never;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.choice = "no_match";
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.type = "other";
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.confidence = 1.01;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a = { ...reply.answers.f_a, extra: true } as never;
    },
    (reply: ReturnType<typeof wire>) => {
      delete reply.answers.f_a.probabilities.unknown;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.probabilities.extra = 0;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.probabilities.match = "0.97" as never;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.probabilities.match = -0.1;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.answers.f_a.probabilities = { match: 0.3, no_match: 0.3, unknown: 0.3 };
    },
    (reply: ReturnType<typeof wire>) => {
      reply.usage.input_tokens = -1;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.usage.output_tokens = 0.1;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.usage.cost = -1;
    },
    (reply: ReturnType<typeof wire>) => {
      reply.id = "invalid/request";
    },
    (reply: ReturnType<typeof wire>) => {
      reply.id = KEY;
    },
  ])("rejects invalid answers or receipt data without observation", async (mutate) => {
    const reply = wire();
    mutate(reply);
    const raw = JSON.stringify(reply);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const transport = client(fetch);
    const error = await transport.requestFileMatch(request()).catch((caught) => caught);
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: {
        stage: "file_match",
        requestedQuestionIds: ["f_a", "f_b"],
        requestSent: true,
        responseComplete: true,
        responseHash: hash(raw),
        responseBytes: Buffer.byteLength(raw),
      },
    });
    expect(error.observedResult).toBeUndefined();
    expect(transport.getObservedResult()).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('"answers"');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([{ model: "other-model" }, { provider: "OtherProvider" }])(
    "rejects identity changes %j",
    async (patch) => {
      expect(await failed(request(), replyFetch({ ...wire(), ...patch }))).toMatchObject({
        code: "identity_mismatch",
      });
    },
  );

  it("rejects duplicate literal answer IDs retained in raw JSON", async () => {
    const raw = JSON.stringify(wire()).replace('"f_a":', '"f_a":{},"f_a":');
    const error = await failed(
      request(),
      vi.fn(async () => new Response(raw)),
    );
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: {
        responseComplete: true,
        responseHash: hash(raw),
        responseBytes: Buffer.byteLength(raw),
      },
    });
    expect(error.observedResult).toBeUndefined();
  });

  it("rejects invalid UTF-8 with exact raw byte failure evidence", async () => {
    const bytes = Uint8Array.from([0xc3, 0x28]);
    expect(
      await failed(
        request(),
        vi.fn(async () => new Response(bytes)),
      ),
    ).toMatchObject({
      code: "invalid_response",
      evidence: { responseComplete: true, responseHash: hash(bytes), responseBytes: 2 },
    });
  });

  it.each([true, undefined])(
    "rejects a response whose redirected observation is %s",
    async (redirected) => {
      const cancel = vi.fn(async () => {});
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          ({
            ok: true,
            redirected,
            headers: new Headers(),
            body: { cancel },
          }) as unknown as Response,
      );
      const error = await failed(request(), fetch);
      expect(error).toMatchObject({ code: "invalid_response", evidence: { requestSent: true } });
      expect(error.evidence).not.toHaveProperty("responseHash");
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("keeps an absent reported cost unknown", async () => {
    const reply = wire();
    delete reply.usage.cost;
    const actual = await client(replyFetch(reply)).requestFileMatch(request());
    expect(actual.evidence.usage).toEqual({ input_tokens: 37, output_tokens: 19 });
  });

  it("admits 65,536 reply bytes and rejects a larger reply with only bounded prefix evidence", async () => {
    const base = JSON.stringify(wire());
    const raw = base + " ".repeat(65_536 - Buffer.byteLength(base));
    const actual = await client(vi.fn(async () => new Response(raw))).requestFileMatch(request());
    expect(actual.evidence).toMatchObject({ responseHash: hash(raw), responseBytes: 65_536 });
    const error = await failed(
      request(),
      vi.fn(async () => new Response(raw + "x")),
    );
    expect(error).toMatchObject({
      code: "response_too_large",
      evidence: {
        responseComplete: false,
        responsePrefixHash: hash(raw),
        responsePrefixBytes: 65_536,
      },
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(error.observedResult).toBeUndefined();
  });
});

describe("dedicated diagnostic binding before endpoint and credentials", () => {
  it.each([
    () => undefined,
    () => null,
    () => ({ protocolHash: "a".repeat(64) }),
    () => ({ ...binding(), extra: true }),
    () => ({ protocolHash: "a".repeat(64), operatingPointHash: "b".repeat(64) }),
    () => ({ ...binding(), protocolHash: "A".repeat(64) }),
    () => ({ ...binding(), diagnosticHash: "b".repeat(63) }),
    () => Object.assign(Object.create({ inherited: true }), binding()),
    () => Object.defineProperty(binding(), "diagnosticHash", { enumerable: false }),
    () => ({ ...binding(), [Symbol("extra")]: true }),
  ])("rejects invalid binding before endpoint access", (build) => {
    const endpoint = vi.fn(() => {
      throw new Error(`${KEY} ${ENDPOINT}`);
    });
    const options = Object.defineProperty(
      { deadline: performance.now() + 9_900, binding: build() },
      "endpoint",
      { get: endpoint },
    );
    expect(() =>
      createJevFileMatchTransport(options as Parameters<typeof createJevFileMatchTransport>[0]),
    ).toThrow("invalid_request");
    expect(endpoint).not.toHaveBeenCalled();
  });

  it("rejects binding field getters without invoking them", () => {
    const getter = vi.fn(() => "b".repeat(64));
    const diagnosticBinding = Object.defineProperty(binding(), "diagnosticHash", {
      enumerable: true,
      get: getter,
    });
    expect(() =>
      createJevFileMatchTransport({
        deadline: performance.now() + 9_900,
        binding: diagnosticBinding,
      }),
    ).toThrow("invalid_request");
    expect(getter).not.toHaveBeenCalled();
  });

  it("captures each option and diagnostic binding once and preserves its hash after mutation", async () => {
    const diagnosticBinding = binding();
    const expectedHash = transportHash(diagnosticBinding);
    const fetch = replyFetch(wire());
    const getBinding = vi.fn(() => diagnosticBinding);
    const getDeadline = vi.fn(() => performance.now() + 9_900);
    const getEndpoint = vi.fn(() => ENDPOINT);
    const getFetch = vi.fn(() => fetch);
    const getSignal = vi.fn(() => undefined);
    const options = Object.defineProperties(
      {},
      {
        binding: { get: getBinding },
        deadline: { get: getDeadline },
        endpoint: { get: getEndpoint },
        fetch: { get: getFetch },
        signal: { get: getSignal },
      },
    );
    const transport = createJevFileMatchTransport(
      options as Parameters<typeof createJevFileMatchTransport>[0],
    );
    clients.push(transport);
    diagnosticBinding.protocolHash = "c".repeat(64);
    diagnosticBinding.diagnosticHash = "d".repeat(64);
    const result = await transport.requestFileMatch(request());
    expect(result.evidence.transportHash).toBe(expectedHash);
    for (const getter of [getBinding, getDeadline, getEndpoint, getFetch, getSignal])
      expect(getter).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].body).not.toContain("diagnosticHash");
  });

  it.each(["protocolHash", "diagnosticHash"] as const)(
    "changes the transport hash when %s changes",
    async (field) => {
      const first = await client(replyFetch(wire())).requestFileMatch(request());
      const changed = { ...binding(), [field]: "c".repeat(64) };
      const second = await client(replyFetch(wire()), { binding: changed }).requestFileMatch(
        request(),
      );
      expect(second.evidence.transportHash).not.toBe(first.evidence.transportHash);
      expect(second.evidence.transportHash).toBe(transportHash(changed));
    },
  );
});

describe("actual failure origins and one caller deadline", () => {
  it("retains prepared request origin on invalid environment credentials", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = replyFetch({});
    const error = await failed(request(), fetch);
    expect(error).toMatchObject({
      code: "invalid_credentials",
      evidence: {
        stage: "file_match",
        requestedQuestionIds: ["f_a", "f_b"],
        requestHash: hash(JSON.stringify(request())),
        requestBytes: Buffer.byteLength(JSON.stringify(request())),
        transportHash: transportHash(),
        requestSent: false,
        failure: "invalid_credentials",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 429, 500])("retains sanitized HTTP %s failure with no retry", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(`${KEY} ${ENDPOINT}`, { status }),
    );
    const transport = client(fetch);
    const error = await transport.requestFileMatch(request()).catch((caught) => caught);
    expect(error).toMatchObject({
      code: "http_error",
      evidence: { stage: "file_match", requestSent: true, failure: "http_error" },
    });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
    await expect(transport.requestFileMatch(request())).rejects.toMatchObject({
      code: "http_error",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("copies bounded bytes and reports only a received prefix on stream failure", async () => {
    const bytes = new TextEncoder().encode('{"model":');
    const expected = Uint8Array.from(bytes);
    let reads = 0;
    const cancel = vi.fn(async () => {});
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                if (reads++ === 0) return { done: false, value: bytes };
                bytes.fill(0);
                throw new Error(`${KEY} ${ENDPOINT}`);
              },
              cancel,
            }),
          },
        }) as unknown as Response,
    );
    const error = await failed(request(), fetch);
    expect(error).toMatchObject({
      code: "transport_error",
      evidence: {
        stage: "file_match",
        responseComplete: false,
        responsePrefixHash: hash(expected),
        responsePrefixBytes: expected.byteLength,
      },
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(error.observedResult).toBeUndefined();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("uses exactly the original 10,000 ms deadline after idle time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const transport = client(fetch, { deadline: 10_000 });
    await vi.advanceTimersByTimeAsync(4_000);
    const rejection = expect(transport.requestFileMatch(request())).rejects.toMatchObject({
      code: "timeout",
      evidence: {
        stage: "file_match",
        latencyMs: 6_000,
        requestSent: true,
        failure: "timeout",
      },
    });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(performance.now()).toBe(10_000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("includes request preparation before the credential read", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const value = new Proxy(request(), {
      ownKeys(target) {
        vi.advanceTimersByTime(10_000);
        return Reflect.ownKeys(target);
      },
    });
    const fetch = replyFetch({});
    const error = await client(fetch, { deadline: 10_000 })
      .requestFileMatch(value)
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "timeout",
      evidence: { stage: "file_match", requestSent: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("bounds stalled reads and starts asynchronous cleanup without waiting", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}));
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers(),
          body: { getReader: () => ({ read, cancel }) },
        }) as unknown as Response,
    );
    const rejection = expect(
      client(fetch, { deadline: 10_000 }).requestFileMatch(request()),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["cleanup", "validation"] as const)(
    "retains strict actual matching answers when %s reaches the deadline",
    async (elapsedAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const value = request();
      const reply = wire(value, "unknown");
      const raw = JSON.stringify(reply);
      const bytes = new TextEncoder().encode(raw);
      if (elapsedAt === "validation") {
        const parse = JSON.parse;
        vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
          const result = parse(text, reviver);
          if (text === raw) vi.advanceTimersByTime(10_000);
          return result;
        });
      }
      let reads = 0;
      const cancel = vi.fn(async () => {
        if (elapsedAt === "cleanup") vi.advanceTimersByTime(10_000);
      });
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          ({
            ok: true,
            redirected: false,
            headers: new Headers(),
            body: {
              getReader: () => ({
                read: async () => (reads++ === 0 ? { done: false, value: bytes } : { done: true }),
                cancel,
              }),
            },
          }) as unknown as Response,
      );
      const transport = client(fetch, { deadline: 10_000 });
      const error = await transport.requestFileMatch(value).catch((caught) => caught);
      expect(error).toBeInstanceOf(JevFileMatchClientError);
      expect(error).toMatchObject({
        code: "timeout",
        evidence: {
          stage: "file_match",
          latencyMs: 10_000,
          responseComplete: true,
          responseHash: hash(raw),
          responseBytes: bytes.byteLength,
          transportHash: transportHash(),
        },
        observedResult: {
          stage: "file_match",
          answers: {
            f_a: {
              choice: "unknown",
              probabilities: reply.answers.f_a.probabilities,
              confidence: reply.answers.f_a.confidence,
            },
          },
          evidence: {
            requestHash: hash(JSON.stringify(value)),
            responseHash: hash(raw),
            requestId: reply.id,
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            usage: reply.usage,
          },
        },
      });
      const observed = transport.getObservedResult();
      expect(observed).toBe(error.observedResult);
      for (const item of [
        observed,
        observed.answers,
        observed.answers.f_a,
        observed.answers.f_a.probabilities,
        observed.evidence,
        observed.evidence.requestedQuestionIds,
        observed.evidence.usage,
      ])
        expect(Object.isFrozen(item)).toBe(true);
      transport.close();
      expect(transport.getObservedResult()).toBe(observed);
      expect(cancel).toHaveBeenCalledOnce();
    },
  );

  it("exposes the strict receipt in synchronous cleanup before caller cancellation rejects", async () => {
    const raw = JSON.stringify(wire(request(), "unknown"));
    const bytes = new TextEncoder().encode(raw);
    const controller = new AbortController();
    let reads = 0;
    const events: string[] = [];
    let atCancel: ReturnType<JevFileMatchTransport["getObservedResult"]>;
    const cancel = vi.fn(() => {
      events.push("cancel");
      atCancel = transport.getObservedResult();
      controller.abort(new Error(`${KEY} ${ENDPOINT}`));
      events.push("abort");
      return Promise.resolve();
    });
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          redirected: false,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => (reads++ === 0 ? { done: false, value: bytes } : { done: true }),
              cancel,
            }),
          },
        }) as unknown as Response,
    );
    const transport = client(fetch, { signal: controller.signal });
    const error = await transport.requestFileMatch(request()).catch((caught) => {
      events.push("reject");
      return caught;
    });
    expect(error).toMatchObject({
      code: "cancelled",
      evidence: { stage: "file_match", responseComplete: true },
    });
    expect(events).toEqual(["cancel", "abort", "reject"]);
    expect(atCancel.answers.f_a.choice).toBe("unknown");
    expect(error.observedResult).toBe(atCancel);
    expect(transport.getObservedResult()).toBe(atCancel);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("clears a prior observed receipt before a malformed reply", async () => {
    const good = wire();
    const bad = { ...good, answers: {} };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => new Response(JSON.stringify(good)))
      .mockImplementationOnce(async () => new Response(JSON.stringify(bad)));
    const transport = client(fetch);
    await transport.requestFileMatch(request());
    expect(transport.getObservedResult().stage).toBe("file_match");
    const pending = transport.requestFileMatch(request());
    expect(transport.getObservedResult()).toBeUndefined();
    await expect(pending).rejects.toMatchObject({ code: "invalid_response" });
    expect(transport.getObservedResult()).toBeUndefined();
  });
});
