/* SPDX-License-Identifier: Apache-2.0 */
/** Shared error normalization for the generic gateway adapters. */
import {
  createAssistantMessageEventStream,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
} from "@earendil-works/pi-ai";
import { RETRY_GUIDANCE_SETTINGS_PATH } from "../config.ts";

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
  if (!trimmed.startsWith("{")) return undefined;

  try {
    const parsed = JSON.parse(trimmed) as AnthropicErrorEnvelope;
    return parsed.type === "error" && parsed.error ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function formatAnthropicStreamError(message: string): string {
  const envelope = parseAnthropicErrorEnvelope(message);
  if (!envelope?.error) return message;

  const type = envelope.error.type ?? "api_error";
  const text = envelope.error.message ?? "Unknown Messages stream error";
  const requestId = envelope.request_id ? ` (request_id: ${envelope.request_id})` : "";
  return `Messages ${type}: ${text}${requestId}`;
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
  return `Tip: Agent retries use Pi's retry.enabled and retry.maxRetries settings in ${RETRY_GUIDANCE_SETTINGS_PATH}; set maxRetries higher to retry more, disable retry to stop, or run /compact to shrink context.`;
}

export function annotateErrorWithGuidance(
  event: Extract<AssistantMessageEvent, { type: "error" }>,
): Extract<AssistantMessageEvent, { type: "error" }> {
  const footer = formatRetryGuidanceFooter();
  const message = event.error.errorMessage ?? "";
  if (!message || message.includes(footer)) return event;
  return {
    ...event,
    error: {
      ...event.error,
      errorMessage: `${message}\n${footer}`,
    },
  };
}

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
