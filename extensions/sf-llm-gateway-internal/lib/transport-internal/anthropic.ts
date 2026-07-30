/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Anthropic Messages transport for the SF LLM Gateway.
 *
 * All Claude models go through pi-ai's Anthropic transport. Pi owns retry
 * attempts, backoff, cancellation, and lifecycle visibility; this Adapter only
 * sanitizes Gateway error envelopes and appends bounded terminal guidance.
 *
 * Pi also owns the generic adaptive-thinking payload via the model's
 * `compat.forceAdaptiveThinking` flag. The gateway accepts `effort=max` and
 * `max_tokens=128000` for Opus 4.7+ without transport-level payload shaping.
 */
import {
  type AnthropicOptions,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamAnthropic, streamSimpleAnthropic } from "@earendil-works/pi-ai/compat";
import { sanitizeAnthropicStream } from "./shared.ts";

export interface GatewayAnthropicFullTestHooks {
  streamer?: typeof streamAnthropic;
}

/** Gateway-aware full Anthropic stream used by complete native Providers. */
export function streamSfGatewayAnthropicFull(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: AnthropicOptions,
  hooks?: GatewayAnthropicFullTestHooks,
): AssistantMessageEventStream {
  const streamer = hooks?.streamer ?? streamAnthropic;
  return sanitizeAnthropicStream(model, streamer(model, context, options), options?.signal);
}

export function streamSfGatewayAnthropic(
  model: Model<"anthropic-messages">,
  context: Context,
  options?: SimpleStreamOptions,
): AssistantMessageEventStream {
  return sanitizeAnthropicStream(
    model,
    streamSimpleAnthropic(model, context, options),
    options?.signal,
  );
}
