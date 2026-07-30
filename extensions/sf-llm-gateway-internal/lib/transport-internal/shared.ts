/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Shared transport primitives for the SF LLM Gateway.
 *
 * Holds constants, types, model-id detection, error formatters, provider retry
 * defaults, and the early-stream retry wrapper used by the Anthropic transport.
 * Per-transport streamers live next to this file in
 * `./anthropic.ts`, `./openai-chat.ts`, and `./openai-responses.ts`.
 *
 * The historical `lib/transport.ts` is now a re-export barrel — every
 * symbol declared here is also re-exported from there for backwards
 * compatibility.
 */
import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import { RETRY_GUIDANCE_SETTINGS_PATH, RETRY_GUIDANCE_STATUS_URL } from "../config.ts";

// -------------------------------------------------------------------------------------------------
// Constants + types
// -------------------------------------------------------------------------------------------------

export const DEFAULT_CODEX_REASONING_EFFORT = "high";
export const DEFAULT_OPENAI_REASONING_EFFORT = "high";
// The gateway's LiteLLM tightened some OpenAI reasoning_effort validators to
// reject raw "xhigh" with HTTP 400. The strongest safe effort is
// route-specific: Codex live probes accept "max", while gpt-5/gpt-5.5
// Responses probes reject it. Keep the constant name for callers that already
// know their route accepts the strongest tier.
export const MAX_OPENAI_REASONING_EFFORT = "max";

/**
 * @deprecated Removed — the upstream instability at 128K+max that motivated
 * level-scaled floors has been resolved. Kept only as a type-compatible stub
 * for any downstream test imports that reference it before cleanup.
 */
export const OPUS_47_MAX_TOKENS_FLOOR_BY_LEVEL: Record<PiReasoningLevel, number> = {
  minimal: 128_000,
  low: 128_000,
  medium: 128_000,
  high: 128_000,
  xhigh: 128_000,
  max: 128_000,
};

/** Default OpenAI service tier for gateway requests. */
export const DEFAULT_OPENAI_SERVICE_TIER = "priority";

/**
 * Anthropic pi-ai reasoning level. Keep in sync with pi-ai's ThinkingLevel.
 * Duplicated here instead of importing because pi-ai only exports it as a
 * type, and we need the literal set at runtime for validation.
 */
export type PiReasoningLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * @deprecated Use the model preset's maxTokens (128_000) directly.
 * Kept for backwards-compatible imports.
 */
export const OPUS_47_DEFAULT_MAX_TOKENS = 128_000;

/**
 * Hard upstream ceiling for Opus 4.7. Gateway returns 400 above this.
 */
export const OPUS_47_MODEL_MAX_TOKENS = 128_000;

/**
 * @deprecated The level-scaled floor is no longer needed. Returns 128_000
 * unconditionally. Kept for backwards-compatible imports.
 */
export function resolveOpus47MaxTokensFloor(level?: PiReasoningLevel | undefined): number {
  void level;
  return OPUS_47_MODEL_MAX_TOKENS;
}

// -------------------------------------------------------------------------------------------------
// Model-id detection
// -------------------------------------------------------------------------------------------------

export function isCodexModelId(modelId: string): boolean {
  return modelId.toLowerCase().includes("codex");
}

/**
 * True for OpenAI-family model IDs the gateway routes through its OpenAI
 * proxy. Codex is a subset — `isCodexModelId` is the finer check.
 */
export function isOpenAiModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return (
    lower.startsWith("gpt-") ||
    lower.includes("/gpt-") ||
    lower.startsWith("openai/") ||
    lower.includes("chatgpt")
  );
}

/**
 * True for OpenAI-family models that accept `reasoning_effort` through
 * LiteLLM. Do not set it on GPT-4o / ChatGPT aliases.
 */
export function isOpenAiReasoningModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return isOpenAiModelId(modelId) && lower.includes("gpt-5");
}

/**
 * True for GPT-5 Bedrock model IDs that should stay on the Responses path
 * but need a more conservative thinking-level map than direct OpenAI GPT-5.
 */
export function isGpt5BedrockResponsesModelId(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  if (lower.includes("codex")) return false;
  const unprefixed = lower.startsWith("openai/") ? lower.slice("openai/".length) : lower;
  return /^gpt-5\.\d+(?:-[a-z0-9]+)*-bedrock$/.test(unprefixed);
}

/**
 * True for any non-Codex gpt-5 family model the extension routes through
 * `POST /responses` instead of `/v1/chat/completions`.
 */
export function isGpt5FamilyResponsesModelId(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  if (lower.includes("codex")) return false;

  const unprefixed = lower.startsWith("openai/") ? lower.slice("openai/".length) : lower;
  return (
    unprefixed === "gpt-5" ||
    unprefixed === "gpt-5-mini" ||
    /^gpt-5\.\d+(?:-[a-z0-9]+)*(?:-bedrock)?$/.test(unprefixed)
  );
}

export function isGpt56FamilyResponsesModelId(modelId: string): boolean {
  const lower = modelId.trim().toLowerCase();
  if (lower.includes("codex")) return false;
  const unprefixed = lower.startsWith("openai/") ? lower.slice("openai/".length) : lower;
  return /^gpt-5\.6(?:-[a-z0-9]+)*(?:-bedrock)?$/.test(unprefixed);
}

export function isGpt56BedrockResponsesModelId(modelId: string): boolean {
  return isGpt56FamilyResponsesModelId(modelId) && isGpt5BedrockResponsesModelId(modelId);
}

export function isGpt55ModelId(modelId: string): boolean {
  const lower = modelId.toLowerCase();
  return /(^|\/)gpt-5\.5(?!\d)/.test(lower);
}

/**
 * Return the strongest reasoning effort this gateway should request for an
 * OpenAI-family model. Returns undefined when the model should not carry
 * `reasoning_effort` at all (gpt-5.5 + non-reasoning OpenAI variants).
 */
export function resolveOpenAiReasoningEffort(modelId: string): string | undefined {
  if (!isOpenAiReasoningModelId(modelId)) {
    return undefined;
  }

  if (isGpt55ModelId(modelId)) {
    return undefined;
  }

  const lower = modelId.toLowerCase();
  if (lower.includes("codex")) {
    return DEFAULT_CODEX_REASONING_EFFORT;
  }

  if (/gpt-5\.(?:[2-9]|\d{2,})/.test(lower)) {
    return MAX_OPENAI_REASONING_EFFORT;
  }

  return DEFAULT_OPENAI_REASONING_EFFORT;
}

/** Parsed major/minor version from an Opus model ID. */
export interface OpusVersion {
  major: number;
  minor: number | null;
}

/**
 * Parse Opus version IDs across fixed-major (`opus-5`) and 4.x
 * dash/dot (`opus-4-7`, `opus-4.7`) conventions.
 *
 * Minor versions are deliberately limited to one or two digits so dated IDs
 * such as `claude-opus-4-20250514` are not mistaken for a post-4.7 model.
 */
export function extractOpusVersion(modelId: string): OpusVersion | null {
  const match = modelId.toLowerCase().match(/opus-(\d+)(?:[.-](\d{1,2})(?=$|[-.]))?/);
  const major = match?.[1];
  if (!major) return null;
  return {
    major: Number.parseInt(major, 10),
    minor: match[2] ? Number.parseInt(match[2], 10) : null,
  };
}

/**
 * Extract the Opus 4.x minor version, or null for other major versions and
 * non-Opus IDs. Kept for backwards-compatible callers.
 */
export function extractOpusMinorVersion(modelId: string): number | null {
  const version = extractOpusVersion(modelId);
  return version?.major === 4 ? version.minor : null;
}

function isOpus4MinorOrNewer(modelId: string, minimumMinor: number): boolean {
  const version = extractOpusVersion(modelId);
  if (!version) return false;
  if (version.major > 4) return true;
  return version.major === 4 && version.minor !== null && version.minor >= minimumMinor;
}

/** True for Claude Opus 4.6+ (supports adaptive thinking). */
export function isOpus46OrNewerModelId(modelId: string): boolean {
  return isOpus4MinorOrNewer(modelId, 6);
}

/** True for Claude Opus 4.7+ (1M context with native gateway support). */
export function isOpus47OrNewerModelId(modelId: string): boolean {
  return isOpus4MinorOrNewer(modelId, 7);
}

/** True for fixed-major Opus 5 and later model IDs. */
export function isOpus5OrNewerModelId(modelId: string): boolean {
  const version = extractOpusVersion(modelId);
  return version !== null && version.major >= 5;
}

/**
 * @deprecated Use `isOpus47OrNewerModelId` instead. Kept for backwards
 * compatibility with callers that already rely on its 4.7-or-newer meaning.
 */
export function isOpus47ModelId(modelId: string): boolean {
  return isOpus47OrNewerModelId(modelId);
}

/** True only for Opus 4.7 IDs; used by the legacy direct-Bedrock probe. */
export function isExactOpus47ModelId(modelId: string): boolean {
  const version = extractOpusVersion(modelId);
  return version?.major === 4 && version.minor === 7;
}

// -------------------------------------------------------------------------------------------------
// Anthropic error envelope formatting
// -------------------------------------------------------------------------------------------------

type AnthropicErrorEnvelope = {
  type?: string;
  error?: {
    type?: string;
    message?: string;
  };
  request_id?: string;
};

function parseAnthropicErrorEnvelope(message: string): AnthropicErrorEnvelope | undefined {
  const trimmed = message.trim();
  if (!trimmed.startsWith("{")) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(trimmed) as AnthropicErrorEnvelope;
    if (parsed.type !== "error" || !parsed.error) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Pi-ai currently turns Anthropic SSE `event: error` frames into the raw JSON
 * envelope string. Render a user-facing message that preserves the request id
 * without dumping the whole envelope. Exported for unit tests.
 */
export function formatAnthropicStreamError(message: string): string {
  const envelope = parseAnthropicErrorEnvelope(message);
  if (!envelope?.error) {
    if (/Invalid model name passed in model=v1/i.test(message)) {
      return [
        message,
        "This usually means the gateway base URL includes an OpenAI deployment path (for example /bedrock) while Claude is using the native Anthropic /v1/messages route. Re-run /sf-llm-gateway setup and use the gateway root URL, then /sf-llm-gateway refresh.",
      ].join("\n");
    }
    return message;
  }

  const type = envelope.error.type ?? "api_error";
  const text = envelope.error.message ?? "Unknown Anthropic stream error";
  const requestId = envelope.request_id ? ` (request_id: ${envelope.request_id})` : "";
  return `Anthropic ${type}: ${text}${requestId}`;
}

function sanitizeAnthropicErrorEvent(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
): Extract<AssistantMessageEvent, { type: "error" }> {
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: event.error.errorMessage
        ? formatAnthropicStreamError(event.error.errorMessage)
        : event.error.errorMessage,
    },
  };
}

function formatRetryGuidanceFooter(): string {
  return `Tip: Agent retries use Pi's retry.enabled and retry.maxRetries settings in ${RETRY_GUIDANCE_SETTINGS_PATH}; set maxRetries higher to retry more, disable retry to stop, or run /compact to shrink context. Upstream status: ${RETRY_GUIDANCE_STATUS_URL}`;
}

/**
 * Append one-line Pi retry guidance to a sanitized terminal error.
 */
export function annotateErrorWithGuidance(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
): Extract<AssistantMessageEvent, { type: "error" }> {
  const footer = formatRetryGuidanceFooter();
  const message = event.error.errorMessage ?? "";
  if (!message || message.includes(footer)) {
    return event;
  }
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: `${message}\n${footer}`,
    },
  };
}

/** Preserve Gateway-specific error guidance while Pi owns retry lifecycle. */
export function sanitizeAnthropicStream(
  model: Model<"anthropic-messages">,
  upstream: AssistantMessageEventStream,
  signal?: AbortSignal,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  (async () => {
    try {
      for await (const event of upstream) {
        stream.push(
          event.type === "error"
            ? annotateErrorWithGuidance(sanitizeAnthropicErrorEvent(event))
            : event,
        );
      }
    } catch (error) {
      const stopReason = signal?.aborted ? "aborted" : "error";
      stream.push({
        type: "error",
        reason: stopReason,
        error: {
          role: "assistant",
          content: [],
          api: model.api,
          provider: model.provider,
          model: model.id,
          usage: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
          },
          stopReason,
          timestamp: Date.now(),
          errorMessage: formatAnthropicStreamError(
            error instanceof Error ? error.message : String(error),
          ),
        },
      });
    } finally {
      stream.end();
    }
  })();
  return stream;
}
