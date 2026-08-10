/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import { buildLlmResponseSequence } from "../lib/llm-response-sequence.ts";
import { responseSequenceLines } from "../lib/render/response-sequence.ts";

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

  test("collapses mirrored router and system-safety aliases into one physical completion", () => {
    const prompt = "system safety prompt";
    const response = jsonResponse("Sorry, I can't assist with that.");
    const sequence = buildLlmResponseSequence(
      [
        [
          {
            agent_name: "Agent Router",
            prompt_name: "Agent Router_prompt",
            prompt_content: prompt,
            prompt_response: response,
            startExecutionTime: 1000,
            endExecutionTime: 1100,
          },
          {
            agent_name: "Prompt_Injection",
            prompt_name: "Prompt_Injection_prompt",
            prompt_content: prompt,
            prompt_response: response,
            startExecutionTime: 1000,
            endExecutionTime: 1100,
          },
        ],
      ],
      "Sorry, I can't assist with that.",
    );

    expect(sequence.events).toHaveLength(2);
    expect(sequence.events[1].mirrored_alias_of).toBe(0);
    expect(sequence.raw_llm_event_count).toBe(2);
    expect(sequence.llm_call_count).toBe(1);
    expect(sequence.physical_llm_call_count).toBe(1);
    expect(sequence.raw_non_empty_content_count).toBe(2);
    expect(sequence.non_empty_content_count).toBe(1);
    expect(sequence.physical_non_empty_content_count).toBe(1);
    expect(sequence.mirrored_alias_count).toBe(1);
    expect(sequence.integrity.status).toBe("pass");
    const rendered = responseSequenceLines(sequence).join("\n");
    expect(rendered).toContain("2 raw events · 1 physical call · 1 mirrored safety alias");
    expect(rendered).toContain("mirrored alias of 1");
  });

  test("allows one millisecond end-time drift for strict safety aliases", () => {
    const prompt = "system safety prompt";
    const response = jsonResponse("Safe refusal");
    const sequence = buildLlmResponseSequence([
      [
        {
          agent_name: "Agent Router",
          prompt_name: "Agent Router_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 2000,
          endExecutionTime: 2100,
        },
        {
          agent_name: "Inappropriate_Content",
          prompt_name: "Inappropriate_Content_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 2000,
          endExecutionTime: 2101,
        },
      ],
    ]);

    expect(sequence.mirrored_alias_count).toBe(1);
    expect(sequence.non_empty_content_count).toBe(1);
    expect(sequence.integrity.status).toBe("pass");
  });

  test("keeps sequential repeated completions as distinct failures", () => {
    const prompt = "same prompt";
    const response = jsonResponse("Repeated response");
    const sequence = buildLlmResponseSequence([
      [
        {
          agent_name: "Agent Router",
          prompt_name: "Agent Router_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 3000,
          endExecutionTime: 3100,
        },
        {
          agent_name: "Prompt_Injection",
          prompt_name: "Prompt_Injection_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 3200,
          endExecutionTime: 3300,
        },
      ],
    ]);

    expect(sequence.mirrored_alias_count).toBe(0);
    expect(sequence.non_empty_content_count).toBe(2);
    expect(sequence.integrity.status).toBe("warning");
  });

  test("does not collapse safety labels when raw prompt evidence is missing", () => {
    const response = jsonResponse("Same response");
    const sequence = buildLlmResponseSequence([
      [
        {
          agent_name: "Agent Router",
          prompt_name: "Agent Router_prompt",
          prompt_response: response,
          startExecutionTime: 3500,
          endExecutionTime: 3600,
        },
        {
          agent_name: "Prompt_Injection",
          prompt_name: "Prompt_Injection_prompt",
          prompt_response: response,
          startExecutionTime: 3500,
          endExecutionTime: 3600,
        },
      ],
    ]);

    expect(sequence.mirrored_alias_count).toBe(0);
    expect(sequence.non_empty_content_count).toBe(2);
    expect(sequence.integrity.status).toBe("warning");
  });

  test("does not collapse simultaneous events from ordinary agent labels", () => {
    const prompt = "same prompt";
    const response = jsonResponse("Same response");
    const sequence = buildLlmResponseSequence([
      [
        {
          agent_name: "Agent Router",
          prompt_name: "Agent Router_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 4000,
          endExecutionTime: 4100,
        },
        {
          agent_name: "Appointments",
          prompt_name: "Appointments_prompt",
          prompt_content: prompt,
          prompt_response: response,
          startExecutionTime: 4000,
          endExecutionTime: 4100,
        },
      ],
    ]);

    expect(sequence.mirrored_alias_count).toBe(0);
    expect(sequence.non_empty_content_count).toBe(2);
    expect(sequence.integrity.status).toBe("warning");
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
