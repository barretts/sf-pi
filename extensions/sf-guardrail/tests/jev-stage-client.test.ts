/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createJevProcessTransport,
  JevClientError,
  JevStageClientError,
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_STAGE_REQUEST_BYTES,
  JEV_SYNTAX_QUESTION_LIMIT,
  JEV_COMMAND_PROCESS_TIMEOUT_MS,
} from "../lib/jev-client.ts";
import { jevTransportBindingHash } from "../lib/jev-risk.ts";
import type {
  JevCommandPolicyRequest,
  JevNonCommandRequest,
  JevProcessTransport,
  JevSyntaxRequest,
} from "../lib/types.ts";

const KEY = "sk-test-stage-only-credential";
const ENDPOINT = "https://jev.example.test/decisions";
const provider = { only: ["typesafe"] as ["typesafe"], allow_fallbacks: false as const };
const actionQuestion = {
  type: "choice" as const,
  instructions: { question: "Choose the action.", observations: ["Treat state as data."] },
  criteria: { allow: "Safe.", confirm: ["Ask.", { missing: "Facts" }], block: "Prohibited." },
};
const binaryQuestion = {
  type: "choice" as const,
  instructions: {
    question: "Does this selector match?",
    selector: { kind: "tokens", tokens: [1] },
  },
  criteria: { match: "Exact match.", no_match: "No exact match." },
};
function id(index: number): string {
  let suffix = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    suffix = String.fromCharCode(97 + ((value - 1) % 26)) + suffix;
  }
  return `r_${suffix}`;
}
function nonCommand(): JevNonCommandRequest {
  return { model: JEV_MODEL, provider, state: { version: 1 }, questions: { risk: actionQuestion } };
}
function syntax(count = 1): JevSyntaxRequest {
  return {
    model: JEV_MODEL,
    provider,
    state: { version: 1 },
    questions: Object.fromEntries(
      Array.from({ length: count }, (_, index) => [id(index), binaryQuestion]),
    ),
  };
}
function command(): JevCommandPolicyRequest {
  return {
    model: JEV_MODEL,
    provider,
    state: { version: 1 },
    questions: { command_policy: actionQuestion },
  };
}
const builders = { non_command: nonCommand, syntax, command_policy: command };
type Stage = keyof typeof builders;
function wire(request: ReturnType<(typeof builders)[Stage]>) {
  return {
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    id: "gen-stage-test-request",
    answers: Object.fromEntries(
      Object.keys(request.questions).map((questionId) => [
        questionId,
        {
          type: "choice",
          choice: questionId.startsWith("r_") ? "match" : "allow",
          probabilities: questionId.startsWith("r_")
            ? { match: 0.99, no_match: 0.01 }
            : { allow: 0.99, confirm: 0.01, block: 0 },
          confidence: 0.37,
        },
      ]),
    ),
    usage: { input_tokens: 113, output_tokens: 29, cost: 0.0000137 },
  };
}
function responseFetch(value: unknown) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value)));
}
function transport(
  fetch: typeof globalThis.fetch,
  deadline = performance.now() + 1_490,
): JevProcessTransport {
  const result = createJevProcessTransport({ fetch, deadline });
  transports.push(result);
  return result;
}
function invoke(client: JevProcessTransport, stage: Stage, request: unknown) {
  if (stage === "non_command") return client.requestNonCommand(request as JevNonCommandRequest);
  if (stage === "syntax") return client.requestSyntax(request as JevSyntaxRequest);
  return client.requestCommandPolicy(request as JevCommandPolicyRequest);
}
async function send(stage: Stage, request: unknown, fetch: typeof globalThis.fetch) {
  return invoke(transport(fetch), stage, request);
}
function hash(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}
let directory: string;
let transports: JevProcessTransport[];
beforeEach(() => {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  directory = mkdtempSync(join(tmpdir(), "sf-guardrail-stage-client-"));
  transports = [];
});
afterEach(() => {
  for (const client of transports) client.close();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("three bounded stage forms", () => {
  it.each(Object.keys(builders) as Stage[])(
    "retains actual %s heads and key-free wire evidence",
    async (stage) => {
      const request = builders[stage]();
      const value = wire(request);
      const raw = ` \n${JSON.stringify(value)}\n`;
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(raw));
      const result = await send(stage, request, fetch);
      expect(result.stage).toBe(stage);
      expect(result.answers).toEqual(
        Object.fromEntries(
          Object.entries(value.answers).map(([questionId, answer]) => [
            questionId,
            {
              choice: answer.choice,
              probabilities: answer.probabilities,
              confidence: answer.confidence,
            },
          ]),
        ),
      );
      expect(result.evidence).toMatchObject({
        requestedQuestionIds: Object.keys(request.questions),
        requestHash: hash(JSON.stringify(request)),
        responseHash: hash(raw),
        requestBytes: Buffer.byteLength(JSON.stringify(request)),
        responseBytes: Buffer.byteLength(raw),
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        requestId: value.id,
        usage: value.usage,
      });
      expect(result.evidence.transportHash).toBe(jevTransportBindingHash(ENDPOINT));
      expect(result.evidence.latencyMs).toBeGreaterThanOrEqual(0);
      expect(JSON.stringify(result)).not.toContain(KEY);
      expect(JSON.stringify(result)).not.toContain(ENDPOINT);
      if (stage === "syntax" || stage === "command_policy")
        expect(result.answers).not.toHaveProperty("risk");
      expect(fetch).toHaveBeenCalledOnce();
      expect(fetch.mock.calls[0][0]).toBe(ENDPOINT);
      expect(fetch.mock.calls[0][1]).toMatchObject({
        method: "POST",
        redirect: "error",
        body: JSON.stringify(request),
        headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      });
    },
  );

  it("retains every original non-command head", async () => {
    const request: JevNonCommandRequest = {
      ...nonCommand(),
      questions: {
        risk: actionQuestion,
        file_policy: actionQuestion,
        org_policy: actionQuestion,
        disclosure: actionQuestion,
        authority: actionQuestion,
      },
    };
    const value = wire(request);
    value.answers.file_policy = {
      type: "choice",
      choice: "block",
      probabilities: { allow: 0, confirm: 0, block: 1 },
      confidence: 0.91,
    };
    const result = await transport(responseFetch(value)).requestNonCommand(request);
    expect(Object.keys(result.answers)).toEqual(Object.keys(request.questions));
    expect(result.answers.risk.choice).toBe("allow");
    expect(result.answers.file_policy.choice).toBe("block");
  });

  it.each([1, 64])("accepts every row in a %s-row binary request", async (count) => {
    const request = syntax(count);
    const result = await transport(responseFetch(wire(request))).requestSyntax(request);
    expect(Object.keys(result.answers)).toEqual(Object.keys(request.questions));
    expect(result.evidence.requestedQuestionIds).toHaveLength(count);
    expect(result.evidence.requestedQuestionIds[0]).toBe("r_a");
    if (count === 64) expect(result.evidence.requestedQuestionIds.at(-1)).toBe("r_bl");
    expect(JEV_SYNTAX_QUESTION_LIMIT).toBe(64);
  });

  it.each([0, 65])("rejects %s rows before credentials", async (count) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch(wire(nonCommand()));
    await expect(send("syntax", syntax(count), fetch)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ["non_command", { command_policy: actionQuestion }],
    ["non_command", { risk: actionQuestion, command_policy: actionQuestion }],
    ["non_command", { risk: actionQuestion, other: actionQuestion }],
    ["command_policy", { risk: actionQuestion, command_policy: actionQuestion }],
    ["command_policy", { file_policy: actionQuestion }],
    ["command_policy", { other: actionQuestion }],
    ["syntax", { risk: binaryQuestion }],
    ["syntax", { r_b: binaryQuestion }],
    ["syntax", { r_a: binaryQuestion, r_c: binaryQuestion }],
    ["syntax", { r_b: binaryQuestion, r_a: binaryQuestion }],
    ["syntax", { r_A: binaryQuestion }],
    ["syntax", { r_aa: binaryQuestion }],
    ["syntax", { u_a: binaryQuestion }],
    ["syntax", { r_a: actionQuestion }],
  ] as [Stage, unknown][])(
    "rejects wrong IDs, order or options for %s",
    async (stage, questions) => {
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
      const fetch = responseFetch({});
      await expect(send(stage, { ...builders[stage](), questions }, fetch)).rejects.toMatchObject({
        code: "invalid_request",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(builders) as Stage[])(
    "rejects an expanded %s request boundary before credentials",
    async (stage) => {
      const request = builders[stage]();
      const questionId = Object.keys(request.questions)[0];
      const question = request.questions[questionId];
      const fetch = responseFetch({});
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
      for (const changed of [
        { ...request, model: "other/model" },
        { ...request, extra: "text" },
        { ...request, provider: undefined },
        { ...request, provider: { ...provider, sort: "latency" } },
        { ...request, provider: { ...provider, allow_fallbacks: true } },
        { ...request, provider: { ...provider, only: ["typesafe", "other"] } },
        { ...request, questions: { [questionId]: { ...question, type: "score" } } },
        { ...request, questions: { [questionId]: { ...question, extra: "text" } } },
        {
          ...request,
          questions: {
            [questionId]: { ...question, criteria: { ...question.criteria, other: "text" } },
          },
        },
      ])
        await expect(send(stage, changed, fetch)).rejects.toMatchObject({
          code: "invalid_request",
        });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(Object.keys(builders) as Stage[])(
    "checks exact UTF-8 body bytes for %s before credentials",
    async (stage) => {
      const request = { ...builders[stage](), state: "" };
      const baseBytes = Buffer.byteLength(JSON.stringify(request));
      const bounded = { ...request, state: "x".repeat(JEV_STAGE_REQUEST_BYTES - baseBytes) };
      expect(Buffer.byteLength(JSON.stringify(bounded))).toBe(32_768);
      await send(stage, bounded, responseFetch(wire(bounded)));
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
      const fetch = responseFetch({});
      for (const state of [bounded.state + "x", "é".repeat(16_384)]) {
        await expect(send(stage, { ...request, state }, fetch)).rejects.toMatchObject({
          code: "invalid_request",
        });
      }
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("serializes the validated descriptor snapshot, not changing proxy reads", async () => {
    const request = nonCommand();
    const get = vi.fn(() => KEY);
    const changing = new Proxy(request, { get });
    const fetch = responseFetch(wire(request));
    const result = await send("non_command", changing, fetch);
    expect(get).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(request));
    expect(result.evidence.requestHash).toBe(hash(JSON.stringify(request)));
  });

  it("does not call an inherited array serializer after the descriptor check", async () => {
    const serializer = vi.fn(() => ["other"]);
    const getter = vi.fn(() => serializer);
    class ChangedArray extends Array<string> {}
    Object.defineProperty(ChangedArray.prototype, "toJSON", { get: getter });
    const request = {
      ...nonCommand(),
      provider: { ...provider, only: new ChangedArray("typesafe") },
    };
    const fetch = responseFetch(wire(nonCommand()));
    await send("non_command", request, fetch);
    expect(getter).not.toHaveBeenCalled();
    expect(serializer).not.toHaveBeenCalled();
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(nonCommand()));
  });

  it("rejects non-JSON state and questions without invoking accessors", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const getter = vi.fn(() => KEY);
    const accessor = Object.defineProperty({}, "value", { enumerable: true, get: getter });
    const symbol = { [Symbol("hidden")]: "value" };
    const hidden = Object.defineProperty({}, "hidden", { value: "text" });
    const fetch = responseFetch({});
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    for (const state of [
      undefined,
      NaN,
      Infinity,
      1n,
      () => "value",
      new Date(),
      cycle,
      accessor,
      symbol,
      hidden,
      Array(2),
      { toJSON: () => "value" },
    ]) {
      await expect(send("non_command", { ...nonCommand(), state }, fetch)).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    const requestAccessor = Object.defineProperty({}, "model", { enumerable: true, get: getter });
    await expect(send("non_command", requestAccessor, fetch)).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(getter).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("strict actual stage replies", () => {
  it.each(Object.keys(builders) as Stage[])("rejects extra answer fields for %s", async (stage) => {
    const request = builders[stage]();
    const value = wire(request);
    const questionId = Object.keys(request.questions)[0];
    Object.assign(value.answers[questionId], { explanation: "Safe." });
    await expect(send(stage, request, responseFetch(value))).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each(Object.keys(builders) as Stage[])(
    "requires the exact requested %s answer IDs",
    async (stage) => {
      const request = builders[stage]();
      for (const changed of [
        {},
        {
          ...wire(request).answers,
          other: wire(request).answers[Object.keys(request.questions)[0]],
        },
        { other: wire(request).answers[Object.keys(request.questions)[0]] },
      ]) {
        await expect(
          send(stage, request, responseFetch({ ...wire(request), answers: changed })),
        ).rejects.toMatchObject({ code: "invalid_response" });
      }
    },
  );

  it.each([
    [0.5, 0.49],
    [0.51, 0.5],
    [1, 0.01],
    [0.99 - Number.EPSILON, 0],
    [0.4999995, 0.5],
  ])("preserves feasible binary raw numbers %s/%s", async (match, no_match) => {
    const request = syntax();
    const value = wire(request);
    value.answers.r_a.probabilities = { match, no_match };
    value.answers.r_a.choice = match >= no_match ? "match" : "no_match";
    value.answers.r_a.confidence = 0.123456789;
    const result = await transport(responseFetch(value)).requestSyntax(request);
    expect(result.answers.r_a).toEqual({
      choice: value.answers.r_a.choice,
      probabilities: { match, no_match },
      confidence: 0.123456789,
    });
  });

  it.each([
    [0.49, 0.49],
    [0.51, 0.51],
    [1, 0.02],
    [0.333, 0.6670011],
    [0.5 + 2e-12, 0.49],
    [0, 0],
  ])("rejects infeasible binary raw numbers %s/%s", async (match, no_match) => {
    const request = syntax();
    const value = wire(request);
    value.answers.r_a.probabilities = { match, no_match };
    await expect(send("syntax", request, responseFetch(value))).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each(["non_command", "command_policy"] as Stage[])(
    "preserves closed half-cent action rounding for %s",
    async (stage) => {
      const request = builders[stage]();
      const value = wire(request);
      value.answers[Object.keys(request.questions)[0]].probabilities = {
        allow: 0.45999999999999996,
        confirm: 0.45,
        block: 0.08,
      };
      const result = await send(stage, request, responseFetch(value));
      expect(result.answers[Object.keys(request.questions)[0]].probabilities).toEqual({
        allow: 0.45999999999999996,
        confirm: 0.45,
        block: 0.08,
      });
    },
  );

  it.each(Object.keys(builders) as Stage[])(
    "accepts tied maxima and rejects lower selected choices for %s",
    async (stage) => {
      const request = builders[stage]();
      const value = wire(request);
      const questionId = Object.keys(request.questions)[0];
      const binary = stage === "syntax";
      value.answers[questionId].choice = binary ? "no_match" : "confirm";
      value.answers[questionId].probabilities = binary
        ? { match: 0.5, no_match: 0.5 }
        : { allow: 0.33, confirm: 0.33, block: 0.33 };
      expect((await send(stage, request, responseFetch(value))).answers[questionId].choice).toBe(
        value.answers[questionId].choice,
      );
      value.answers[questionId].probabilities = binary
        ? { match: 0.51, no_match: 0.49 }
        : { allow: 0.34, confirm: 0.33, block: 0.34 };
      await expect(send(stage, request, responseFetch(value))).rejects.toMatchObject({
        code: "invalid_response",
      });
    },
  );

  it.each(Object.keys(builders) as Stage[])(
    "rejects malformed %s answer and usage values",
    async (stage) => {
      const request = builders[stage]();
      const questionId = Object.keys(request.questions)[0];
      for (const mutate of [
        (value) => {
          value.answers[questionId].choice = "other";
        },
        (value) => {
          value.answers[questionId].type = "score";
        },
        (value) => {
          value.answers[questionId].confidence = -0.1;
        },
        (value) => {
          value.answers[questionId].confidence = "1";
        },
        (value) => {
          value.answers[questionId].probabilities = {
            allow: 1,
            confirm: 0,
            block: 0,
            match: 1,
            no_match: 0,
          };
        },
        (value) => {
          value.answers[questionId].probabilities = { [stage === "syntax" ? "match" : "allow"]: 1 };
        },
        (value) => {
          value.answers[questionId].probabilities[stage === "syntax" ? "match" : "allow"] = -0.1;
        },
        (value) => {
          value.answers[questionId].probabilities[stage === "syntax" ? "match" : "allow"] = "1";
        },
        (value) => {
          value.id = "unsafe request";
        },
        (value) => {
          value.id = `echo-${KEY}`;
        },
        (value) => {
          delete value.id;
        },
        (value) => {
          value.usage.input_tokens = -1;
        },
        (value) => {
          value.usage.output_tokens = 1.5;
        },
        (value) => {
          value.usage.input_tokens = Infinity;
        },
        (value) => {
          value.usage.cost = -1;
        },
        (value) => {
          value.usage.cost = "0";
        },
      ]) {
        const value = wire(request);
        mutate(value);
        await expect(send(stage, request, responseFetch(value))).rejects.toMatchObject({
          code: "invalid_response",
        });
      }
    },
  );

  it.each(Object.keys(builders) as Stage[])("rejects identity drift for %s", async (stage) => {
    const request = builders[stage]();
    for (const change of [{ model: "typesafe/jev-next" }, { provider: "typesafe" }]) {
      await expect(
        send(stage, request, responseFetch({ ...wire(request), ...change })),
      ).rejects.toMatchObject({ code: "identity_mismatch" });
    }
  });

  it("keeps an absent reported cost unknown", async () => {
    const request = syntax();
    const value = wire(request);
    delete value.usage.cost;
    const result = await transport(responseFetch(value)).requestSyntax(request);
    expect(result.evidence.usage).not.toHaveProperty("cost");
  });

  it.each(Object.keys(builders) as Stage[])(
    "rejects duplicate JSON keys and malformed UTF-8 for %s",
    async (stage) => {
      const request = builders[stage]();
      const raw = JSON.stringify(wire(request));
      const option = stage === "syntax" ? "match" : "allow";
      for (const body of [
        raw.replace(`"${option}":0.99`, `"${option}":0,"${option}":0.99`),
        raw.replace(
          `"${option}":0.99`,
          `"${option}":0,"${option === "match" ? "\\u006datch" : "\\u0061llow"}":0.99`,
        ),
        raw.replace('"model":', '"model":"other","model":'),
        KEY,
        new Uint8Array([0xff]),
      ]) {
        await expect(
          send(
            stage,
            request,
            vi.fn<typeof globalThis.fetch>(async () => new Response(body)),
          ),
        ).rejects.toMatchObject({ code: "invalid_response" });
      }
    },
  );

  it("accepts exactly 65,536 reply bytes and binds all of them", async () => {
    const request = syntax();
    const prefix = JSON.stringify(wire(request));
    const raw = prefix + " ".repeat(65_536 - Buffer.byteLength(prefix));
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(raw, { headers: { "content-length": "65536" } }),
    );
    const result = await transport(fetch).requestSyntax(request);
    expect(result.evidence.responseBytes).toBe(65_536);
    expect(result.evidence.responseHash).toBe(hash(raw));
  });

  it.each(Object.keys(builders) as Stage[])(
    "bounds declared and streamed %s replies",
    async (stage) => {
      const request = builders[stage]();
      for (const declared of [true, false]) {
        const fetch = vi.fn<typeof globalThis.fetch>(
          async () =>
            new Response("x".repeat(65_537), {
              headers: declared ? { "content-length": "65537" } : {},
            }),
        );
        await expect(send(stage, request, fetch)).rejects.toMatchObject({
          code: "response_too_large",
        });
        expect(fetch).toHaveBeenCalledOnce();
      }
    },
  );

  it.each([401, 429, 500])("sanitizes HTTP %s with no retry", async (status) => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () => new Response(`${KEY} ${ENDPOINT}`, { status }),
    );
    const client = transport(fetch);
    const error = await client.requestNonCommand(nonCommand()).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevClientError);
    expect(error).toMatchObject({ code: "http_error", message: "Jev request failed: http_error." });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
    await expect(client.requestSyntax(syntax())).rejects.toMatchObject({ code: "http_error" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});

describe("bounded failed-attempt evidence", () => {
  it("records valid preparation on a credential failure without dispatch", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const request = nonCommand();
    const fetch = responseFetch({});
    const error = await send("non_command", request, fetch).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevStageClientError);
    expect(error.evidence).toMatchObject({
      stage: "non_command",
      requestedQuestionIds: ["risk"],
      requestHash: hash(JSON.stringify(request)),
      requestBytes: Buffer.byteLength(JSON.stringify(request)),
      requestSent: false,
      failure: "invalid_credentials",
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(error.evidence).not.toHaveProperty("responsePrefixHash");
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not copy unknown IDs or invalid request text into a pre-dispatch failure", async () => {
    const fetch = responseFetch({});
    const error = await send(
      "syntax",
      { ...syntax(), questions: { [KEY]: binaryQuestion } },
      fetch,
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevStageClientError);
    expect(error.evidence).toMatchObject({
      stage: "syntax",
      requestedQuestionIds: [],
      requestSent: false,
      failure: "invalid_request",
    });
    expect(error.evidence).not.toHaveProperty("requestHash");
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("binds a complete malformed reply without retaining its text or answers", async () => {
    const request = command();
    const raw = `${KEY} ${ENDPOINT}`;
    const error = await send(
      "command_policy",
      request,
      vi.fn<typeof globalThis.fetch>(async () => new Response(raw)),
    ).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevStageClientError);
    expect(error.evidence).toMatchObject({
      requestSent: true,
      responseComplete: true,
      responseHash: hash(raw),
      responseBytes: Buffer.byteLength(raw),
      failure: "invalid_response",
    });
    expect(error.evidence).not.toHaveProperty("responsePrefixHash");
    expect(error.evidence).not.toHaveProperty("answers");
    expect(JSON.stringify(error)).not.toContain(raw);
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
  });

  it("marks a failed stream as a prefix and preserves only received bytes", async () => {
    const prefix = new TextEncoder().encode('{"model":');
    let index = 0;
    const cancel = vi.fn(async () => {});
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                if (index++ === 0) return { done: false, value: prefix };
                throw new Error(`${KEY} ${ENDPOINT}`);
              },
              cancel,
            }),
          },
        }) as unknown as Response,
    );
    const error = await send("syntax", syntax(), fetch).catch((caught) => caught);
    expect(error.evidence).toMatchObject({
      requestSent: true,
      responseComplete: false,
      responsePrefixHash: hash(prefix),
      responsePrefixBytes: prefix.length,
      failure: "transport_error",
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(error.evidence).not.toHaveProperty("responseBytes");
    expect(cancel).toHaveBeenCalledOnce();
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
  });

  it("bounds an oversized received chunk to an explicit prefix", async () => {
    const bytes = new Uint8Array(65_537).fill(120);
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes));
    const error = await send("syntax", syntax(), fetch).catch((caught) => caught);
    expect(error.evidence).toMatchObject({
      responseComplete: false,
      responsePrefixHash: hash(bytes.subarray(0, 65_536)),
      responsePrefixBytes: 65_536,
      failure: "response_too_large",
    });
    expect(error.evidence).not.toHaveProperty("responseHash");
  });

  it("copies received byte chunks before a stream reuses its buffer", async () => {
    const request = nonCommand();
    const raw = JSON.stringify(wire(request));
    const bytes = new TextEncoder().encode(raw);
    let count = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                if (count++ === 0) return { done: false, value: bytes };
                bytes.fill(120);
                return { done: true };
              },
              cancel: async () => {},
            }),
          },
        }) as unknown as Response,
    );
    const result = await send("non_command", request, fetch);
    expect(result.evidence.responseHash).toBe(hash(raw));
    expect(result.stage).toBe("non_command");
    if (result.stage === "non_command") expect(result.answers.risk.choice).toBe("allow");
  });

  it("rejects a malformed end marker without claiming a complete reply", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => ({ done: "true" }),
              cancel: async () => {},
            }),
          },
        }) as unknown as Response,
    );
    const error = await send("syntax", syntax(), fetch).catch((caught) => caught);
    expect(error).toMatchObject({ code: "invalid_response" });
    expect(error.evidence).not.toHaveProperty("responseHash");
    expect(error.evidence).not.toHaveProperty("responseComplete");
  });

  it("preserves a raw negative zero instead of normalizing it", async () => {
    const request = syntax();
    const value = wire(request);
    value.answers.r_a.choice = "no_match";
    value.answers.r_a.probabilities = { match: 0, no_match: 1 };
    const raw = JSON.stringify(value).replace('"match":0', '"match":-0');
    const result = await transport(
      vi.fn<typeof globalThis.fetch>(async () => new Response(raw)),
    ).requestSyntax(request);
    expect(Object.is(result.answers.r_a.probabilities.match, -0)).toBe(true);
    expect(result.evidence.responseHash).toBe(hash(raw));
  });

  it("keeps the sanitized result when malformed-stream cleanup throws", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => ({ done: false, value: "invalid chunk" }),
              cancel: () => {
                throw new Error(`${KEY} ${ENDPOINT}`);
              },
            }),
          },
        }) as unknown as Response,
    );
    const error = await send("syntax", syntax(), fetch).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevStageClientError);
    expect(error).toMatchObject({
      code: "invalid_response",
      message: "Jev request failed: invalid_response.",
    });
    expect(error.evidence).not.toHaveProperty("responsePrefixHash");
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
  });

  it("rejects serialized key text before dispatch", async () => {
    const key = 'sk-test-key-"quote"-\\-only';
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", key);
    const fetch = responseFetch({});
    const error = await send(
      "non_command",
      { ...nonCommand(), state: { value: key } },
      fetch,
    ).catch((caught) => caught);
    expect(error.evidence).toMatchObject({ requestSent: false, failure: "invalid_request" });
    expect(JSON.stringify(error)).not.toContain(key);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("one endpoint, key, cancellation and absolute deadline", () => {
  it("captures a canonical endpoint before it reads a key", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "HTTPS://JEV.EXAMPLE.TEST:443/v1/../decisions");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch(wire(nonCommand()));
    const client = transport(fetch);
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "http://changed.invalid/private");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", KEY);
    await client.requestNonCommand(nonCommand());
    expect(fetch.mock.calls[0][0]).toBe(ENDPOINT);
  });

  it.each([
    "http://invalid.example.test",
    `https://user:${KEY}@private.example.test/decisions`,
    "https://jev.example.test/decisions?",
    "https://jev.example.test/decisions#",
    "https://jev.example.test/deci\\sions",
    "x".repeat(4_097),
  ])("rejects endpoint configuration before credentials", (endpoint) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch({});
    let error: unknown;
    try {
      createJevProcessTransport({ deadline: performance.now() + 1_490, fetch, endpoint });
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({ code: "invalid_endpoint" });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(endpoint);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads the key file once across all three calls", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const path = join(directory, "test-key");
    writeFileSync(path, KEY, { mode: 0o600 });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", path);
    const fetch = vi.fn<typeof globalThis.fetch>(
      async (_url, init) => new Response(JSON.stringify(wire(JSON.parse(init.body as string)))),
    );
    const client = transport(fetch);
    const first = await client.requestNonCommand(nonCommand());
    writeFileSync(path, "invalid\nchanged-key");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "changed-environment-key");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", join(directory, "missing"));
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "https://other.example.test/decisions");
    const second = await client.requestSyntax(syntax());
    const third = await client.requestCommandPolicy(command());
    for (const [url, init] of fetch.mock.calls) {
      expect(url).toBe(ENDPOINT);
      expect(init.headers).toMatchObject({ Authorization: `Bearer ${KEY}` });
    }
    expect(
      new Set([
        first.evidence.transportHash,
        second.evidence.transportHash,
        third.evidence.transportHash,
      ]).size,
    ).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("sanitizes transport failure and does not call a later stage", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(`${KEY} ${ENDPOINT}`);
    });
    const client = transport(fetch);
    await expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "transport_error",
      message: "Jev request failed: transport_error.",
    });
    await expect(client.requestSyntax(syntax())).rejects.toMatchObject({ code: "transport_error" });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects key text in the body after the credential read and before fetch", async () => {
    const fetch = responseFetch({});
    await expect(
      send("non_command", { ...nonCommand(), state: { hidden: KEY } }, fetch),
    ).rejects.toMatchObject({ code: "invalid_request" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity])("rejects a non-finite absolute deadline %s", (deadline) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    expect(() => createJevProcessTransport({ deadline, fetch: responseFetch({}) })).toThrow(
      "invalid_request",
    );
  });

  it("rejects an extended or expired deadline before credentials", () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    expect(() =>
      createJevProcessTransport({ deadline: JEV_COMMAND_PROCESS_TIMEOUT_MS + 0.001 }),
    ).toThrow("invalid_request");
    expect(() => createJevProcessTransport({ deadline: 0 })).toThrow("timeout");
    expect(() => createJevProcessTransport({ deadline: -1 })).toThrow("timeout");
  });
  it("admits exactly 10,000 ms and uses that bound after an earlier stage and idle time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(new Response(JSON.stringify(wire(nonCommand())))), 4_000),
          ),
      )
      .mockImplementation(() => new Promise<Response>(() => {}));
    const client = transport(fetch, 10_000);
    const first = client.requestNonCommand(nonCommand());
    await vi.advanceTimersByTimeAsync(4_000);
    expect((await first).evidence.latencyMs).toBe(4_000);
    await vi.advanceTimersByTimeAsync(1_000);
    const second = client.requestSyntax(syntax());
    const rejection = expect(second).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(4_999);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await rejection;
    expect(performance.now()).toBe(10_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].signal).toBe(fetch.mock.calls[1][1].signal);
    await expect(client.requestCommandPolicy(command())).rejects.toMatchObject({ code: "timeout" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("includes stage preparation in the 10,000 ms deadline before credentials", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const request = new Proxy(nonCommand(), {
      ownKeys(target) {
        vi.advanceTimersByTime(10_000);
        return Reflect.ownKeys(target);
      },
    });
    const fetch = responseFetch({});
    const error = await transport(fetch, 10_000)
      .requestNonCommand(request)
      .catch((caught) => caught);
    expect(error).toMatchObject({ code: "timeout" });
    expect(error.evidence.requestSent).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("includes response reads in the original 10,000 ms deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const bytes = new TextEncoder().encode(JSON.stringify(wire(syntax())));
    let reads = 0;
    const cancel = vi.fn(async () => {});
    const fetch = vi.fn<typeof globalThis.fetch>(
      async () =>
        ({
          ok: true,
          headers: new Headers(),
          body: {
            getReader: () => ({
              read: async () => {
                await new Promise((resolve) => setTimeout(resolve, reads++ === 0 ? 9_000 : 1_000));
                return reads === 1 ? { done: false, value: bytes } : { done: true };
              },
              cancel,
            }),
          },
        }) as unknown as Response,
    );
    const rejection = expect(
      transport(fetch, 10_000).requestSyntax(syntax()),
    ).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(10_000);
    await rejection;
    expect(reads).toBe(2);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([9_999, 10_000])(
    "includes a %s ms cleanup callback and retains the whole reply hash",
    async (cleanupMs) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
      const raw = JSON.stringify(wire(syntax()));
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
      const actual = await transport(fetch, 10_000)
        .requestSyntax(syntax())
        .catch((caught) => caught);
      if (cleanupMs === 9_999) {
        expect(actual.stage).toBe("syntax");
        expect(actual.answers.r_a.choice).toBe("match");
      } else {
        expect(actual).toMatchObject({ code: "timeout" });
        expect(actual.evidence.responseComplete).toBe(true);
      }
      expect(actual.evidence).toMatchObject({ responseHash: hash(raw), latencyMs: cleanupMs });
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    },
  );

  it("keeps the earlier caller deadline across stages and idle time", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(new Response(JSON.stringify(wire(nonCommand())))), 700),
          ),
      )
      .mockImplementation(() => new Promise<Response>(() => {}));
    const client = transport(fetch, 1_200);
    const first = client.requestNonCommand(nonCommand());
    await vi.advanceTimersByTimeAsync(700);
    await first;
    await vi.advanceTimersByTimeAsync(200);
    const second = client.requestSyntax(syntax());
    const rejection = expect(second).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(300);
    await rejection;
    expect(performance.now()).toBe(1_200);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[0][1].signal).toBe(fetch.mock.calls[1][1].signal);
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
    await expect(client.requestCommandPolicy(command())).rejects.toMatchObject({ code: "timeout" });
  });

  it("does not read credentials after the process expires between calls", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch({});
    const client = transport(fetch, 100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({ code: "timeout" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects an already cancelled process before endpoint and credentials", () => {
    const controller = new AbortController();
    controller.abort(new Error(KEY));
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "invalid");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    expect(() =>
      createJevProcessTransport({ deadline: performance.now() + 1_490, signal: controller.signal }),
    ).toThrow("cancelled");
  });

  it("cancels a fetch that ignores AbortSignal without waiting or retry", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const client = createJevProcessTransport({
      deadline: performance.now() + 1_490,
      signal: controller.signal,
      fetch,
    });
    transports.push(client);
    const rejection = expect(client.requestSyntax(syntax())).rejects.toMatchObject({
      code: "cancelled",
      message: "Jev request failed: cancelled.",
    });
    controller.abort(new Error(`${KEY} ${ENDPOINT}`));
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    await expect(client.requestCommandPolicy(command())).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("bounds a stream that ignores abort and has a stalled cancel method", async () => {
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
    const client = transport(fetch, 200);
    const rejection = expect(client.requestSyntax(syntax())).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(200);
    await rejection;
    expect(read).toHaveBeenCalledOnce();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("cancels a response that arrives after a fetch ignored timeout", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    let finish: (response: Response) => void;
    const fetch = vi.fn<typeof globalThis.fetch>(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const client = transport(fetch, 100);
    const rejection = expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    finish(new Response(stream));
    await Promise.resolve();
    await Promise.resolve();
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects a concurrent stage and cancels the first without another dispatch", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const client = transport(fetch);
    const first = expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(client.requestSyntax(syntax())).rejects.toMatchObject({ code: "invalid_request" });
    await first;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("keeps its deadline and fetch snapshot if the options object changes", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const originalFetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const changedFetch = responseFetch(wire(nonCommand()));
    const options = { deadline: 100, fetch: originalFetch, endpoint: ENDPOINT };
    const client = createJevProcessTransport(options);
    transports.push(client);
    options.deadline = 1_500;
    options.fetch = changedFetch;
    options.endpoint = "http://invalid.example.test";
    const rejection = expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    expect(originalFetch).toHaveBeenCalledOnce();
    expect(changedFetch).not.toHaveBeenCalled();
  });

  it("captures each option once so a getter cannot extend the deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    let reads = 0;
    const deadlineGetter = vi.fn(() => (++reads <= 3 ? 100 : 30_000));
    const endpointGetter = vi.fn(() => ENDPOINT);
    const fetchGetter = vi.fn(() => fetch);
    const signalGetter = vi.fn(() => undefined);
    const options = Object.defineProperties(
      {},
      {
        deadline: { get: deadlineGetter },
        signal: { get: signalGetter },
        endpoint: { get: endpointGetter },
        fetch: { get: fetchGetter },
      },
    );
    const client = createJevProcessTransport(
      options as Parameters<typeof createJevProcessTransport>[0],
    );
    transports.push(client);
    const rejection = expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(100);
    await rejection;
    for (const getter of [deadlineGetter, endpointGetter, fetchGetter, signalGetter])
      expect(getter).toHaveBeenCalledOnce();
    expect(performance.now()).toBe(100);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("sanitizes an options getter failure before credentials or dispatch", () => {
    const options = Object.defineProperty({}, "deadline", {
      get: () => {
        throw new Error(`${KEY} ${ENDPOINT}`);
      },
    });
    let error: unknown;
    try {
      createJevProcessTransport(options as Parameters<typeof createJevProcessTransport>[0]);
    } catch (caught) {
      error = caught;
    }
    expect(error).toMatchObject({
      code: "invalid_request",
      message: "Jev request failed: invalid_request.",
    });
    expect(JSON.stringify(error)).not.toContain(KEY);
    expect(JSON.stringify(error)).not.toContain(ENDPOINT);
  });

  it("closes the process and refuses later stages before credentials", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch({});
    const client = transport(fetch);
    client.close();
    await expect(client.requestNonCommand(nonCommand())).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(fetch).not.toHaveBeenCalled();
  });
});
