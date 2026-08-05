/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for the complete native SF LLM Gateway Provider. */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  InMemoryCredentialStore,
  InMemoryModelsStore,
  createAssistantMessageEventStream,
  createModels,
  type Api,
  type ApiKeyAuth,
  type AssistantMessage,
  type Context,
  type Model,
  type StreamOptions,
} from "@earendil-works/pi-ai";
import { ModelRuntime, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import { PROVIDER_NAME } from "../lib/config.ts";
import type { GatewayModelInfoMap } from "../lib/models.ts";
import type { GatewayModelIdDiscovery } from "../lib/models-internal/fetchers.ts";
import {
  GATEWAY_RESOLVED_ROOT_ENV,
  type GatewayProviderAuthController,
} from "../lib/provider-auth.ts";
import {
  createGatewayProviderRuntime,
  type GatewayApi,
  type GatewayFetchers,
  type GatewayStreamImplementations,
} from "../lib/provider.ts";

const EMPTY_CONTEXT: Context = { systemPrompt: "", messages: [], tools: [] };
const UNUSED_UI = {} as ExtensionUIContext;

function completedStream(model: Model<Api>, text = "ok") {
  const stream = createAssistantMessageEventStream();
  const message: AssistantMessage = {
    role: "assistant",
    content: [{ type: "text", text }],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 1,
      output: 1,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "stop",
    timestamp: Date.now(),
  };
  queueMicrotask(() => {
    stream.push({ type: "start", partial: message });
    stream.push({ type: "done", reason: "stop", message });
    stream.end();
  });
  return stream;
}

function authController(root = "https://active.example.test/v1"): GatewayProviderAuthController {
  const auth: ApiKeyAuth = {
    name: "test",
    async resolve({ credential }) {
      return credential?.key
        ? {
            auth: { apiKey: credential.key },
            env: { [GATEWAY_RESOLVED_ROOT_ENV]: root },
            source: "test credential",
          }
        : undefined;
    },
  };
  return {
    auth,
    bind: vi.fn(),
    clear: vi.fn(),
    getActiveCwd: vi.fn(() => undefined),
    hasConfiguredCredential: vi.fn(async () => false),
    resolveRuntimeAuth: vi.fn(async () => undefined),
  };
}

function fetchers(
  ids: GatewayModelIdDiscovery = {
    ids: ["example-chat-model", "example-claude-model", "example-responses-model"],
    filteredIds: [],
  },
  modelInfo: GatewayModelInfoMap = {
    "example-responses-model": { id: "example-responses-model", mode: "responses" },
  },
): GatewayFetchers {
  return {
    modelIds: vi.fn(async () => ids),
    modelInfo: vi.fn(async () => modelInfo),
  };
}

interface StreamCall {
  kind: "stream" | "simple";
  api: string;
  modelId: string;
  baseUrl: string;
  apiKey?: string;
  resolvedRoot?: string;
}

function streams(calls: StreamCall[]): GatewayStreamImplementations {
  return {
    anthropicFull(model, _context, options) {
      calls.push(call("stream", "anthropic-messages", model, options));
      return completedStream(model);
    },
    chatFull(model, _context, options) {
      calls.push(call("stream", "openai-completions", model, options));
      return completedStream(model);
    },
    responsesFull(model, _context, options) {
      calls.push(call("stream", "openai-responses", model, options));
      return completedStream(model);
    },
    anthropicSimple(model, _context, options) {
      calls.push(call("simple", "anthropic-messages", model, options));
      return completedStream(model);
    },
    chatSimple(model, _context, options) {
      calls.push(call("simple", "openai-completions", model, options));
      return completedStream(model);
    },
    responsesSimple(model, _context, options) {
      calls.push(call("simple", "openai-responses", model, options));
      return completedStream(model);
    },
  };
}

function call(
  kind: "stream" | "simple",
  api: string,
  model: Model<Api>,
  options?: StreamOptions,
): StreamCall {
  return {
    kind,
    api,
    modelId: model.id,
    baseUrl: model.baseUrl,
    apiKey: options?.apiKey,
    resolvedRoot: options?.env?.[GATEWAY_RESOLVED_ROOT_ENV],
  };
}

async function configuredModels(runtime: ReturnType<typeof createGatewayProviderRuntime>) {
  const credentials = new InMemoryCredentialStore();
  await credentials.modify(PROVIDER_NAME, async () => ({ type: "api_key", key: "native-key" }));
  const modelsStore = new InMemoryModelsStore();
  const models = createModels({ credentials, modelsStore });
  models.setProvider(runtime.provider);
  return { credentials, modelsStore, models };
}

function cachedModel(id = "cached-only"): Model<"openai-completions"> {
  return {
    id,
    name: id,
    provider: PROVIDER_NAME,
    api: "openai-completions",
    baseUrl: "https://cached.example.test/v1",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 1000,
    maxTokens: 100,
  };
}

describe("complete native Gateway Provider", () => {
  it("starts with an empty catalog and performs no construction network", () => {
    const network = fetchers();
    const controller = authController();
    const runtime = createGatewayProviderRuntime({
      authController: controller,
      fetchers: network,
      now: () => new Date("2026-07-23T00:00:00.000Z"),
    });

    expect(runtime.provider.id).toBe(PROVIDER_NAME);
    expect(runtime.provider.name).toBe("SF LLM Gateway");
    expect(runtime.provider.getModels()).toEqual([]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "empty",
      modelIds: [],
    });
    expect(network.modelIds).not.toHaveBeenCalled();
    expect(network.modelInfo).not.toHaveBeenCalled();

    runtime.bind("/workspace", UNUSED_UI, "tui");
    runtime.clear();
    expect(controller.bind).toHaveBeenCalledWith("/workspace", UNUSED_UI, "tui", undefined);
    expect(controller.clear).toHaveBeenCalledTimes(1);
    expect(network.modelIds).not.toHaveBeenCalled();
  });

  it("keeps models.json overrides above the cached dynamic Provider catalog", async () => {
    const gateway = createGatewayProviderRuntime({ authController: authController() });
    const cached = cachedModel("example-discovered-model");
    const modelsStore = new InMemoryModelsStore();
    await modelsStore.write(PROVIDER_NAME, { models: [cached], checkedAt: 1 });
    const credentials = new InMemoryCredentialStore();
    await credentials.modify(PROVIDER_NAME, async () => ({ type: "api_key", key: "native-key" }));
    const nativeModels = createModels({ credentials, modelsStore });
    nativeModels.setProvider(gateway.provider);
    await nativeModels.refresh({ allowNetwork: false });
    const dir = mkdtempSync(path.join(tmpdir(), "sf-pi-m3a-model-overrides-"));
    const modelsPath = path.join(dir, "models.json");
    writeFileSync(
      modelsPath,
      JSON.stringify({
        providers: {
          [PROVIDER_NAME]: {
            modelOverrides: {
              [cached.id]: { name: "User Override", maxTokens: 777 },
            },
          },
        },
      }),
    );
    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsStore,
      modelsPath,
      allowModelNetwork: false,
    });

    runtime.registerNativeProvider(gateway.provider);

    expect(runtime.getModel(PROVIDER_NAME, cached.id)).toMatchObject({
      name: "User Override",
      maxTokens: 777,
    });
  });

  it("dispatches real API tags with family-correct endpoints and native auth for simple and full streams", async () => {
    const calls: StreamCall[] = [];
    const runtime = createGatewayProviderRuntime({
      authController: authController("https://active.example.test/v1"),
      fetchers: fetchers(),
      streams: streams(calls),
    });
    const { models } = await configuredModels(runtime);
    await models.refresh({ allowNetwork: true });
    const byApi = new Map(runtime.provider.getModels().map((model) => [model.api, model]));

    for (const api of ["anthropic-messages", "openai-completions", "openai-responses"] as const) {
      const model = byApi.get(api);
      expect(model).toBeDefined();
      if (!model) continue;
      await models.completeSimple(model, EMPTY_CONTEXT);
      await models.complete(model, EMPTY_CONTEXT);
    }

    expect(calls).toHaveLength(6);
    for (const entry of calls) {
      expect(entry.apiKey).toBe("native-key");
      expect(entry.resolvedRoot).toBe("https://active.example.test/v1");
      expect(entry.baseUrl).toBe(
        entry.api === "openai-completions"
          ? "https://active.example.test/v1"
          : "https://active.example.test",
      );
    }
  });

  it("restores Pi's cached catalog, replaces it on discovery, and retains it on failure", async () => {
    const network = fetchers({
      ids: ["example-responses-model", "fresh-chat", "no-default-models"],
      filteredIds: ["no-default-models"],
    });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
      now: () => new Date("2026-07-23T01:02:03.000Z"),
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, {
      models: [
        cachedModel(),
        { ...cachedModel("example-responses-model"), name: "Cached GPT override" },
      ],
      checkedAt: 1,
    });

    await models.refresh({ allowNetwork: false });
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeDefined();
    expect(models.getModel(PROVIDER_NAME, "example-responses-model")?.name).toBe(
      "Cached GPT override",
    );
    expect(
      models.getModels(PROVIDER_NAME).filter((model) => model.id === "example-responses-model"),
    ).toHaveLength(1);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "cache",
      modelIds: runtime.provider.getModels().map((model) => model.id),
    });
    expect(network.modelIds).not.toHaveBeenCalled();

    const refreshed = await models.refresh({ allowNetwork: true });
    expect(refreshed.errors.size).toBe(0);
    expect(network.modelIds).toHaveBeenCalledWith(
      "https://active.example.test",
      "native-key",
      undefined,
    );
    expect(network.modelInfo).toHaveBeenCalledWith(
      "https://active.example.test",
      "native-key",
      undefined,
    );
    expect(models.getModel(PROVIDER_NAME, "cached-only")).toBeUndefined();
    expect(models.getModel(PROVIDER_NAME, "example-responses-model")?.name).not.toBe(
      "Cached GPT override",
    );
    expect(
      models.getModels(PROVIDER_NAME).filter((model) => model.id === "example-responses-model"),
    ).toHaveLength(1);
    expect(models.getModels(PROVIDER_NAME)).toHaveLength(2);
    expect(models.getModel(PROVIDER_NAME, "fresh-chat")).toMatchObject({
      provider: PROVIDER_NAME,
      api: "openai-completions",
      baseUrl: "https://gateway.invalid/v1",
    });
    expect(runtime.getLastDiscovery()).toEqual({
      modelIds: runtime.provider.getModels().map((model) => model.id),
      source: "gateway",
      discoveredAt: "2026-07-23T01:02:03.000Z",
      filteredModelIds: ["no-default-models"],
    });
    const persisted = await modelsStore.read(PROVIDER_NAME);
    expect(persisted?.models.map((model) => model.id)).toEqual([
      "example-responses-model",
      "fresh-chat",
    ]);
    const serializedStore = JSON.stringify(persisted);
    expect(serializedStore).not.toContain("active.example.test");
    expect(serializedStore).not.toContain("native-key");
    expect(serializedStore).toContain("gateway.invalid");

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("gateway unavailable at https://active.example.test?token=native-key"),
    );
    const failed = await models.refresh({ allowNetwork: true });
    expect(failed.errors.get(PROVIDER_NAME)?.message).toBe("Gateway model refresh failed.");
    expect(models.getModel(PROVIDER_NAME, "fresh-chat")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models.map((model) => model.id)).toEqual([
      "example-responses-model",
      "fresh-chat",
    ]);
    expect(runtime.getLastDiscovery()).toEqual({
      source: "gateway",
      modelIds: runtime.provider.getModels().map((model) => model.id),
      discoveredAt: "2026-07-23T01:02:03.000Z",
      filteredModelIds: ["no-default-models"],
      error: "Gateway model refresh failed.",
    });
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/active\.example|native-key/u);
  });

  it("retains last-known models when an in-flight refresh is aborted", async () => {
    let signalFetchStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => {
      signalFetchStarted = resolve;
    });
    const network = fetchers({ ids: ["unused"], filteredIds: [] });
    vi.mocked(network.modelIds).mockImplementation(
      async (_root, _key, signal) =>
        new Promise<GatewayModelIdDiscovery>((_resolve, reject) => {
          signalFetchStarted?.();
          signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted https://active.example.test token=native-key")),
            { once: true },
          );
        }),
    );
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models, modelsStore } = await configuredModels(runtime);
    await modelsStore.write(PROVIDER_NAME, { models: [cachedModel("last-known")], checkedAt: 1 });
    await models.refresh({ allowNetwork: false });
    const discoveryBeforeAbort = runtime.getLastDiscovery();

    const controller = new AbortController();
    const refresh = models.refresh({ allowNetwork: true, signal: controller.signal });
    await started;
    controller.abort();
    const result = await refresh;

    expect(result.aborted).toBe(true);
    expect(result.errors.size).toBe(0);
    expect(models.getModel(PROVIDER_NAME, "last-known")).toBeDefined();
    expect((await modelsStore.read(PROVIDER_NAME))?.models[0]?.id).toBe("last-known");
    expect(runtime.getLastDiscovery()).toEqual(discoveryBeforeAbort);
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/active\.example|native-key/u);
  });

  it("keeps callable peers when discovery also reports non-callable sentinels", async () => {
    const network = fetchers({
      ids: ["callable-peer", "no-default-models"],
      filteredIds: ["no-default-models"],
    });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    const result = await models.refresh({ allowNetwork: true });

    expect(result.errors.size).toBe(0);
    expect(models.getModel(PROVIDER_NAME, "callable-peer")).toBeDefined();
    expect(models.getModel(PROVIDER_NAME, "no-default-models")).toBeUndefined();
    expect(runtime.getLastDiscovery().filteredModelIds).toEqual(["no-default-models"]);
  });

  it("rejects missing refresh inputs and leaves a fresh catalog empty when discovery has no callable models", async () => {
    const zero = fetchers({ ids: [], filteredIds: ["no-default-models"] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: zero,
    });
    const store = new InMemoryModelsStore();
    const scopedStore = {
      read: () => store.read(PROVIDER_NAME),
      write: (entry: Parameters<typeof store.write>[1]) => store.write(PROVIDER_NAME, entry),
      delete: () => store.delete(PROVIDER_NAME),
    };

    await expect(
      runtime.provider.refreshModels?.({
        credential: { type: "api_key", key: "key" },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("resolved gateway root URL");
    await expect(
      runtime.provider.refreshModels?.({
        credential: {
          type: "api_key",
          env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
        },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("resolved API key");
    await expect(
      runtime.provider.refreshModels?.({
        credential: {
          type: "api_key",
          key: "key",
          env: { [GATEWAY_RESOLVED_ROOT_ENV]: "https://gateway.example.test" },
        },
        store: scopedStore,
        allowNetwork: true,
      }),
    ).rejects.toThrow("zero callable models");
    expect(runtime.provider.getModels()).toEqual([]);
  });

  it("resets discovery diagnostics on a new binding and on clear", async () => {
    const network = fetchers({ ids: ["fresh-chat"], filteredIds: [] });
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: network,
    });
    const { models } = await configuredModels(runtime);

    await models.refresh({ allowNetwork: true });

    vi.mocked(network.modelIds).mockRejectedValueOnce(
      new Error("private https://project-a.example.test token=project-a-secret"),
    );
    await models.refresh({ allowNetwork: true });
    expect(runtime.getLastDiscovery().error).toBe("Gateway model refresh failed.");

    runtime.bind("/workspace/project-b", UNUSED_UI, "tui");
    expect(runtime.getLastDiscovery()).not.toHaveProperty("error");
    expect(JSON.stringify(runtime.getLastDiscovery())).not.toMatch(/project-a|secret/u);

    runtime.clear();
    expect(runtime.getLastDiscovery()).not.toHaveProperty("error");
  });

  it("returns a stream error for an unmapped API instead of guessing from the model id", async () => {
    const runtime = createGatewayProviderRuntime({
      authController: authController(),
      fetchers: fetchers(),
      streams: streams([]),
    });
    const unknown = {
      ...cachedModel("unknown-api-model"),
      api: "unknown-gateway-api",
    } as unknown as Model<GatewayApi>;

    await expect(
      runtime.provider.streamSimple(unknown, EMPTY_CONTEXT).result(),
    ).resolves.toMatchObject({
      stopReason: "error",
      errorMessage: 'Provider sf-llm-gateway has no API implementation for "unknown-gateway-api"',
    });
  });
});
