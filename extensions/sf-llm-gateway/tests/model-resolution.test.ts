/* SPDX-License-Identifier: Apache-2.0 */
import type { Api, Model } from "@earendil-works/pi-ai";
import { describe, expect, it, vi } from "vitest";
import { PROVIDER_NAME } from "../lib/config.ts";
import { resolveGatewayDefaultModelWithPi } from "../lib/model-resolution.ts";

function model(id: string): Model<Api> {
  return {
    id,
    provider: PROVIDER_NAME,
    api: "openai-completions",
    name: id,
    reasoning: true,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  } as Model<Api>;
}

function registry(models: Model<Api>[]) {
  return {
    getAll: vi.fn(() => models),
    find: vi.fn((provider: string, id: string) =>
      models.find((candidate) => candidate.provider === provider && candidate.id === id),
    ),
  };
}

describe("resolveGatewayDefaultModelWithPi", () => {
  it("resolves only model capability and leaves thinking selection to Pi", () => {
    const candidate = model("example-reasoning-model");
    const reg = registry([candidate]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: [candidate.id],
      preferredModelIds: [candidate.id],
    });

    expect(resolved).not.toHaveProperty("thinkingLevel");
  });

  it("preserves the first registered preferred gateway model", () => {
    const preferred = model("example-model-b");
    const reg = registry([preferred, model("example-model-a")]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["example-model-a", "example-model-b"],
      preferredModelIds: ["example-model-b", "example-model-a"],
    });

    expect(resolved).toMatchObject({
      source: "pi",
      provider: PROVIDER_NAME,
      modelId: "example-model-b",
      model: preferred,
    });
  });

  it("does not guess aliases and falls back to the stable discovered model", () => {
    const canonical = model("example-model");
    const reg = registry([canonical]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["example-model"],
      preferredModelIds: ["example-model-v1"],
    });

    expect(resolved?.source).toBe("discovered");
    expect(resolved?.modelId).toBe("example-model");
    expect(resolved?.model).toBe(canonical);
  });

  it("uses the stable first discovered model when no preferred model is registered", () => {
    const reg = registry([]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: ["example-model-b", "example-model-a"],
      preferredModelIds: ["missing-model"],
    });

    expect(resolved).toMatchObject({
      source: "discovered",
      provider: PROVIDER_NAME,
      modelId: "example-model-a",
      model: undefined,
    });
  });

  it("returns no selection when discovery has no gateway models", () => {
    const reg = registry([]);

    const resolved = resolveGatewayDefaultModelWithPi({
      modelRegistry: reg as never,
      providerName: PROVIDER_NAME,
      availableModelIds: [],
      preferredModelIds: ["missing-model"],
    });

    expect(resolved).toBeUndefined();
  });
});
