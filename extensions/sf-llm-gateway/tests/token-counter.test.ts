/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for gateway token counting and spend estimation helpers. */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { API_KEY_ENV, BASE_URL_ENV } from "../lib/config.ts";
import {
  countTokens,
  estimateSpend,
  formatCostUsd,
  formatTokenReport,
} from "../lib/token-counter.ts";

const originalFetch = globalThis.fetch;
const originalBaseUrl = process.env[BASE_URL_ENV];
const originalApiKey = process.env[API_KEY_ENV];

describe("countTokens", () => {
  beforeEach(() => {
    process.env[API_KEY_ENV] = "active-automation-test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv(BASE_URL_ENV, originalBaseUrl);
    restoreEnv(API_KEY_ENV, originalApiKey);
    vi.restoreAllMocks();
  });

  it("returns an error when base URL is missing", async () => {
    delete process.env[BASE_URL_ENV];
    delete process.env[API_KEY_ENV];
    const cwd = createProjectConfig({ baseUrl: "", apiKey: "" });
    const result = await countTokens(cwd, { model: "example-model", prompt: "hello" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/base URL/i);
  });

  it("returns an error when neither prompt nor messages is provided", async () => {
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });
    const result = await countTokens(cwd, { model: "example-model" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/prompt or messages/);
  });

  it("parses a successful token_counter response", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(200, {
        total_tokens: 6,
        request_model: "example-model",
        model_used: "example-model",
        tokenizer_type: "openai_tokenizer",
      }),
    ) as typeof fetch;
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });
    const result = await countTokens(cwd, { model: "example-model", prompt: "Hello world" });
    expect(result).toMatchObject({
      ok: true,
      model: "example-model",
      totalTokens: 6,
      tokenizerType: "openai_tokenizer",
    });
  });

  it("prefers messages when both prompt and messages are provided", async () => {
    const calls: Array<{ body: string }> = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return jsonResponse(200, { total_tokens: 3, tokenizer_type: "openai_tokenizer" });
    }) as typeof fetch;
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });
    await countTokens(cwd, {
      model: "example-model",
      prompt: "ignored when messages present",
      messages: [{ role: "user", content: "hi" }],
    });
    const body = JSON.parse(calls[0].body);
    expect(body.messages).toBeDefined();
    expect(body.prompt).toBeUndefined();
  });

  it("surfaces a structured error on 401", async () => {
    globalThis.fetch = vi.fn(async () =>
      jsonResponse(401, { error: "Authentication Error" }),
    ) as typeof fetch;
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "bad",
    });
    const result = await countTokens(cwd, { model: "example-model", prompt: "hi" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/token_counter returned 401/);
  });
});

describe("estimateSpend", () => {
  beforeEach(() => {
    process.env[API_KEY_ENV] = "active-automation-test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    restoreEnv(API_KEY_ENV, originalApiKey);
    vi.restoreAllMocks();
  });

  it("parses a successful spend/calculate response", async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse(200, { cost: 0.000015 })) as typeof fetch;
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });
    const result = await estimateSpend(cwd, { model: "example-model", prompt: "hi" });
    expect(result).toMatchObject({ ok: true, costUsd: 0.000015 });
  });

  it("wraps a bare prompt into a synthetic user message", async () => {
    const calls: Array<{ body: string }> = [];
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: String(init?.body ?? "") });
      return jsonResponse(200, { cost: 0 });
    }) as typeof fetch;
    const cwd = createProjectConfig({
      baseUrl: "https://gateway.example.test",
      apiKey: "test-key",
    });
    await estimateSpend(cwd, { model: "example-model", prompt: "wrap me" });
    const body = JSON.parse(calls[0].body);
    expect(body.messages).toEqual([{ role: "user", content: "wrap me" }]);
  });
});

describe("formatCostUsd", () => {
  it("renders zero and sub-cent values predictably", () => {
    expect(formatCostUsd(0)).toBe("$0.00");
    expect(formatCostUsd(-5)).toBe("$0.00");
    expect(formatCostUsd(0.000015)).toBe("$1.50e-5");
    // Sub-cent values use scientific notation so they stay distinguishable
    // from "$0.00".
    expect(formatCostUsd(0.005)).toBe("$5.00e-3");
    expect(formatCostUsd(0.05)).toBe("$0.0500");
    expect(formatCostUsd(1.25)).toBe("$1.25");
  });
});

describe("formatTokenReport", () => {
  it("renders a combined summary when both probes succeed", () => {
    const text = formatTokenReport(
      { ok: true, model: "example-model", totalTokens: 6, tokenizerType: "openai_tokenizer" },
      { ok: true, model: "example-model", costUsd: 0.000015 },
    );
    expect(text).toContain("Tokens: 6 using openai_tokenizer on example-model");
    expect(text).toContain("Estimated cost: $1.50e-5");
  });

  it("renders the error message when token counting fails", () => {
    const text = formatTokenReport(
      { ok: false, model: "example-model", error: "token_counter returned 401." },
      { ok: false, model: "example-model", error: "spend/calculate returned 401." },
    );
    expect(text).toContain("Tokens: token_counter returned 401.");
    expect(text).toContain("Estimated cost: spend/calculate returned 401.");
  });
});

function createProjectConfig(config: { baseUrl: string; apiKey: string }): string {
  const cwd = mkdtempSync(join(tmpdir(), "sf-pi-token-test-"));
  const configDir = join(cwd, ".pi");
  mkdirSync(configDir, { recursive: true });
  writeFileSync(
    join(configDir, "sf-llm-gateway.json"),
    `${JSON.stringify({ enabled: true, ...config })}\n`,
  );
  return cwd;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
