/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for discovery-driven, conservative gateway model definitions. */
import { getBuiltinModels, getBuiltinProviders } from "@earendil-works/pi-ai/providers/all";
import { describe, expect, it } from "vitest";
import {
  buildDiscoveredModelList,
  findMatchingModelId,
  getActiveModelDefinition,
  getModelFamily,
  inferModelDefinition,
  resolvePreferredModelId,
  toProviderModelConfig,
  type PiModelReference,
} from "../lib/models.ts";

describe("gateway model family inference", () => {
  it.each([
    ["example-claude-model", "anthropic"],
    ["example-gemini-model", "google"],
    ["example-gpt-model", "unknown"],
    ["openai/example-model", "openai"],
    ["example-codex-model", "codex"],
    ["example-deepseek-model", "deepseek"],
    ["example-chat-model", "unknown"],
  ] as const)("classifies %s as %s", (id, family) => {
    expect(getModelFamily(id)).toBe(family);
  });
});

describe("conservative model inference", () => {
  it("inherits portable metadata from Pi's public catalog by exact discovered ID", () => {
    const reference = getBuiltinProviders()
      .flatMap((provider) => getBuiltinModels(provider))
      .find(
        (model) =>
          model.api === "openai-responses" &&
          model.reasoning &&
          model.contextWindow >= 1_000_000 &&
          model.name !== model.id,
      );
    expect(reference).toBeDefined();
    if (!reference) return;

    const config = toProviderModelConfig(reference.id);

    expect(config.api).toBe("openai-responses");
    expect(config.reasoning).toBe(true);
    expect(config.name).toMatch(/^\[SF LLM Gateway\] /u);
    expect(config.name).not.toBe(`[SF LLM Gateway] ${reference.id}`);
    expect(config.contextWindow).toBe(1_000_000);
    expect(config.thinkingLevelMap).toBeDefined();
  });

  it("inherits portable metadata from an injected Pi reference without copying compat", () => {
    const reference: PiModelReference = {
      id: "example-public-model",
      name: "Example Public Model",
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_050_000,
      maxTokens: 128_000,
      thinkingLevelMap: {
        minimal: null,
        low: "low",
        medium: "medium",
        high: "high",
        xhigh: "xhigh",
        max: "max",
      },
    };

    const config = toProviderModelConfig(reference.id, undefined, [reference]);

    expect(config).toMatchObject({
      name: "[SF LLM Gateway] Example Public Model",
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 1_000_000,
      maxTokens: 128_000,
      thinkingLevelMap: reference.thinkingLevelMap,
    });
    expect("supportsStrictMode" in (config.compat ?? {})).toBe(false);
  });

  it("does not infer advanced capability from an unknown model ID", () => {
    const inferred = inferModelDefinition("example-reasoning-model");
    expect(inferred).toMatchObject({
      reasoning: false,
      input: ["text"],
      contextWindow: 128_000,
      maxTokens: 4_096,
    });
    expect("thinkingLevelMap" in inferred).toBe(false);
  });

  it("uses neutral authenticated metadata when present", () => {
    const config = toProviderModelConfig("example-responses-model", {
      id: "example-responses-model",
      mode: "responses",
      maxInputTokens: 256_000,
      maxOutputTokens: 16_000,
      supportsReasoning: true,
      supportsVision: true,
    });

    expect(config).toMatchObject({
      api: "openai-responses",
      reasoning: true,
      input: ["text", "image"],
      contextWindow: 256_000,
      maxTokens: 16_000,
    });
    expect(config.thinkingLevelMap).toBeUndefined();
    expect("supportsStrictMode" in (config.compat ?? {})).toBe(false);
  });

  it("uses broad public family inference only to select Messages", () => {
    const config = toProviderModelConfig("example-claude-model");
    expect(config.api).toBe("anthropic-messages");
    expect(config.reasoning).toBe(false);
    expect(config.compat).toBeUndefined();
  });

  it("defaults unknown discovered models to Chat Completions", () => {
    const config = toProviderModelConfig("example-chat-model");
    expect(config.api).toBe("openai-completions");
    expect(config.thinkingLevelMap).toBeUndefined();
    expect("supportsStrictMode" in (config.compat ?? {})).toBe(false);
  });
});

describe("discovered catalog", () => {
  it("contains only unique authenticated IDs in stable order", () => {
    const models = buildDiscoveredModelList([
      "example-model-b",
      "example-model-a",
      "example-model-b",
    ]);
    expect(models.map((model) => model.id)).toEqual(["example-model-a", "example-model-b"]);
  });

  it("applies metadata by discovered ID", () => {
    const models = buildDiscoveredModelList(["example-model"], {
      "example-model": {
        id: "example-model",
        mode: "responses",
        supportsReasoning: true,
      },
    });
    expect(models[0]).toMatchObject({
      id: "example-model",
      api: "openai-responses",
      reasoning: true,
    });
  });
});

describe("dynamic model selection", () => {
  it("preserves an exact available preference", () => {
    expect(findMatchingModelId("example-model-b", ["example-model-a", "example-model-b"])).toBe(
      "example-model-b",
    );
  });

  it("does not normalize or guess unavailable aliases", () => {
    expect(findMatchingModelId("example-model-v1", ["example-model"])).toBeUndefined();
  });

  it("uses the stable first discovered model when preferences are unavailable", () => {
    expect(resolvePreferredModelId(["example-model-b", "example-model-a"], ["missing-model"])).toBe(
      "example-model-a",
    );
  });

  it("returns active definitions only for discovered IDs", () => {
    expect(getActiveModelDefinition("example-model", ["example-model"])?.id).toBe("example-model");
    expect(getActiveModelDefinition("missing-model", ["example-model"])).toBeUndefined();
  });
});
