/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: pair agent.send_message outputs with the agent.get_state output
 * that immediately follows in execution order, NOT by guessing IDs match
 * `turn<n>` ↔ `state<n>`. The previous implementation silently dropped topic,
 * latency_ms, plan_id, state_variables, and invoked_actions from transcript
 * + FailureRecord whenever the spec used a different naming convention
 * (e.g. `t1` ↔ `s1`, or `sm` with no matching state output).
 */

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { writeRun } from "../lib/eval/persist.ts";
import { buildFailureRecord } from "../lib/eval/render.ts";
import type { EvalApiResponse, RunMetadata, TestResult } from "../lib/eval/types.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-pair-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const STATE_OUTPUT = (topic: string, planId: string, latency: number) => ({
  type: "agent.get_state" as const,
  response: {
    planner_response: {
      lastExecution: {
        agentResponse: "ack",
        topic,
        latency,
        invokedActions: ["lookup", "create_case"],
        message: { planId },
      },
      sessionContext: {
        stateVariables: { user_topic: topic },
      },
    },
  },
});

const META: RunMetadata = {
  run_id: "test",
  org: "x",
  started: new Date().toISOString(),
  completed: new Date().toISOString(),
  duration_ms: 0,
  tests_count: 1,
  batches: 1,
  concurrency: 1,
  traces_mode: "off",
  traces_fetched: 0,
  totals: { tests: 1, test_pass: 1, test_fail: 0, evals: 0, ev_pass: 0, ev_fail: 0, errors: 0 },
  latency_summary: { count: 0 },
};

describe("send_message ↔ get_state pairing by execution order", () => {
  test("pairs t1↔s1, t2↔s2 (the convention that broke the old name-based pairing)", async () => {
    const merged: EvalApiResponse = {
      results: [
        {
          id: "deep_flow",
          outputs: [
            { type: "agent.create_session", id: "cs", session_id: "abc" },
            { type: "agent.send_message", id: "t1", response: "ask password system" },
            STATE_OUTPUT("password_reset", "plan-1", 1390),
            { type: "agent.send_message", id: "t2", response: "reset started" },
            STATE_OUTPUT("topic_selector", "plan-2", 1067),
          ],
          evaluation_results: [],
          errors: [],
        },
      ],
    };

    await writeRun({
      runDir: workDir,
      merged,
      traces: new Map(),
      metadata: META,
      failures: [],
    });

    const lines = (await readFile(path.join(workDir, "transcript.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));

    expect(lines).toHaveLength(2);

    expect(lines[0].turn_id).toBe("t1");
    expect(lines[0].topic).toBe("password_reset");
    expect(lines[0].latency_ms).toBe(1390);
    expect(lines[0].plan_id).toBe("plan-1");
    expect(lines[0].invoked_actions).toEqual(["lookup", "create_case"]);
    expect(lines[0].state_variables).toEqual({ user_topic: "password_reset" });

    expect(lines[1].turn_id).toBe("t2");
    expect(lines[1].topic).toBe("topic_selector");
    expect(lines[1].latency_ms).toBe(1067);
  });

  test("persists and exposes every parsed LLM response without the first-three truncation", async () => {
    const llmEvents = [
      [
        {
          agent_name: "Router",
          prompt_response: JSON.stringify({
            content: "",
            tool_invocations: [{ function: { name: "continue_flow" } }],
          }),
        },
        {
          agent_name: "Router",
          prompt_response: JSON.stringify({ content: "Intermediate response" }),
        },
      ],
      [
        {
          agent_name: "Service",
          prompt_response: JSON.stringify({
            content: "",
            tool_invocations: [{ function: { name: "resolve_issue" } }],
          }),
        },
        {
          agent_name: "Service",
          prompt_response: JSON.stringify({ content: "Final response" }),
        },
      ],
    ];
    const state = STATE_OUTPUT("service", "plan-sequence", 500);
    const lastExecution = state.response.planner_response
      .lastExecution as typeof state.response.planner_response.lastExecution & {
      llmEvents?: unknown[];
    };
    lastExecution.llmEvents = llmEvents;
    lastExecution.agentResponse = "Final response";
    const test: TestResult = {
      id: "response_sequence",
      outputs: [{ type: "agent.send_message", id: "turn", response: "Final response" }, state],
      evaluation_results: [],
      errors: [],
    };
    const merged: EvalApiResponse = { results: [test] };

    await writeRun({
      runDir: workDir,
      merged,
      traces: new Map(),
      metadata: META,
      failures: [],
    });

    const transcript = JSON.parse(
      (await readFile(path.join(workDir, "transcript.jsonl"), "utf8")).trim(),
    );
    expect(transcript.response_sequence.events).toHaveLength(4);
    expect(transcript.response_sequence.non_empty_content_count).toBe(2);
    expect(transcript.response_sequence.events[3]).toMatchObject({
      content: "Final response",
      matches_final_response: true,
    });

    const failure = buildFailureRecord(test, []);
    expect(failure.turns[0].response_sequence.events).toHaveLength(4);
    expect(failure.turns[0].response_sequence.integrity.status).toBe("warning");
  });

  test("legacy turn1/state1 naming still works", async () => {
    const merged: EvalApiResponse = {
      results: [
        {
          id: "legacy",
          outputs: [
            { type: "agent.send_message", id: "turn1", response: "x" },
            { ...STATE_OUTPUT("topic_a", "p1", 100), id: "state1" },
          ],
          evaluation_results: [],
          errors: [],
        },
      ],
    };

    await writeRun({
      runDir: workDir,
      merged,
      traces: new Map(),
      metadata: META,
      failures: [],
    });

    const line = JSON.parse(
      (await readFile(path.join(workDir, "transcript.jsonl"), "utf8")).trim().split("\n")[0],
    );
    expect(line.topic).toBe("topic_a");
    expect(line.latency_ms).toBe(100);
  });

  test("send with no following get_state ⇒ topic null but turn still recorded", async () => {
    const merged: EvalApiResponse = {
      results: [
        {
          id: "no_state",
          outputs: [{ type: "agent.send_message", id: "sm", response: "hello" }],
          evaluation_results: [],
          errors: [],
        },
      ],
    };

    await writeRun({
      runDir: workDir,
      merged,
      traces: new Map(),
      metadata: META,
      failures: [],
    });

    const line = JSON.parse(
      (await readFile(path.join(workDir, "transcript.jsonl"), "utf8")).trim().split("\n")[0],
    );
    expect(line.turn_id).toBe("sm");
    expect(line.agent_response).toBe("hello");
    expect(line.topic).toBeUndefined();
    expect(line.latency_ms).toBeUndefined();
  });

  test("buildFailureRecord pairs by order, fills topic + invoked_actions", () => {
    const test: TestResult = {
      id: "deep_flow",
      outputs: [
        { type: "agent.send_message", id: "t1", response: "ask" },
        STATE_OUTPUT("password_reset", "plan-1", 900),
      ],
    };
    const failure = buildFailureRecord(test, []);
    expect(failure.turns).toHaveLength(1);
    expect(failure.turns[0].topic).toBe("password_reset");
    // Note: state_variables in the FailureRecord path is filtered to
    // DEFAULT_INTERESTING_STATE_KEYS; the unfiltered map lives in the
    // transcript.jsonl path covered by the writeRun tests above.
  });
});
