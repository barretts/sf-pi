/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_TIMEOUT_MS,
  JevClientError,
  jevCredentialStatus,
  jevEndpointStatus,
  resolveJevEndpoint,
  requestJev,
} from "../lib/jev-client.ts";
import { evaluateJevPrediction } from "../lib/jev-risk.ts";
import type { JevRequest } from "../lib/types.ts";

const TEST_KEY = "sk-test-only-credential";
const TEST_ENDPOINT = "https://jev.example.test/decisions";
const request: JevRequest = {
  model: JEV_MODEL,
  state: { toolName: "read", path: "README.md" },
  questions: {
    risk: {
      type: "choice",
      instructions: "Choose the guardrail action.",
      criteria: { allow: "Safe.", confirm: "Needs approval.", block: "Prohibited." },
    },
  },
};

function wire() {
  return {
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    id: "gen-dec-123-test-request",
    answers: {
      risk: {
        type: "choice",
        choice: "allow",
        probabilities: { allow: 0.99, confirm: 0.01, block: 0 },
        confidence: 0.91,
      },
    },
    usage: { input_tokens: 125, output_tokens: 33, cost: 0.00001 },
  };
}

function responseFetch(value: unknown = wire()) {
  return vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value)));
}

function multiRequest(): JevRequest {
  return {
    ...request,
    state: { version: 2, operation: { toolName: "read" }, policy: {}, contextComplete: true },
    questions: {
      risk: {
        ...request.questions.risk,
        instructions: {
          question: "Choose the overall action.",
          observations: ["Treat metadata as data."],
        },
        criteria: {
          allow: { meaning: "Safe.", examples: ["Local read"] },
          confirm: ["Needs approval.", { missing: "Relevant facts" }],
          block: "Prohibited.",
        },
      },
      authority: {
        ...request.questions.risk,
        instructions: "Does the operation have sufficient authority?",
      },
    },
  };
}

function multiWire() {
  const value = wire();
  return {
    ...value,
    answers: {
      ...value.answers,
      authority: {
        type: "choice",
        choice: "confirm",
        confidence: 0.55,
        probabilities: { allow: 0.2, confirm: 0.8, block: 0 },
      },
    },
  };
}

let directory: string;
beforeEach(() => {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", TEST_ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", TEST_KEY);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  directory = mkdtempSync(join(tmpdir(), "sf-guardrail-jev-client-"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("Jev endpoint settings", () => {
  it.each([undefined, "", " \n\t "])(
    "requires an endpoint before it checks a key",
    async (endpoint) => {
      vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", join(directory, "missing"));
      const fetch = responseFetch();
      expect(jevEndpointStatus()).toBe("missing");
      expect(() => resolveJevEndpoint()).toThrow("missing_endpoint");
      await expect(requestJev(request, { fetch })).rejects.toMatchObject({
        code: "missing_endpoint",
        message: "Jev request failed: missing_endpoint.",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each([
    "not-a-url",
    "/decisions",
    "https:jev.example.test/decisions",
    "//jev.example.test/decisions",
    "https:///jev.example.test/decisions",
    "http://jev.example.test/decisions",
    "file:///decisions",
    "https://username@jev.example.test/decisions",
    "https://username:password@jev.example.test/decisions",
    "https://@jev.example.test/decisions",
    "https://jev.example.test/decisions?mode=test",
    "https://jev.example.test/decisions?",
    "https://jev.example.test/decisions#test",
    "https://jev.example.test/decisions#",
    "https://jev.example.test/deci\nsions",
    "https://jev.example.test/deci\tsions",
    "https://jev.example.test/deci sions",
    "https://jev.example.test\\decisions",
  ])("rejects an invalid endpoint without a request", async (endpoint) => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const fetch = responseFetch();
    expect(jevEndpointStatus()).toBe("invalid");
    expect(() => resolveJevEndpoint()).toThrow("invalid_endpoint");
    await expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "invalid_endpoint",
      message: "Jev request failed: invalid_endpoint.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes a full HTTPS URL that has no URL key, query, or fragment", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", " \tHTTPS://JEV.EXAMPLE.TEST:443/v1/../decisions\n ");
    const fetch = responseFetch();
    expect(resolveJevEndpoint()).toBe(TEST_ENDPOINT);
    expect(jevEndpointStatus()).toBe("ready");
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][0]).toBe(TEST_ENDPOINT);
  });

  it("keeps the captured endpoint when the environment setting changes", async () => {
    const endpoint = resolveJevEndpoint();
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", "http://changed.example.test/private");
    const fetch = responseFetch();
    await requestJev(request, { fetch, endpoint });
    expect(fetch.mock.calls[0][0]).toBe(TEST_ENDPOINT);
    expect(fetch.mock.calls[0][1].body).toBe(JSON.stringify(request));
    expect(jevEndpointStatus()).toBe("invalid");
  });

  it("accepts the 4096-byte input limit", async () => {
    const prefix = `${TEST_ENDPOINT}/`;
    const endpoint = prefix + "a".repeat(4096 - Buffer.byteLength(prefix));
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
    const fetch = responseFetch();
    expect(resolveJevEndpoint()).toBe(endpoint);
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][0]).toBe(endpoint);
  });

  it.each(["a".repeat(4096), "é".repeat(2048)])(
    "rejects oversized endpoint bytes before it checks a key",
    async (path) => {
      const endpoint = `${TEST_ENDPOINT}/${path}`;
      vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", join(directory, "missing"));
      const fetch = responseFetch();
      expect(jevEndpointStatus()).toBe("invalid");
      await expect(requestJev(request, { fetch })).rejects.toMatchObject({
        code: "invalid_endpoint",
      });
      await expect(requestJev(request, { fetch, endpoint })).rejects.toMatchObject({
        code: "invalid_endpoint",
      });
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("checks an explicit endpoint with the same rules before it checks a key", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\nkey");
    const fetch = responseFetch();
    for (const endpoint of [
      "http://jev.example.test/decisions",
      "https://user:password@jev.example.test/decisions",
      "https://jev.example.test/decisions?",
      "https://jev.example.test/decisions#",
      "https://jev.example.test/deci\nsions",
      "https://jev.example.test\\decisions",
      null,
      123,
    ]) {
      await expect(
        requestJev(request, { fetch, endpoint: endpoint as string }),
      ).rejects.toMatchObject({ code: "invalid_endpoint" });
    }
    await expect(requestJev(request, { fetch, endpoint: "" })).rejects.toMatchObject({
      code: "missing_endpoint",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes an explicit endpoint when no environment endpoint is set", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", undefined);
    const fetch = responseFetch();
    await requestJev(request, {
      fetch,
      endpoint: "https://JEV.EXAMPLE.TEST:443/v1/../decisions",
    });
    expect(fetch.mock.calls[0][0]).toBe(TEST_ENDPOINT);
  });

  it("keeps endpoint errors free of the URL and key", async () => {
    const endpoint = `https://user:${TEST_KEY}@private.example.test/decisions?private-value`;
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", endpoint);
    const error = await requestJev(request, { fetch: responseFetch() }).catch((caught) => caught);
    expect(error).toBeInstanceOf(JevClientError);
    expect(error).toMatchObject({ code: "invalid_endpoint" });
    expect(JSON.stringify(error)).not.toContain(TEST_KEY);
    expect(JSON.stringify(error)).not.toContain(endpoint);
    expect(jevEndpointStatus()).toBe("invalid");
  });
});

describe("requestJev", () => {
  it("uses the configured endpoint and returns valid output token counts", async () => {
    const fetch = responseFetch();
    const result = await requestJev(request, { fetch });
    expect(result).toEqual({
      choice: "allow",
      probabilities: { allow: 0.99, confirm: 0.01, block: 0 },
      confidence: 0.91,
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      requestId: "gen-dec-123-test-request",
      usage: { input_tokens: 125, output_tokens: 33, cost: 0.00001 },
    });
    expect(fetch).toHaveBeenCalledOnce();
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe(TEST_ENDPOINT);
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(options.headers).toEqual({
      Authorization: `Bearer ${TEST_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(options.body as string)).toEqual(request);
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("accepts structured JSON instructions/criteria and retains each observed answer without synthesizing probabilities", async () => {
    const requested = multiRequest();
    const fetch = responseFetch(multiWire());
    const result = await requestJev(requested, { fetch });
    expect(result.choice).toBe("allow");
    expect(result.probabilities).toEqual({ allow: 0.99, confirm: 0.01, block: 0 });
    expect(result.confidence).toBe(0.91);
    expect(result.answers).toEqual({
      risk: {
        choice: "allow",
        confidence: 0.91,
        probabilities: { allow: 0.99, confirm: 0.01, block: 0 },
      },
      authority: {
        choice: "confirm",
        confidence: 0.55,
        probabilities: { allow: 0.2, confirm: 0.8, block: 0 },
      },
    });
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual(requested);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("forwards the exact pinned provider routing preference when supplied", async () => {
    const requested: JevRequest = {
      ...request,
      provider: { only: ["typesafe"], allow_fallbacks: false },
    };
    const fetch = responseFetch();
    await requestJev(requested, { fetch });
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).provider).toEqual({
      only: ["typesafe"],
      allow_fallbacks: false,
    });
  });

  it("rejects alternate, incomplete, fallback-enabled, or expanded provider routing before fetching", async () => {
    const fetch = responseFetch();
    for (const provider of [
      undefined,
      null,
      {},
      { only: ["TypeSafe"], allow_fallbacks: false },
      { only: ["typesafe", "other"], allow_fallbacks: false },
      { only: [], allow_fallbacks: false },
      { only: ["typesafe"], allow_fallbacks: true },
      { only: ["typesafe"] },
      { only: ["typesafe"], allow_fallbacks: false, sort: "latency" },
    ]) {
      await expect(
        requestJev({ ...request, provider } as unknown as JevRequest, { fetch }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("allows all six known question IDs in one request and preserves risk-only compatibility", async () => {
    const ids = ["risk", "file_policy", "command_policy", "org_policy", "disclosure", "authority"];
    const requested = {
      ...request,
      questions: Object.fromEntries(ids.map((id) => [id, request.questions.risk])),
    } as JevRequest;
    const value = {
      ...wire(),
      answers: Object.fromEntries(ids.map((id) => [id, wire().answers.risk])),
    };
    const result = await requestJev(requested, { fetch: responseFetch(value) });
    expect(Object.keys(result.answers).sort()).toEqual(ids.sort());
    expect((await requestJev(request, { fetch: responseFetch() })).answers).toBeUndefined();
  });

  it.each([
    [
      "missing second answer",
      (value: ReturnType<typeof multiWire>) => {
        delete value.answers.authority;
      },
    ],
    [
      "missing risk",
      (value: ReturnType<typeof multiWire>) => {
        delete value.answers.risk;
      },
    ],
    [
      "extra known answer",
      (value: ReturnType<typeof multiWire>) => {
        Object.assign(value.answers, { file_policy: value.answers.risk });
      },
    ],
    [
      "extra unknown answer",
      (value: ReturnType<typeof multiWire>) => {
        Object.assign(value.answers, { other: value.answers.risk });
      },
    ],
    [
      "prose second answer",
      (value: ReturnType<typeof multiWire>) => {
        Object.assign(value.answers, { authority: "The action is safe." });
      },
    ],
    [
      "wrong second type",
      (value: ReturnType<typeof multiWire>) => {
        value.answers.authority.type = "score";
      },
    ],
    [
      "invalid second confidence",
      (value: ReturnType<typeof multiWire>) => {
        value.answers.authority.confidence = -1;
      },
    ],
    [
      "invalid second probabilities",
      (value: ReturnType<typeof multiWire>) => {
        value.answers.authority.probabilities.confirm = 0.7;
      },
    ],
    [
      "second choice disagrees with maximum",
      (value: ReturnType<typeof multiWire>) => {
        value.answers.authority.choice = "allow";
      },
    ],
  ])("strictly rejects a multi-question response with %s", async (_name, mutate) => {
    const value = multiWire();
    mutate(value);
    await expect(requestJev(multiRequest(), { fetch: responseFetch(value) })).rejects.toMatchObject(
      { code: "invalid_response" },
    );
  });

  it("rejects duplicate keys inside a second answer", async () => {
    const text = JSON.stringify(multiWire()).replace('"allow":0.2', '"allow":0.1,"allow":0.2');
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(text));
    await expect(requestJev(multiRequest(), { fetch })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects unknown question IDs, a missing risk question, and malformed secondary questions before fetch", async () => {
    const fetch = responseFetch(multiWire());
    for (const questions of [
      { authority: request.questions.risk },
      { ...request.questions, unrelated: request.questions.risk },
      { ...request.questions, authority: { ...request.questions.risk, type: "score" } },
      {
        ...request.questions,
        authority: { ...request.questions.risk, criteria: { allow: "Safe" } },
      },
    ]) {
      await expect(
        requestJev({ ...request, questions } as JevRequest, { fetch }),
      ).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects non-JSON structured criteria rather than serializing them into a different question", async () => {
    const cycle: Record<string, unknown> = {};
    cycle.self = cycle;
    const getter = vi.fn(() => "hidden");
    const accessor = Object.defineProperty({}, "meaning", { enumerable: true, get: getter });
    const fetch = responseFetch();
    for (const criterion of [
      undefined,
      () => "safe",
      Infinity,
      NaN,
      1n,
      new Date(),
      cycle,
      accessor,
      { toJSON: () => "safe" },
    ]) {
      const requested = {
        ...request,
        questions: {
          risk: {
            ...request.questions.risk,
            criteria: { ...request.questions.risk.criteria, allow: criterion },
          },
        },
      } as JevRequest;
      await expect(requestJev(requested, { fetch })).rejects.toMatchObject({
        code: "invalid_request",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(["confirm", "block"])(
    "accepts a valid %s choice without remapping it",
    async (choice) => {
      const value = wire();
      value.answers.risk.choice = choice;
      value.answers.risk.probabilities = {
        allow: 0,
        confirm: choice === "confirm" ? 1 : 0,
        block: choice === "block" ? 1 : 0,
      };
      expect((await requestJev(request, { fetch: responseFetch(value) })).choice).toBe(choice);
    },
  );

  it.each([
    [0.93, 0.05, 0.01],
    [0.33, 0.33, 0.33],
    [0.34, 0.34, 0.33],
    [0.99, 0, 0],
    [1, 0.01, 0],
    [0.45999999999999996, 0.45, 0.08],
  ])("preserves a feasible rounded distribution %s/%s/%s", async (allow, confirm, block) => {
    const value = wire();
    value.answers.risk.probabilities = { allow, confirm, block };
    value.answers.risk.confidence = 0.9;
    const fetch = responseFetch(value);
    const result = await requestJev(request, { fetch });
    expect(result.probabilities).toEqual({ allow, confirm, block });
    expect(result.choice).toBe("allow");
    expect(result.confidence).toBe(0.9);
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each([
    [0.334, 0.333, 0.333],
    [0.4999995, 0.25, 0.25],
  ])(
    "preserves the existing exact-normalization tolerance for %s/%s/%s",
    async (allow, confirm, block) => {
      const value = wire();
      value.answers.risk.probabilities = { allow, confirm, block };
      const result = await requestJev(request, { fetch: responseFetch(value) });
      expect(result.probabilities).toEqual({ allow, confirm, block });
    },
  );

  it.each([
    [0.34, 0.34, 0.34],
    [0.33, 0.33, 0.32],
    [1, 0.02, 0],
    [0, 0, 0],
    [0.333, 0.333, 0.333],
    [0.46 + 2e-12, 0.45, 0.08],
  ])("rejects infeasible or non-lattice distributions %s/%s/%s", async (allow, confirm, block) => {
    const value = wire();
    value.answers.risk.probabilities = { allow, confirm, block };
    await expect(requestJev(request, { fetch: responseFetch(value) })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("accepts any selected tied maximum without changing the choice", async () => {
    const value = wire();
    value.answers.risk.choice = "confirm";
    value.answers.risk.probabilities = { allow: 0.33, confirm: 0.33, block: 0.33 };
    const result = await requestJev(request, { fetch: responseFetch(value) });
    expect(result.choice).toBe("confirm");
    expect(result.probabilities).toEqual(value.answers.risk.probabilities);
  });

  it("rejects a rounded distribution whose selected choice is below the maximum", async () => {
    const value = wire();
    value.answers.risk.choice = "confirm";
    value.answers.risk.probabilities = { allow: 0.34, confirm: 0.33, block: 0.34 };
    await expect(requestJev(request, { fetch: responseFetch(value) })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("preserves a rounded secondary answer without combining probabilities", async () => {
    const value = multiWire();
    value.answers.authority.probabilities = { allow: 0.01, confirm: 0.93, block: 0.05 };
    const result = await requestJev(multiRequest(), { fetch: responseFetch(value) });
    expect(result.probabilities).toEqual(value.answers.risk.probabilities);
    expect(result.answers.authority).toEqual({
      choice: "confirm",
      confidence: 0.55,
      probabilities: value.answers.authority.probabilities,
    });
  });

  it("rejects a rounded primary answer with an infeasible secondary distribution", async () => {
    const value = multiWire();
    value.answers.risk.probabilities = { allow: 0.93, confirm: 0.05, block: 0.01 };
    value.answers.authority.probabilities = { allow: 0.34, confirm: 0.35, block: 0.34 };
    await expect(requestJev(multiRequest(), { fetch: responseFetch(value) })).rejects.toMatchObject(
      {
        code: "invalid_response",
      },
    );
  });

  it("keeps a near-cent allow probability below the actual execution cutoff", async () => {
    const value = wire();
    value.answers.risk.probabilities = { allow: 0.99 - Number.EPSILON, confirm: 0, block: 0 };
    const result = await requestJev(request, { fetch: responseFetch(value) });
    expect(result.probabilities).toEqual(value.answers.risk.probabilities);
    expect(result.probabilities.allow).toBeLessThan(0.99);
    expect(evaluateJevPrediction(result, true)).toBe("confirm");
  });

  it("fails a fetch that ignores AbortSignal at the total deadline without retrying", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const pending = requestJev(request, { fetch });
    const rejection = expect(pending).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);
    await rejection;
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("includes a stalled streamed response body in the deadline and cancels it", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"model":'));
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(stream));
    const rejection = expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "timeout",
    });
    await vi.advanceTimersByTimeAsync(JEV_TIMEOUT_MS);
    await rejection;
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("propagates caller cancellation even when fetch ignores the signal", async () => {
    const controller = new AbortController();
    const fetch = vi.fn<typeof globalThis.fetch>(() => new Promise<Response>(() => {}));
    const rejection = expect(
      requestJev(request, { fetch, signal: controller.signal }),
    ).rejects.toMatchObject({
      code: "cancelled",
    });
    controller.abort(new Error(TEST_KEY));
    await rejection;
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
  });

  it("does not read credentials or fetch for an already cancelled call", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const controller = new AbortController();
    controller.abort();
    const fetch = responseFetch();
    await expect(requestJev(request, { fetch, signal: controller.signal })).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects oversized bodies both with and without declared length", async () => {
    for (const declared of [false, true]) {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () =>
          new Response("x".repeat(65_537), {
            headers: declared ? { "content-length": "65537" } : {},
          }),
      );
      await expect(requestJev(request, { fetch })).rejects.toMatchObject({
        code: "response_too_large",
      });
    }
  });

  it.each([401, 429, 500])(
    "sanitizes HTTP %s including credential echoes without retrying",
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(TEST_KEY, { status }));
      let error: unknown;
      try {
        await requestJev(request, { fetch });
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(JevClientError);
      expect(error).toMatchObject({
        code: "http_error",
        message: "Jev request failed: http_error.",
      });
      expect(JSON.stringify(error)).not.toContain(TEST_KEY);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("sanitizes transport errors and does not retain their cause", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => {
      throw new Error(`remote ${TEST_KEY}`);
    });
    await expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "transport_error",
      message: "Jev request failed: transport_error.",
    });
  });

  it.each([
    [
      "changed model",
      (value: ReturnType<typeof wire>) => {
        value.model = "typesafe/jev-next";
      },
    ],
    [
      "changed provider",
      (value: ReturnType<typeof wire>) => {
        value.provider = "Other";
      },
    ],
  ])("blocks identity drift: %s", async (_name, mutate) => {
    const value = wire();
    mutate(value);
    await expect(requestJev(request, { fetch: responseFetch(value) })).rejects.toMatchObject({
      code: "identity_mismatch",
    });
  });

  it.each([
    [
      "unknown choice",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.choice = "unknown";
      },
    ],
    [
      "wrong answer type",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.type = "score";
      },
    ],
    [
      "missing probability",
      (value: ReturnType<typeof wire>) => {
        delete value.answers.risk.probabilities.block;
      },
    ],
    [
      "extra probability",
      (value: ReturnType<typeof wire>) => {
        Object.assign(value.answers.risk.probabilities, { other: 0 });
      },
    ],
    [
      "negative probability",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.probabilities.block = -0.01;
      },
    ],
    [
      "probability above one",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.probabilities.allow = 1.1;
      },
    ],
    [
      "nonnumeric probability",
      (value: ReturnType<typeof wire>) => {
        Object.assign(value.answers.risk.probabilities, { allow: "1" });
      },
    ],
    [
      "distribution not normalized",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.probabilities.allow = 0.97;
      },
    ],
    [
      "choice is not highest probability",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.choice = "confirm";
      },
    ],
    [
      "invalid confidence",
      (value: ReturnType<typeof wire>) => {
        value.answers.risk.confidence = 2;
      },
    ],
    [
      "missing request id",
      (value: ReturnType<typeof wire>) => {
        delete value.id;
      },
    ],
    [
      "unsafe request id",
      (value: ReturnType<typeof wire>) => {
        value.id = `echo-${TEST_KEY}`;
      },
    ],
    [
      "negative usage",
      (value: ReturnType<typeof wire>) => {
        value.usage.input_tokens = -1;
      },
    ],
    [
      "fractional usage",
      (value: ReturnType<typeof wire>) => {
        value.usage.output_tokens = 1.5;
      },
    ],
    [
      "nonfinite usage",
      (value: ReturnType<typeof wire>) => {
        value.usage.input_tokens = Infinity;
      },
    ],
    [
      "negative cost",
      (value: ReturnType<typeof wire>) => {
        value.usage.cost = -0.1;
      },
    ],
    [
      "extra answer",
      (value: ReturnType<typeof wire>) => {
        Object.assign(value.answers, { other: value.answers.risk });
      },
    ],
  ])("rejects invalid response: %s", async (_name, mutate) => {
    const value = wire();
    mutate(value);
    await expect(requestJev(request, { fetch: responseFetch(value) })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it.each([null, [], { model: JEV_RESOLVED_MODEL, provider: JEV_PROVIDER }])(
    "rejects malformed response structures",
    async (value) => {
      await expect(requestJev(request, { fetch: responseFetch(value) })).rejects.toBeInstanceOf(
        JevClientError,
      );
    },
  );

  it("rejects invalid JSON and duplicate keys, including escaped probability keys", async () => {
    for (const body of [
      TEST_KEY,
      JSON.stringify(wire()).replace('"allow":0.99', '"allow":0,"allow":0.99'),
      JSON.stringify(wire()).replace('"allow":0.99', '"allow":0,"\\u0061llow":0.99'),
      JSON.stringify(wire()).replace('"model":', '"model":"unexpected","model":'),
    ]) {
      const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(body));
      await expect(requestJev(request, { fetch })).rejects.toMatchObject({
        code: "invalid_response",
      });
    }
  });

  it("rejects malformed UTF-8 before parsing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(new Uint8Array([0xff])));
    await expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "invalid_response",
    });
  });

  it("rejects alternate models, extra questions, and oversized requests before fetching", async () => {
    const fetch = responseFetch();
    for (const value of [
      { ...request, model: "other/model" },
      { ...request, questions: { ...request.questions, other: request.questions.risk } },
      { ...request, state: "x".repeat(131_073) },
    ]) {
      await expect(requestJev(value, { fetch })).rejects.toMatchObject({ code: "invalid_request" });
    }
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Jev credential readiness", () => {
  it("checks locally and reports no credential values", () => {
    expect(jevCredentialStatus()).toBe("ready (environment)");
    expect(jevCredentialStatus()).not.toContain(TEST_KEY);
  });

  it("prefers the environment key to an unreadable configured file", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", join(directory, "missing"));
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("ready (environment)");
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
  });

  it("reads only the explicitly configured bounded regular file", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const path = join(directory, "credential");
    writeFileSync(path, `${TEST_KEY}\n`, { mode: 0o600 });
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", path);
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("ready (file)");
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
  });

  it("reports absent credentials and does not fetch", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("missing");
    await expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "missing_credentials",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("ignores an unrelated legacy key setting", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    vi.stubEnv("LEGACY_JEV_API_KEY", TEST_KEY);
    const path = join(directory, "legacy-key");
    writeFileSync(path, TEST_KEY, { mode: 0o600 });
    vi.stubEnv("LEGACY_JEV_API_KEY_FILE", path);
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("missing");
    await expect(requestJev(request, { fetch })).rejects.toMatchObject({
      code: "missing_credentials",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not fall back when a supplied environment key is invalid", async () => {
    const path = join(directory, "credential");
    writeFileSync(path, TEST_KEY);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "invalid\ncredential");
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", path);
    expect(jevCredentialStatus()).toBe("invalid");
    await expect(requestJev(request, { fetch: responseFetch() })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("sanitizes missing, directory, empty, oversized, and non-ASCII key file errors", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "");
    const folder = join(directory, "folder");
    mkdirSync(folder);
    const empty = join(directory, "empty");
    writeFileSync(empty, "\n");
    const large = join(directory, "large");
    writeFileSync(large, "x".repeat(4_097));
    const binary = join(directory, "binary");
    writeFileSync(binary, new Uint8Array([0xff]));
    for (const path of [join(directory, "missing"), folder, empty, large, binary]) {
      vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", path);
      expect(jevCredentialStatus()).toBe("invalid");
      const fetch = responseFetch();
      await expect(requestJev(request, { fetch })).rejects.toMatchObject({
        code: "invalid_credentials",
        message: "Jev request failed: invalid_credentials.",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });
});
