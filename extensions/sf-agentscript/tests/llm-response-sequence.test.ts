/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { buildLlmResponseSequence } from "../lib/llm-response-sequence.ts";

function jsonResponse(content: string, tools: string[] = []): string {
  return JSON.stringify({
    content,
    tool_invocations: tools.map((name, index) => ({
      id: `call-${index}`,
      function: { name, arguments: "{}" },
    })),
  });
}

describe("buildLlmResponseSequence", () => {
  test("retains every nested LLM event and classifies caller-facing content", () => {
    const sequence = buildLlmResponseSequence(
      [
        [
          {
            agent_name: "Agent Router",
            prompt_name: "router_prompt",
            prompt_response: jsonResponse("", ["continue_service"]),
            execution_latency: 100,
          },
          {
            agent_name: "Agent Router",
            prompt_name: "router_prompt",
            prompt_response: jsonResponse("Can you provide more details?"),
            execution_latency: 200,
          },
        ],
        [
          {
            agent_name: "Service",
            prompt_name: "service_prompt",
            prompt_response: jsonResponse("", ["resolve_issue"]),
            execution_latency: 300,
          },
          {
            agent_name: "Service",
            prompt_name: "service_prompt",
            prompt_response: jsonResponse("Are you currently at the equipment?"),
            execution_latency: 400,
          },
        ],
      ],
      "Are you currently at the equipment?",
    );

    expect(sequence.events).toHaveLength(4);
    expect(sequence.events.map((event) => event.index)).toEqual([0, 1, 2, 3]);
    expect(sequence.events.map((event) => [event.batch_index, event.event_index])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ]);
    expect(sequence.events.map((event) => event.kind)).toEqual([
      "tool_only",
      "content",
      "tool_only",
      "content",
    ]);
    expect(sequence.events[0].tool_calls).toEqual(["continue_service"]);
    expect(sequence.events[2].tool_calls).toEqual(["resolve_issue"]);
    expect(sequence.events[1].content).toBe("Can you provide more details?");
    expect(sequence.events[3].content).toBe("Are you currently at the equipment?");
    expect(sequence.events[3].matches_final_response).toBe(true);
    expect(sequence.final_response_event_index).toBe(3);
    expect(sequence.llm_call_count).toBe(4);
    expect(sequence.non_empty_content_count).toBe(2);
    expect(sequence.tool_only_count).toBe(2);
    expect(sequence.integrity).toEqual({
      status: "warning",
      max_non_empty_contents: 1,
      message: "2 non-empty LLM completions exceed the configured maximum of 1.",
    });
  });

  test("supports flat event arrays and legacy plain-text responses", () => {
    const sequence = buildLlmResponseSequence(
      [
        {
          agent_name: "Legacy",
          prompt_response: "A legacy plain-text response",
          executionLatency: 25,
        },
      ],
      "A legacy plain-text response",
    );

    expect(sequence.events).toHaveLength(1);
    expect(sequence.events[0]).toMatchObject({
      content: "A legacy plain-text response",
      kind: "content",
      response_format: "plain_text",
      latency_ms: 25,
      matches_final_response: true,
    });
    expect(sequence.integrity.status).toBe("pass");
  });

  test("marks JSON-looking malformed responses without dropping the raw text", () => {
    const malformed = '{"content":"broken"';
    const sequence = buildLlmResponseSequence([[{ prompt_response: malformed }]], undefined);

    expect(sequence.events).toHaveLength(1);
    expect(sequence.events[0]).toMatchObject({
      content: malformed,
      kind: "malformed",
      response_format: "malformed_json",
    });
    expect(sequence.malformed_count).toBe(1);
  });

  test("reports unavailable when get_state has no LLM events", () => {
    const sequence = buildLlmResponseSequence(undefined, "Final response only");

    expect(sequence.events).toEqual([]);
    expect(sequence.integrity).toEqual({
      status: "unavailable",
      max_non_empty_contents: 1,
      message: "No lastExecution.llmEvents evidence was available for this turn.",
    });
  });

  test("treats whitespace content as empty", () => {
    const sequence = buildLlmResponseSequence(
      [[{ prompt_response: jsonResponse("   ") }]],
      undefined,
    );

    expect(sequence.events[0].kind).toBe("empty");
    expect(sequence.events[0].content).toBe("   ");
    expect(sequence.non_empty_content_count).toBe(0);
  });
});
