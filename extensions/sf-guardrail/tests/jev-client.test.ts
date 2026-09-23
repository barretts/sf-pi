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
  requestJev,
} from "../lib/jev-client.ts";
import type { JevRequest } from "../lib/types.ts";

const TEST_KEY = "sk-test-only-credential";
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

let directory: string;
beforeEach(() => {
  vi.stubEnv("OPENROUTER_API_KEY", TEST_KEY);
  vi.stubEnv("OPENROUTER_API_KEY_FILE", "");
  directory = mkdtempSync(join(tmpdir(), "sf-guardrail-jev-client-"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("requestJev", () => {
  it("uses the fixed Decisions endpoint and returns validated hosted output tokens", async () => {
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
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(options.method).toBe("POST");
    expect(options.redirect).toBe("error");
    expect(options.headers).toEqual({
      Authorization: `Bearer ${TEST_KEY}`,
      "Content-Type": "application/json",
    });
    expect(JSON.parse(options.body as string)).toEqual(request);
    expect(options.signal).toBeInstanceOf(AbortSignal);
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
    vi.stubEnv("OPENROUTER_API_KEY", "");
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
        value.answers.risk.probabilities.allow = 0.98;
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
    vi.stubEnv("OPENROUTER_API_KEY_FILE", join(directory, "missing"));
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("ready (environment)");
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
  });

  it("reads only the explicitly configured bounded regular file", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const path = join(directory, "credential");
    writeFileSync(path, `${TEST_KEY}\n`, { mode: 0o600 });
    vi.stubEnv("OPENROUTER_API_KEY_FILE", path);
    const fetch = responseFetch();
    expect(jevCredentialStatus()).toBe("ready (file)");
    await requestJev(request, { fetch });
    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: `Bearer ${TEST_KEY}` });
  });

  it("reports absent credentials and does not fetch", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
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
    vi.stubEnv("OPENROUTER_API_KEY", "invalid\ncredential");
    vi.stubEnv("OPENROUTER_API_KEY_FILE", path);
    expect(jevCredentialStatus()).toBe("invalid");
    await expect(requestJev(request, { fetch: responseFetch() })).rejects.toMatchObject({
      code: "invalid_credentials",
    });
  });

  it("sanitizes missing, directory, empty, oversized, and non-ASCII key file errors", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const folder = join(directory, "folder");
    mkdirSync(folder);
    const empty = join(directory, "empty");
    writeFileSync(empty, "\n");
    const large = join(directory, "large");
    writeFileSync(large, "x".repeat(4_097));
    const binary = join(directory, "binary");
    writeFileSync(binary, new Uint8Array([0xff]));
    for (const path of [join(directory, "missing"), folder, empty, large, binary]) {
      vi.stubEnv("OPENROUTER_API_KEY_FILE", path);
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
