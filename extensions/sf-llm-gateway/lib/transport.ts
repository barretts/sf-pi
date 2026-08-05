/* SPDX-License-Identifier: Apache-2.0 */
/** Public barrel for the gateway's generic protocol adapters. */

export {
  annotateErrorWithGuidance,
  formatAnthropicStreamError,
  sanitizeAnthropicStream,
} from "./transport-internal/shared.ts";

export {
  streamSfGatewayAnthropic,
  streamSfGatewayAnthropicFull,
  type GatewayAnthropicFullTestHooks,
} from "./transport-internal/anthropic.ts";
export {
  streamSfGatewayOpenAI,
  streamSfGatewayOpenAIFull,
  type GatewayOpenAIFullTestHooks,
} from "./transport-internal/openai-chat.ts";
export {
  streamSfGatewayResponses,
  streamSfGatewayResponsesFull,
  type GatewayResponsesSimpleTestHooks,
  type GatewayResponsesFullTestHooks,
} from "./transport-internal/openai-responses.ts";
