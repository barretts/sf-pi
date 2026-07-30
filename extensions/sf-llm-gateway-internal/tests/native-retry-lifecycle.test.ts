/* SPDX-License-Identifier: Apache-2.0 */
/** Exact-Pi characterization of the retry lifecycle that replaces Gateway-local retries. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSessionEvent,
} from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "sf-pi-native-retry-test";
const MODEL: Model<"openai-completions"> = {
  id: "retry-model",
  provider: PROVIDER_ID,
  api: "openai-completions",
  name: "Retry model",
  baseUrl: "https://retry.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8_192,
  maxTokens: 1_024,
};

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function message(
  stopReason: AssistantMessage["stopReason"],
  errorMessage?: string,
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: MODEL.api,
    provider: MODEL.provider,
    model: MODEL.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    ...(errorMessage ? { errorMessage } : {}),
    timestamp: Date.now(),
  };
}

function eventStream(events: AssistantMessageEvent[]): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  queueMicrotask(() => {
    for (const event of events) stream.push(event);
    stream.end();
  });
  return stream;
}

function transientErrorStream(includeVisibleText = false): AssistantMessageEventStream {
  const partial = message("stop");
  const events: AssistantMessageEvent[] = [{ type: "start", partial }];
  if (includeVisibleText) {
    events.push({ type: "text_delta", contentIndex: 0, delta: "partial", partial });
  }
  const error = message("error", "Anthropic api_error: Internal server error");
  events.push({ type: "error", reason: "error", error });
  return eventStream(events);
}

function successStream(): AssistantMessageEventStream {
  const partial = message("stop");
  const done = { ...partial, content: [{ type: "text" as const, text: "ok" }] };
  return eventStream([
    { type: "start", partial },
    { type: "text_delta", contentIndex: 0, delta: "ok", partial: done },
    { type: "done", reason: "stop", message: done },
  ]);
}

async function createRetrySession(options: {
  streams: AssistantMessageEventStream[];
  retry: { enabled: boolean; maxRetries: number; baseDelayMs: number };
}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "sf-pi-native-retry-"));
  tempDirs.push(cwd);
  let calls = 0;
  const nextStream = () => {
    const stream = options.streams[calls++];
    if (!stream) throw new Error(`Missing stream for attempt ${calls}.`);
    return stream;
  };

  const provider = createProvider({
    id: PROVIDER_ID,
    name: "SF Pi native retry test",
    auth: {
      apiKey: {
        name: "Test key",
        async resolve() {
          return { auth: { apiKey: "test-key" }, source: "test" };
        },
      },
    },
    models: [MODEL],
    api: {
      "openai-completions": {
        stream: nextStream,
        streamSimple: nextStream,
      },
    },
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(cwd, "auth.json"),
    modelsPath: null,
    allowModelNetwork: false,
  });
  modelRuntime.registerNativeProvider(provider);
  const settingsManager = SettingsManager.inMemory({ retry: options.retry });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: cwd,
    settingsManager,
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd,
    agentDir: cwd,
    model: MODEL,
    noTools: "all",
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: SessionManager.inMemory(),
  });
  return { session, calls: () => calls };
}

function retryEvents(events: AgentSessionEvent[]): AgentSessionEvent[] {
  return events.filter(
    (event) => event.type === "auto_retry_start" || event.type === "auto_retry_end",
  );
}

describe("Pi-owned Gateway retry lifecycle", () => {
  it("retries a transient provider error and emits native lifecycle events", async () => {
    const { session, calls } = await createRetrySession({
      streams: [transientErrorStream(), successStream()],
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    });
    const events: AgentSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    try {
      await session.prompt("hello");
    } finally {
      unsubscribe();
      session.dispose();
    }

    expect(calls()).toBe(2);
    expect(retryEvents(events)).toMatchObject([
      { type: "auto_retry_start", attempt: 1, maxAttempts: 1, delayMs: 0 },
      { type: "auto_retry_end", success: true, attempt: 1 },
    ]);
  });

  it("honors disabled retry without a second provider attempt", async () => {
    const { session, calls } = await createRetrySession({
      streams: [transientErrorStream()],
      retry: { enabled: false, maxRetries: 3, baseDelayMs: 0 },
    });
    const events: AgentSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    try {
      await session.prompt("hello");
    } finally {
      unsubscribe();
      session.dispose();
    }

    expect(calls()).toBe(1);
    expect(retryEvents(events)).toEqual([]);
  });

  it("retries after partial visible output using the same native lifecycle", async () => {
    const { session, calls } = await createRetrySession({
      streams: [transientErrorStream(true), successStream()],
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    });
    const events: AgentSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    try {
      await session.prompt("hello");
    } finally {
      unsubscribe();
      session.dispose();
    }

    expect(calls()).toBe(2);
    expect(retryEvents(events).map((event) => event.type)).toEqual([
      "auto_retry_start",
      "auto_retry_end",
    ]);
  });

  it("reports native exhaustion after the configured retry budget", async () => {
    const { session, calls } = await createRetrySession({
      streams: [transientErrorStream(), transientErrorStream()],
      retry: { enabled: true, maxRetries: 1, baseDelayMs: 0 },
    });
    const events: AgentSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => events.push(event));

    try {
      await session.prompt("hello");
    } finally {
      unsubscribe();
      session.dispose();
    }

    expect(calls()).toBe(2);
    expect(retryEvents(events)).toMatchObject([
      { type: "auto_retry_start", attempt: 1, maxAttempts: 1 },
      { type: "auto_retry_end", success: false, attempt: 1 },
    ]);
  });

  it("cancels native retry backoff through the public session abort", async () => {
    const { session, calls } = await createRetrySession({
      streams: [transientErrorStream()],
      retry: { enabled: true, maxRetries: 2, baseDelayMs: 10_000 },
    });
    const events: AgentSessionEvent[] = [];
    const unsubscribe = session.subscribe((event) => {
      events.push(event);
      if (event.type === "auto_retry_start") setTimeout(() => void session.abort(), 0);
    });

    try {
      await session.prompt("hello");
    } finally {
      unsubscribe();
      session.dispose();
    }

    expect(calls()).toBe(1);
    expect(retryEvents(events)).toMatchObject([
      { type: "auto_retry_start", attempt: 1, maxAttempts: 2 },
      { type: "auto_retry_end", success: false, attempt: 1, finalError: "Retry cancelled" },
    ]);
  });
});
