/* SPDX-License-Identifier: Apache-2.0 */
/** Generic OpenAI Responses adapter for the configured gateway. */
import {
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type OpenAIResponsesOptions,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { streamOpenAIResponses, streamSimpleOpenAIResponses } from "@earendil-works/pi-ai/compat";

export interface GatewayResponsesSimpleTestHooks {
  responsesStreamer?: (
    model: Model<"openai-responses">,
    context: Context,
    options?: SimpleStreamOptions,
  ) => AssistantMessageEventStream;
}

export interface GatewayResponsesFullTestHooks {
  responsesStreamer?: typeof streamOpenAIResponses;
}

export function streamSfGatewayResponsesFull(
  model: Model<"openai-responses">,
  context: Context,
  options?: OpenAIResponsesOptions,
  hooks?: GatewayResponsesFullTestHooks,
): AssistantMessageEventStream {
  return (hooks?.responsesStreamer ?? streamOpenAIResponses)(model, context, options);
}

export function streamSfGatewayResponses(
  model: Model<"openai-responses">,
  context: Context,
  options?: SimpleStreamOptions,
  hooks?: GatewayResponsesSimpleTestHooks,
): AssistantMessageEventStream {
  return (hooks?.responsesStreamer ?? streamSimpleOpenAIResponses)(model, context, options);
}
