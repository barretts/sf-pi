/* SPDX-License-Identifier: Apache-2.0 */
/** Tests for gateway discovery HTTP fetchers. */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchGatewayModelIdDiscovery,
  fetchGatewayModelIds,
  fetchGatewayModelInfoMap,
} from "../lib/models.ts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("gateway discovery fetchers", () => {
  it("filters non-callable sentinel IDs", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { id: "no-default-models" },
              { id: "example-chat-model" },
              { id: "example-responses-model" },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    await expect(
      fetchGatewayModelIdDiscovery("https://gateway.example.test", "test-key"),
    ).resolves.toEqual({
      ids: ["example-chat-model", "example-responses-model"],
      filteredIds: ["no-default-models"],
    });
    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).resolves.toEqual(
      ["example-chat-model", "example-responses-model"],
    );
  });

  it("returns zero models when discovery only returns sentinels", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: [{ id: "no-default-models" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    await expect(fetchGatewayModelIds("https://gateway.example.test", "test-key")).resolves.toEqual(
      [],
    );
  });

  it("propagates outer cancellation through required and optional fetches", async () => {
    const receivedSignals: AbortSignal[] = [];
    globalThis.fetch = vi.fn(
      async (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal;
          if (!signal) return reject(new Error("missing signal"));
          receivedSignals.push(signal);
          signal.addEventListener("abort", () => reject(new Error("outer abort")), { once: true });
        }),
    ) as typeof fetch;
    const controller = new AbortController();

    const required = fetchGatewayModelIdDiscovery(
      "https://gateway.example.test",
      "test-key",
      controller.signal,
    );
    const optionalInfo = fetchGatewayModelInfoMap(
      "https://gateway.example.test",
      "test-key",
      controller.signal,
    );
    controller.abort();

    await expect(required).rejects.toThrow("outer abort");
    await expect(optionalInfo).rejects.toThrow("outer abort");
    expect(receivedSignals).toHaveLength(2);
    expect(receivedSignals.every((signal) => signal.aborted)).toBe(true);
  });

  it("returns only neutral client-facing model metadata", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            data: [
              { model_name: "no-default-models", model_info: { max_input_tokens: 999 } },
              {
                model_name: "example-responses-model",
                model_info: {
                  mode: "responses",
                  max_input_tokens: 256_000,
                  max_output_tokens: 16_000,
                  supports_reasoning: true,
                  supports_vision: false,
                  litellm_provider: "unpublished-provider",
                },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    ) as typeof fetch;

    const info = await fetchGatewayModelInfoMap("https://gateway.example.test", "test-key");
    expect(info).toEqual({
      "example-responses-model": {
        id: "example-responses-model",
        mode: "responses",
        maxInputTokens: 256_000,
        maxOutputTokens: 16_000,
        supportsReasoning: true,
        supportsVision: false,
      },
    });
    expect(JSON.stringify(info)).not.toContain("unpublished-provider");
  });
});
