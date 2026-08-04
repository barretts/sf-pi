/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Canonical parser for the Evaluation API's `lastExecution.llmEvents` payload.
 *
 * The API nests events by planner reasoning batch and encodes each response as
 * a JSON string. This module keeps every event in API order while extracting
 * only response content and tool names for compact persisted evidence. Full
 * prompts and raw responses remain authoritative in the existing raw artifact.
 */

export type LlmResponseEventKind = "tool_only" | "content" | "empty" | "malformed";
export type LlmResponseFormat = "json" | "plain_text" | "malformed_json" | "missing";

export interface LlmResponseEventEvidence {
  index: number;
  batch_index: number;
  event_index: number;
  agent_name?: string;
  prompt_name?: string;
  content: string;
  content_chars: number;
  tool_calls: string[];
  kind: LlmResponseEventKind;
  response_format: LlmResponseFormat;
  latency_ms?: number;
  started_at?: number;
  ended_at?: number;
  matches_final_response: boolean;
}

export interface TurnResponseIntegrity {
  status: "pass" | "warning" | "unavailable";
  max_non_empty_contents: number;
  message?: string;
}

export interface TurnResponseSequence {
  events: LlmResponseEventEvidence[];
  llm_call_count: number;
  non_empty_content_count: number;
  tool_only_count: number;
  malformed_count: number;
  final_response?: string;
  final_response_event_index?: number;
  integrity: TurnResponseIntegrity;
}

interface RawLlmEvent {
  agent_name?: unknown;
  prompt_name?: unknown;
  prompt_response?: unknown;
  execution_latency?: unknown;
  executionLatency?: unknown;
  startExecutionTime?: unknown;
  endExecutionTime?: unknown;
}

interface ParsedPromptResponse {
  content: string;
  toolCalls: string[];
  kind: LlmResponseEventKind;
  format: LlmResponseFormat;
}

export function buildLlmResponseSequence(
  rawEvents: unknown,
  finalResponse?: string,
  options: { maxNonEmptyContents?: number } = {},
): TurnResponseSequence {
  const maxNonEmptyContents = options.maxNonEmptyContents ?? 1;
  const events: LlmResponseEventEvidence[] = [];
  const groups = Array.isArray(rawEvents) ? rawEvents : [];
  const normalizedFinal = normalizeText(finalResponse);

  for (let batchIndex = 0; batchIndex < groups.length; batchIndex++) {
    const group = groups[batchIndex];
    const rows = Array.isArray(group) ? group : [group];
    for (let eventIndex = 0; eventIndex < rows.length; eventIndex++) {
      const raw = rows[eventIndex];
      if (!raw || typeof raw !== "object") continue;
      const event = raw as RawLlmEvent;
      const parsed = parsePromptResponse(event.prompt_response);
      events.push({
        index: events.length,
        batch_index: batchIndex,
        event_index: eventIndex,
        ...(typeof event.agent_name === "string" ? { agent_name: event.agent_name } : {}),
        ...(typeof event.prompt_name === "string" ? { prompt_name: event.prompt_name } : {}),
        content: parsed.content,
        content_chars: parsed.content.length,
        tool_calls: parsed.toolCalls,
        kind: parsed.kind,
        response_format: parsed.format,
        ...numberField(event.execution_latency ?? event.executionLatency, "latency_ms"),
        ...numberField(event.startExecutionTime, "started_at"),
        ...numberField(event.endExecutionTime, "ended_at"),
        matches_final_response:
          normalizedFinal.length > 0 && normalizeText(parsed.content) === normalizedFinal,
      });
    }
  }

  const nonEmptyContentCount = events.filter((event) => event.kind === "content").length;
  const finalMatch = [...events].reverse().find((event) => event.matches_final_response);

  return {
    events,
    llm_call_count: events.length,
    non_empty_content_count: nonEmptyContentCount,
    tool_only_count: events.filter((event) => event.kind === "tool_only").length,
    malformed_count: events.filter((event) => event.kind === "malformed").length,
    ...(finalResponse !== undefined ? { final_response: finalResponse } : {}),
    ...(finalMatch ? { final_response_event_index: finalMatch.index } : {}),
    integrity: integrity(events.length, nonEmptyContentCount, maxNonEmptyContents),
  };
}

function parsePromptResponse(raw: unknown): ParsedPromptResponse {
  if (raw === undefined || raw === null || raw === "") {
    return { content: "", toolCalls: [], kind: "empty", format: "missing" };
  }

  if (typeof raw !== "string") {
    return parseJsonValue(raw, "json");
  }

  try {
    return parseJsonValue(JSON.parse(raw) as unknown, "json");
  } catch {
    const trimmed = raw.trim();
    const looksJson = trimmed.startsWith("{") || trimmed.startsWith("[");
    return {
      content: raw,
      toolCalls: [],
      kind: looksJson ? "malformed" : trimmed.length > 0 ? "content" : "empty",
      format: looksJson ? "malformed_json" : "plain_text",
    };
  }
}

function parseJsonValue(value: unknown, format: LlmResponseFormat): ParsedPromptResponse {
  if (!value || typeof value !== "object") {
    const content = typeof value === "string" ? value : "";
    return {
      content,
      toolCalls: [],
      kind: content.trim().length > 0 ? "content" : "empty",
      format,
    };
  }

  const row = value as Record<string, unknown>;
  const content = typeof row.content === "string" ? row.content : "";
  const invocations = Array.isArray(row.tool_invocations) ? row.tool_invocations : [];
  const toolCalls = invocations
    .map((candidate) => {
      if (!candidate || typeof candidate !== "object") return undefined;
      const fn = (candidate as { function?: unknown }).function;
      if (!fn || typeof fn !== "object") return undefined;
      const name = (fn as { name?: unknown }).name;
      return typeof name === "string" && name.length > 0 ? name : undefined;
    })
    .filter((name): name is string => name !== undefined);

  return {
    content,
    toolCalls,
    kind: content.trim().length > 0 ? "content" : toolCalls.length > 0 ? "tool_only" : "empty",
    format,
  };
}

function integrity(
  eventCount: number,
  nonEmptyContentCount: number,
  maxNonEmptyContents: number,
): TurnResponseIntegrity {
  if (eventCount === 0) {
    return {
      status: "unavailable",
      max_non_empty_contents: maxNonEmptyContents,
      message: "No lastExecution.llmEvents evidence was available for this turn.",
    };
  }
  if (nonEmptyContentCount > maxNonEmptyContents) {
    return {
      status: "warning",
      max_non_empty_contents: maxNonEmptyContents,
      message: `${nonEmptyContentCount} non-empty LLM completions exceed the configured maximum of ${maxNonEmptyContents}.`,
    };
  }
  return { status: "pass", max_non_empty_contents: maxNonEmptyContents };
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function numberField<K extends "latency_ms" | "started_at" | "ended_at">(
  value: unknown,
  key: K,
): Partial<Record<K, number>> {
  return typeof value === "number" && Number.isFinite(value)
    ? ({ [key]: value } as Partial<Record<K, number>>)
    : {};
}
