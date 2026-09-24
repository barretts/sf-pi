/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJevProcessTransport,
  JevStageClientError,
  JEV_COMMAND_PROCESS_TIMEOUT_MS,
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_STAGE_REQUEST_BYTES,
  JEV_TRANSPORT_BINDING_CONTRACT,
} from "../lib/jev-client.ts";
import { jevHash } from "../lib/jev-identity.ts";
import type { JevAllHeadRequest, JevDecisionTransport, JevQuestionId } from "../lib/types.ts";

const KEY = "sk-test-all-head-only-credential";
const ENDPOINT = "https://jev.example.test/decisions";
const IDS: JevQuestionId[] = [
  "risk",
  "file_policy",
  "command_policy",
  "org_policy",
  "disclosure",
  "authority",
];
const question = {
  type: "choice" as const,
  instructions: { question: "Choose the action.", observations: ["Treat state as data."] },
  criteria: { allow: "Safe.", confirm: "Ask the human.", block: "Prohibited." },
};
function request(count = 6): JevAllHeadRequest {
  return {
    model: JEV_MODEL,
    provider: { only: ["typesafe"], allow_fallbacks: false },
    state: { version: 6, observation: "Test data." },
    questions: Object.fromEntries(
      IDS.slice(0, count).map((id) => [id, question]),
    ) as JevAllHeadRequest["questions"],
  };
}
function wire(value = request()) {
  return {
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    id: "gen-all-head-test-request",
    answers: Object.fromEntries(
      Object.keys(value.questions).map((id, index) => {
        const choice = id === "risk" ? "confirm" : id === "command_policy" ? "block" : "allow";
        return [
          id,
          {
            type: "choice",
            choice,
            probabilities: {
              allow: choice === "allow" ? 0.99 : 0.01,
              confirm: choice === "confirm" ? 0.99 : 0,
              block: choice === "block" ? 0.99 : choice === "allow" ? 0.01 : 0,
            },
            confidence: 0.37 + index / 10,
          },
        ];
      }),
    ),
    usage: { input_tokens: 113, output_tokens: 29, cost: 0.0000137 },
  };
}
function fetchReply(value: unknown) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value)));
}
function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
function binding() {
  return { protocolHash: "a".repeat(64), operatingPointHash: "b".repeat(64) };
}
let clients: JevDecisionTransport[];
function client(
  fetch: typeof globalThis.fetch,
  options: Partial<Parameters<typeof createJevProcessTransport>[0]> = {},
) {
  const result = createJevProcessTransport({
    deadline: performance.now() + 1_490,
    fetch,
    ...options,
  });
  clients.push(result);
  return result;
}
async function failed(value: unknown, fetch: typeof globalThis.fetch) {
  return client(fetch)
    .requestAllHeads(value as JevAllHeadRequest)
    .catch((error) => error);
}
beforeEach(() => {
  clients = [];
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
});
afterEach(() => {
  for (const transport of clients) transport.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("one request with all actual action heads", () => {
  it("keeps all six answers and their original request and reply hashes", async () => {
    const value = request();
    const reply = wire(value);
    const raw = ` \n${JSON.stringify(reply)}\n`;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const actual = await client(fetch).requestAllHeads(value);
    const answers = Object.fromEntries(
      Object.entries(reply.answers).map(([id, answer]) => [
        id,
        {
          choice: answer.choice,
          probabilities: answer.probabilities,
          confidence: answer.confidence,
        },
      ]),
    );
    expect(actual.stage).toBe("all_heads");
    expect(actual.answers).toEqual(answers);
    expect(actual.answers.risk).toEqual(answers.risk);
    expect(actual.answers.risk.choice).toBe("confirm");
    expect(actual.answers.command_policy.choice).toBe("block");
    expect(actual).not.toHaveProperty("choice");
    expect(actual.evidence).toMatchObject({
      requestedQuestionIds: IDS,
      requestHash: hash(JSON.stringify(value)),
      responseHash: hash(raw),
      requestBytes: Buffer.byteLength(JSON.stringify(value)),
      responseBytes: Buffer.byteLength(raw),
      transportHash: jevHash({ contract: JEV_TRANSPORT_BINDING_CONTRACT, endpoint: ENDPOINT }),
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      requestId: reply.id,
      usage: reply.usage,
    });
    expect(actual.evidence.latencyMs).toBeGreaterThanOrEqual(0);
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
    expect(JSON.stringify(actual)).not.toContain(KEY);
    expect(JSON.stringify(actual)).not.toContain(ENDPOINT);
  });

  it.each([1, 2, 3, 4, 5, 6])("accepts exactly %s known heads with risk", async (count) => {
    const value = request(count);
    const fetch = fetchReply(wire(value));
    const actual = await client(fetch).requestAllHeads(value);
    expect(actual.evidence.requestedQuestionIds).toEqual(IDS.slice(0, count));
    expect(Object.keys(actual.answers)).toEqual(IDS.slice(0, count));
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    { questions: {} },
    { questions: { command_policy: question } },
    { questions: { risk: question, unknown_head: question } },
    { questions: { risk: question, r_a: question } },
    { questions: { ...request().questions, extra: question } },
    { extra: "Unexpected data." },
    { model: "other-model" },
    { provider: { only: ["typesafe"], allow_fallbacks: true } },
  ])("rejects invalid head or route data before credentials: %j", async (patch) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = fetchReply({});
    const error = await failed({ ...request(), ...patch }, fetch);
    expect(error).toBeInstanceOf(JevStageClientError);
    expect(error).toMatchObject({
      code: "invalid_request",
      evidence: {
        stage: "all_heads",
        requestedQuestionIds: [],
        requestSent: false,
        failure: "invalid_request",
      },
    });
    expect(error.evidence).not.toHaveProperty("requestHash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preserves the supplied head order", async () => {
    const value = { ...request(), questions: { command_policy: question, risk: question } };
    const actual = await client(fetchReply(wire(value))).requestAllHeads(value);
    expect(actual.evidence.requestedQuestionIds).toEqual(["command_policy", "risk"]);
    expect(actual.answers).toHaveProperty("command_policy");
    expect(actual.answers).toHaveProperty("risk");
  });

  it("uses the same 32,768-byte request bound", async () => {
    const value = { ...request(), state: { padding: "" } };
    value.state.padding = "x".repeat(
      JEV_STAGE_REQUEST_BYTES - Buffer.byteLength(JSON.stringify(value)),
    );
    const fetch = fetchReply(wire(value));
    const actual = await client(fetch).requestAllHeads(value);
    expect(actual.evidence.requestBytes).toBe(JEV_STAGE_REQUEST_BYTES);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    value.state.padding += "x";
    const invalidFetch = fetchReply({});
    expect(await failed(value, invalidFetch)).toMatchObject({ code: "invalid_request" });
    expect(invalidFetch).not.toHaveBeenCalled();
  });

  it("does not invoke a question getter", async () => {
    const getter = vi.fn(() => question);
    const value = request();
    Object.defineProperty(value.questions, "risk", { enumerable: true, get: getter });
    const fetch = fetchReply({});
    expect(await failed(value, fetch)).toMatchObject({ code: "invalid_request" });
    expect(getter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("strict all-head reply and failed-attempt evidence", () => {
  it.each(["risk", "command_policy"])("rejects an absent actual %s answer", async (id) => {
    const reply = wire();
    delete reply.answers[id];
    const raw = JSON.stringify(reply);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const error = await failed(request(), fetch);
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: {
        stage: "all_heads",
        requestedQuestionIds: IDS,
        requestHash: hash(JSON.stringify(request())),
        requestSent: true,
        failure: "invalid_response",
        responseComplete: true,
        responseHash: hash(raw),
        responseBytes: Buffer.byteLength(raw),
      },
    });
    expect(error).not.toHaveProperty("answers");
    expect(error.observedResult).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["command_policy", "unknown_head"])("rejects extra reply head %s", async (id) => {
    const value = request(1);
    const reply = wire(value);
    reply.answers[id] = reply.answers.risk;
    expect(await failed(value, fetchReply(reply))).toMatchObject({ code: "invalid_response" });
  });

  it.each([
    { type: "other" },
    { choice: "allow" },
    { confidence: "0.99" },
    { extra: "Unexpected data." },
    { probabilities: { allow: 0.3, confirm: 0.3, block: 0.3 } },
    { probabilities: { allow: "0.01", confirm: 0.99, block: 0 } },
    { probabilities: { allow: 0.01, confirm: 0.99, block: 0, extra: 0 } },
  ])("rejects malformed action data: %j", async (patch) => {
    const reply = wire();
    reply.answers.risk = { ...reply.answers.risk, ...patch } as typeof reply.answers.risk;
    expect(await failed(request(), fetchReply(reply))).toMatchObject({ code: "invalid_response" });
  });

  it.each([{ model: "other-model" }, { provider: "OtherProvider" }])(
    "rejects provider identity changes: %j",
    async (patch) => {
      const error = await failed(request(), fetchReply({ ...wire(), ...patch }));
      expect(error).toMatchObject({
        code: "identity_mismatch",
        evidence: { stage: "all_heads", requestSent: true, responseComplete: true },
      });
    },
  );

  it("keeps raw rounded probabilities, confidence, and negative zero", async () => {
    const reply = wire();
    reply.answers.risk = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 0.34, confirm: 0.33, block: 0.34 },
      confidence: 0.0123456789,
    };
    reply.answers.command_policy = {
      type: "choice",
      choice: "allow",
      probabilities: { allow: 1, confirm: 0, block: 0 },
      confidence: 0.83,
    };
    const raw = JSON.stringify(reply).replace('"allow":1,"confirm":0', '"allow":1,"confirm":-0');
    const actual = await client(vi.fn(async () => new Response(raw))).requestAllHeads(request());
    expect(actual.answers.risk.probabilities).toEqual({ allow: 0.34, confirm: 0.33, block: 0.34 });
    expect(actual.answers.risk.confidence).toBe(0.0123456789);
    expect(Object.is(actual.answers.command_policy.probabilities.confirm, -0)).toBe(true);
    expect(actual.evidence.responseHash).toBe(hash(raw));
  });

  it.each([
    { input_tokens: -1, output_tokens: 29 },
    { input_tokens: 113, output_tokens: 0.1 },
    { input_tokens: 113, output_tokens: 29, cost: -1 },
  ])("rejects invalid usage data: %j", async (usage) => {
    expect(await failed(request(), fetchReply({ ...wire(), usage }))).toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects duplicate reply fields without losing the raw reply hash", async () => {
    const raw = JSON.stringify(wire()).replace('"model":', '"model":"other","model":');
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
  });

  it("rejects invalid UTF-8 and keeps the raw bytes in hash evidence", async () => {
    const bytes = Uint8Array.from([0xc3, 0x28]);
    const error = await failed(
      request(),
      vi.fn(async () => new Response(bytes)),
    );
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: { responseComplete: true, responseHash: hash(bytes), responseBytes: 2 },
    });
  });

  it("records preparation when the credential is invalid", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = fetchReply({});
    const error = await failed(request(), fetch);
    expect(error).toMatchObject({
      code: "invalid_credentials",
      evidence: {
        stage: "all_heads",
        requestedQuestionIds: IDS,
        requestHash: hash(JSON.stringify(request())),
        requestBytes: Buffer.byteLength(JSON.stringify(request())),
        transportHash: jevHash({ contract: JEV_TRANSPORT_BINDING_CONTRACT, endpoint: ENDPOINT }),
        requestSent: false,
        failure: "invalid_credentials",
      },
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("sanitizes a fetch failure and rejects later stages without another call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(`${KEY} ${ENDPOINT}`);
    });
    const transport = client(fetch);
    const error = await transport.requestAllHeads(request()).catch((caught) => caught);
    expect(error).toMatchObject({
      code: "transport_error",
      message: "Jev request failed: transport_error.",
      evidence: {
        stage: "all_heads",
        requestedQuestionIds: IDS,
        requestSent: true,
        failure: "transport_error",
      },
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
    await expect(transport.requestAllHeads(request())).rejects.toMatchObject({
      code: "transport_error",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("records only the received prefix after a stream failure", async () => {
    const bytes = new TextEncoder().encode('{"model":');
    const cancel = vi.fn(async () => {});
    let reads = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                if (reads++ === 0) return { done: false, value: bytes };
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
        stage: "all_heads",
        requestSent: true,
        responseComplete: false,
        responsePrefixHash: hash(bytes),
        responsePrefixBytes: bytes.byteLength,
      },
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("process hash binding before endpoint and credential access", () => {
  it("keeps the prior transport hash when binding is absent", async () => {
    const actual = await client(fetchReply(wire())).requestAllHeads(request());
    expect(actual.evidence.transportHash).toBe(
      jevHash({ contract: JEV_TRANSPORT_BINDING_CONTRACT, endpoint: ENDPOINT }),
    );
  });

  it("binds both exact hashes and keeps their snapshot after mutation", async () => {
    const processBinding = binding();
    const expected = jevHash({
      contract: JEV_TRANSPORT_BINDING_CONTRACT,
      endpoint: ENDPOINT,
      processBinding,
    });
    const fetch = fetchReply(wire());
    const transport = client(fetch, { binding: processBinding });
    processBinding.protocolHash = "c".repeat(64);
    processBinding.operatingPointHash = "d".repeat(64);
    const actual = await transport.requestAllHeads(request());
    expect(actual.evidence.transportHash).toBe(expected);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(request()));
    expect(fetch.mock.calls[0][1].body).not.toContain("protocolHash");
    expect(JSON.stringify(actual)).not.toContain(ENDPOINT);
  });

  it.each(["protocolHash", "operatingPointHash"] as const)(
    "changes transport hash when %s changes",
    async (field) => {
      const original = binding();
      const changed = { ...original, [field]: "c".repeat(64) };
      const first = await client(fetchReply(wire()), { binding: original }).requestAllHeads(
        request(),
      );
      const second = await client(fetchReply(wire()), { binding: changed }).requestAllHeads(
        request(),
      );
      expect(first.evidence.transportHash).not.toBe(second.evidence.transportHash);
      expect(second.evidence.transportHash).toBe(
        jevHash({
          contract: JEV_TRANSPORT_BINDING_CONTRACT,
          endpoint: ENDPOINT,
          processBinding: changed,
        }),
      );
    },
  );

  it("accepts exact enumerable data fields with a null prototype", async () => {
    const processBinding = Object.assign(Object.create(null), binding());
    const actual = await client(fetchReply(wire()), { binding: processBinding }).requestAllHeads(
      request(),
    );
    expect(actual.evidence.transportHash).toBe(
      jevHash({
        contract: JEV_TRANSPORT_BINDING_CONTRACT,
        endpoint: ENDPOINT,
        processBinding: binding(),
      }),
    );
  });

  it.each([
    () => null,
    () => [],
    () => ({ protocolHash: "a".repeat(64) }),
    () => ({ ...binding(), extra: true }),
    () => ({ ...binding(), protocolHash: "A".repeat(64) }),
    () => ({ ...binding(), protocolHash: "a".repeat(63) }),
    () => ({ ...binding(), protocolHash: "g".repeat(64) }),
    () => ({ ...binding(), operatingPointHash: 1 }),
    () => Object.assign(Object.create({ inherited: true }), binding()),
    () => Object.defineProperty(binding(), "protocolHash", { enumerable: false }),
    () => ({ ...binding(), [Symbol("extra")]: "test" }),
  ])("rejects bad binding before it reads the endpoint or a credential", (build) => {
    const endpoint = vi.fn(() => {
      throw new Error(`${KEY} ${ENDPOINT}`);
    });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = fetchReply({});
    const options = Object.defineProperty(
      { deadline: performance.now() + 1_490, fetch, binding: build() },
      "endpoint",
      { get: endpoint },
    );
    expect(() =>
      createJevProcessTransport(options as Parameters<typeof createJevProcessTransport>[0]),
    ).toThrow("invalid_request");
    expect(endpoint).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects binding accessors without invoking them", () => {
    const getter = vi.fn(() => "a".repeat(64));
    const processBinding = Object.defineProperty(binding(), "protocolHash", {
      enumerable: true,
      get: getter,
    });
    const endpoint = vi.fn(() => ENDPOINT);
    const options = Object.defineProperty(
      { deadline: performance.now() + 1_490, binding: processBinding },
      "endpoint",
      { get: endpoint },
    );
    expect(() => createJevProcessTransport(options)).toThrow("invalid_request");
    expect(getter).not.toHaveBeenCalled();
    expect(endpoint).not.toHaveBeenCalled();
  });

  it("captures a valid binding option getter once", async () => {
    const getBinding = vi.fn(() => binding());
    const options = Object.defineProperty(
      { deadline: performance.now() + 1_490, fetch: fetchReply(wire()) },
      "binding",
      { get: getBinding },
    );
    const transport = createJevProcessTransport(options);
    clients.push(transport);
    const actual = await transport.requestAllHeads(request());
    expect(getBinding).toHaveBeenCalledOnce();
    expect(actual.evidence.transportHash).toBe(
      jevHash({
        contract: JEV_TRANSPORT_BINDING_CONTRACT,
        endpoint: ENDPOINT,
        processBinding: binding(),
      }),
    );
  });
});

describe("one absolute 10,000 ms deadline and bounded cleanup", () => {
  it.each(["cleanup", "validation"] as const)(
    "retains the strict actual block when %s reaches the deadline",
    async (elapsedAt) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const value = request();
      const reply = wire(value);
      const raw = JSON.stringify(reply);
      const bytes = new TextEncoder().encode(raw);
      if (elapsedAt === "validation") {
        const parse = JSON.parse;
        vi.spyOn(JSON, "parse").mockImplementation((text, reviver) => {
          const parsed = parse(text, reviver);
          if (text === raw) vi.advanceTimersByTime(10_000);
          return parsed;
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
            headers: new Headers(),
            body: {
              getReader: () => ({
                read: async () => (reads++ === 0 ? { done: false, value: bytes } : { done: true }),
                cancel,
              }),
            },
          }) as unknown as Response,
      );
      const error = await client(fetch, { deadline: 10_000, binding: binding() })
        .requestAllHeads(value)
        .catch((caught) => caught);
      const transportHash = jevHash({
        contract: JEV_TRANSPORT_BINDING_CONTRACT,
        endpoint: ENDPOINT,
        processBinding: binding(),
      });
      expect(error).toBeInstanceOf(JevStageClientError);
      expect(error).toMatchObject({
        code: "timeout",
        evidence: {
          stage: "all_heads",
          requestedQuestionIds: IDS,
          requestSent: true,
          failure: "timeout",
          latencyMs: 10_000,
          responseComplete: true,
          requestHash: hash(JSON.stringify(value)),
          requestBytes: Buffer.byteLength(JSON.stringify(value)),
          responseHash: hash(raw),
          responseBytes: bytes.byteLength,
          transportHash,
        },
        observedResult: {
          stage: "all_heads",
          answers: {
            risk: {
              choice: "confirm",
              probabilities: reply.answers.risk.probabilities,
              confidence: reply.answers.risk.confidence,
            },
            command_policy: {
              choice: "block",
              probabilities: reply.answers.command_policy.probabilities,
              confidence: reply.answers.command_policy.confidence,
            },
          },
          evidence: {
            requestedQuestionIds: IDS,
            requestHash: hash(JSON.stringify(value)),
            requestBytes: Buffer.byteLength(JSON.stringify(value)),
            responseHash: hash(raw),
            responseBytes: bytes.byteLength,
            transportHash,
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            requestId: reply.id,
            usage: reply.usage,
          },
        },
      });
      const observed = error.observedResult;
      for (const item of [
        observed,
        observed.answers,
        observed.answers.command_policy,
        observed.answers.command_policy.probabilities,
        observed.evidence,
        observed.evidence.requestedQuestionIds,
        observed.evidence.usage,
      ]) {
        expect(Object.isFrozen(item)).toBe(true);
      }
      expect(() => {
        observed.answers.command_policy.choice = "allow";
      }).toThrow();
      expect(observed.answers.command_policy.choice).toBe("block");
      expect(error.evidence).not.toHaveProperty("responsePrefixHash");
      expect(JSON.stringify(error)).not.toContain(KEY);
      expect(JSON.stringify(error)).not.toContain(ENDPOINT);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("uses the original deadline after idle time with no retry", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const transport = client(fetch, {
      deadline: JEV_COMMAND_PROCESS_TIMEOUT_MS,
      binding: binding(),
    });
    await vi.advanceTimersByTimeAsync(4_000);
    const attempt = transport.requestAllHeads(request());
    const rejection = expect(attempt).rejects.toMatchObject({
      code: "timeout",
      evidence: {
        stage: "all_heads",
        requestedQuestionIds: IDS,
        requestSent: true,
        latencyMs: 6_000,
        transportHash: jevHash({
          contract: JEV_TRANSPORT_BINDING_CONTRACT,
          endpoint: ENDPOINT,
          processBinding: binding(),
        }),
        failure: "timeout",
      },
    });
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(performance.now()).toBe(10_000);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(transport.requestAllHeads(request())).rejects.toMatchObject({ code: "timeout" });
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
    const fetch = fetchReply({});
    const error = await client(fetch, { deadline: 10_000 })
      .requestAllHeads(value)
      .catch((caught) => caught);
    expect(error).toMatchObject({
      code: "timeout",
      evidence: { stage: "all_heads", requestSent: false },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([9_999, 10_000])(
    "includes %s ms of synchronous cleanup and retains the whole reply hash",
    async (cleanupMs) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const raw = JSON.stringify(wire());
      const bytes = new TextEncoder().encode(raw);
      let reads = 0;
      const cancel = vi.fn(async () => vi.advanceTimersByTime(cleanupMs));
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          ({
            ok: true,
            headers: new Headers(),
            body: {
              getReader: () => ({
                read: async () => (reads++ === 0 ? { done: false, value: bytes } : { done: true }),
                cancel,
              }),
            },
          }) as unknown as Response,
      );
      const actual = await client(fetch, { deadline: 10_000 })
        .requestAllHeads(request())
        .catch((caught) => caught);
      if (cleanupMs === 9_999) expect(actual.stage).toBe("all_heads");
      else expect(actual).toMatchObject({ code: "timeout", evidence: { responseComplete: true } });
      expect(actual.evidence).toMatchObject({ responseHash: hash(raw), latencyMs: cleanupMs });
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("bounds a stalled stream and starts cleanup without waiting for it", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const read = vi.fn(() => new Promise<ReadableStreamReadResult<Uint8Array>>(() => {}));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: { getReader: () => ({ read, cancel }) },
        }) as unknown as Response,
    );
    const rejection = expect(
      client(fetch, { deadline: 10_000 }).requestAllHeads(request()),
    ).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels pending work and removes the caller listener and timer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const transport = client(fetch, { deadline: 10_000, signal: controller.signal });
    const rejection = expect(transport.requestAllHeads(request())).rejects.toMatchObject({
      code: "cancelled",
      evidence: { stage: "all_heads", requestSent: true, failure: "cancelled" },
    });
    controller.abort(new Error(`${KEY} ${ENDPOINT}`));
    await rejection;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(remove).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("synchronous observation of each actual stage", () => {
  const stages = ["non_command", "syntax", "command_policy", "all_heads"] as const;
  type Stage = (typeof stages)[number];
  function source(stage: Stage) {
    const questions =
      stage === "syntax"
        ? {
            r_a: {
              type: "choice" as const,
              instructions: "Does the first selector match?",
              criteria: { match: "Exact match.", no_match: "No exact match." },
            },
            r_b: {
              type: "choice" as const,
              instructions: "Does the second selector match?",
              criteria: { match: "Exact match.", no_match: "No exact match." },
            },
          }
        : stage === "command_policy"
          ? { command_policy: question }
          : stage === "non_command"
            ? { risk: question, file_policy: question, disclosure: question }
            : request().questions;
    const value = { ...request(), questions };
    const reply = {
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      id: `source-observed-${stage}`,
      answers: Object.fromEntries(
        Object.keys(questions).map((id) => [
          id,
          stage === "syntax"
            ? {
                type: "choice",
                choice: id === "r_a" ? "match" : "no_match",
                probabilities:
                  id === "r_a"
                    ? { match: 0.992345, no_match: 0.007655 }
                    : { match: 0.001235, no_match: 0.998765 },
                confidence: id === "r_a" ? 0.123456789 : 0.876543219,
              }
            : {
                type: "choice",
                choice: id === "risk" ? "confirm" : "block",
                probabilities:
                  id === "risk"
                    ? { allow: 0.010123, confirm: 0.989877, block: 0 }
                    : { allow: 0.010123, confirm: 0.020123, block: 0.969754 },
                confidence: id === "risk" ? 0.123456789 : 0.876543219,
              },
        ]),
      ),
      usage: { input_tokens: 37, output_tokens: 19, cost: 0.00012345678 },
    };
    const raw = ` \n${JSON.stringify(reply).replace('"block":0}', '"block":-0}')}\n`;
    const expectedAnswers = Object.fromEntries(
      Object.entries(JSON.parse(raw).answers).map(([id, answer]) => {
        const { type: _type, ...actual } = answer as Record<string, unknown>;
        return [id, actual];
      }),
    );
    return { value, reply, raw, expectedAnswers };
  }
  function send(transport: JevDecisionTransport, stage: Stage, value: unknown) {
    if (stage === "non_command")
      return transport.requestNonCommand(
        value as Parameters<JevDecisionTransport["requestNonCommand"]>[0],
      );
    if (stage === "syntax")
      return transport.requestSyntax(value as Parameters<JevDecisionTransport["requestSyntax"]>[0]);
    if (stage === "command_policy")
      return transport.requestCommandPolicy(
        value as Parameters<JevDecisionTransport["requestCommandPolicy"]>[0],
      );
    return transport.requestAllHeads(value as JevAllHeadRequest);
  }

  it.each(stages)("keeps exact immutable %s answers and origin after close", async (stage) => {
    const { value, reply, raw, expectedAnswers } = source(stage);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const transport = client(fetch, { binding: binding() });
    expect(transport.getObservedResult?.()).toBeUndefined();
    const returned = await send(transport, stage, value);
    const observed = transport.getObservedResult?.();
    expect(observed).toMatchObject({
      stage,
      answers: expectedAnswers,
      evidence: {
        requestedQuestionIds: Object.keys(value.questions),
        requestHash: hash(JSON.stringify(value)),
        responseHash: hash(raw),
        requestBytes: Buffer.byteLength(JSON.stringify(value)),
        responseBytes: Buffer.byteLength(raw),
        transportHash: jevHash({
          contract: JEV_TRANSPORT_BINDING_CONTRACT,
          endpoint: ENDPOINT,
          processBinding: binding(),
        }),
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        requestId: reply.id,
        usage: reply.usage,
      },
    });
    expect(observed).not.toBeInstanceOf(Promise);
    expect(observed).not.toBe(returned);
    for (const answer of Object.values(observed.answers)) {
      expect(Object.isFrozen(answer)).toBe(true);
      expect(Object.isFrozen(answer.probabilities)).toBe(true);
    }
    for (const item of [
      observed,
      observed.answers,
      observed.evidence,
      observed.evidence.requestedQuestionIds,
      observed.evidence.usage,
    ]) {
      expect(Object.isFrozen(item)).toBe(true);
    }
    if (observed.stage === "non_command" || observed.stage === "all_heads")
      expect(Object.is(observed.answers.risk.probabilities.block, -0)).toBe(true);
    expect(() => {
      observed.evidence.usage.input_tokens = 999;
    }).toThrow();
    returned.evidence.usage.input_tokens = 999;
    returned.evidence.requestedQuestionIds.pop();
    const firstId = Object.keys(returned.answers)[0];
    returned.answers[firstId].confidence = 0;
    expect(observed.answers).toEqual(expectedAnswers);
    expect(observed.evidence.usage).toEqual(reply.usage);
    expect(observed.evidence.requestedQuestionIds).toEqual(Object.keys(value.questions));
    transport.close();
    expect(transport.getObservedResult?.()).toBe(observed);
    await expect(send(transport, stage, value)).rejects.toMatchObject({ code: "cancelled" });
    expect(transport.getObservedResult?.()).toBe(observed);
    expect(fetch).toHaveBeenCalledOnce();
    expect(JSON.stringify(observed)).not.toContain(KEY);
    expect(JSON.stringify(observed)).not.toContain(ENDPOINT);
  });

  it.each(stages)("clears a prior %s observation on a new invalid request", async (stage) => {
    const { value, raw } = source(stage);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
    const transport = client(fetch);
    await send(transport, stage, value);
    expect(transport.getObservedResult?.()?.stage).toBe(stage);
    const invalid = { ...value, questions: { unknown_head: question } };
    const pending = send(transport, stage, invalid);
    expect(transport.getObservedResult?.()).toBeUndefined();
    const error = await pending.catch((caught) => caught);
    expect(error).toMatchObject({
      code: "invalid_request",
      evidence: { stage, requestSent: false },
    });
    expect(error.observedResult).toBeUndefined();
    expect(transport.getObservedResult?.()).toBeUndefined();
    transport.close();
    expect(transport.getObservedResult?.()).toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(stages)("clears a prior %s observation before a new malformed reply", async (stage) => {
    const { value, reply, raw } = source(stage);
    const firstId = Object.keys(reply.answers)[0];
    const invalidRaw = JSON.stringify({
      ...reply,
      answers: {
        ...reply.answers,
        [firstId]: { ...reply.answers[firstId], confidence: 1.01 },
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(async () => new Response(raw))
      .mockImplementationOnce(async () => new Response(invalidRaw));
    const transport = client(fetch);
    await send(transport, stage, value);
    expect(transport.getObservedResult?.()?.stage).toBe(stage);
    const pending = send(transport, stage, value);
    expect(transport.getObservedResult?.()).toBeUndefined();
    const error = await pending.catch((caught) => caught);
    expect(error).toMatchObject({
      code: "invalid_response",
      evidence: {
        stage,
        requestSent: true,
        responseComplete: true,
        responseHash: hash(invalidRaw),
        responseBytes: Buffer.byteLength(invalidRaw),
      },
    });
    expect(error.observedResult).toBeUndefined();
    expect(transport.getObservedResult?.()).toBeUndefined();
    expect(JSON.stringify(error)).not.toContain('"answers"');
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(stages)(
    "exposes actual %s heads in synchronous cancel before outer rejection",
    async (stage) => {
      const { value, raw, expectedAnswers } = source(stage);
      const bytes = new TextEncoder().encode(raw);
      const controller = new AbortController();
      let reads = 0;
      let settled = false;
      const events: string[] = [];
      let observedAtCancel: ReturnType<NonNullable<JevDecisionTransport["getObservedResult"]>>;
      let observedAfterAbort: typeof observedAtCancel;
      let settledAtCancel: boolean;
      const cancel = vi.fn(() => {
        events.push("cancel");
        observedAtCancel = transport.getObservedResult?.();
        settledAtCancel = settled;
        controller.abort(new Error(`${KEY} ${ENDPOINT}`));
        observedAfterAbort = transport.getObservedResult?.();
        events.push("abort");
        return Promise.resolve();
      });
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          ({
            ok: true,
            headers: new Headers(),
            body: {
              getReader: () => ({
                read: async () => (reads++ === 0 ? { done: false, value: bytes } : { done: true }),
                cancel,
              }),
            },
          }) as unknown as Response,
      );
      const transport = client(fetch, { signal: controller.signal, binding: binding() });
      const pending = send(transport, stage, value);
      const error = await pending.catch((caught) => {
        settled = true;
        events.push("reject");
        return caught;
      });
      expect(error).toMatchObject({
        code: "cancelled",
        evidence: {
          stage,
          requestSent: true,
          responseComplete: true,
          failure: "cancelled",
          requestHash: hash(JSON.stringify(value)),
          responseHash: hash(raw),
          responseBytes: bytes.byteLength,
        },
      });
      expect(events).toEqual(["cancel", "abort", "reject"]);
      expect(settledAtCancel).toBe(false);
      expect(observedAtCancel).not.toBeInstanceOf(Promise);
      expect(observedAtCancel).toMatchObject({
        stage,
        answers: expectedAnswers,
        evidence: { requestHash: hash(JSON.stringify(value)), responseHash: hash(raw) },
      });
      expect(observedAfterAbort).toBe(observedAtCancel);
      expect(error.observedResult).toBe(observedAtCancel);
      expect(transport.getObservedResult?.()).toBe(observedAtCancel);
      transport.close();
      expect(transport.getObservedResult?.()).toBe(observedAtCancel);
      expect(cancel).toHaveBeenCalledOnce();
      expect(fetch).toHaveBeenCalledOnce();
    },
  );
});
