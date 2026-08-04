/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readEvalRunArtifact } from "../lib/eval-studio/artifact-reader.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Eval Studio artifact reader", () => {
  it("reconstructs legacy transcript response sequences from raw eval evidence", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "eval-studio-legacy-sequence-"));
    dirs.push(base);
    const runId = "run-legacy-sequence";
    const runDir = path.join(base, runId);
    await mkdir(runDir);
    const spec = {
      tests: [
        {
          id: "scenario",
          steps: [{ type: "evaluator.string_assertion", id: "ok" }],
        },
      ],
    };
    await writeFile(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: runId,
        created: "2026-08-04T00:00:00.000Z",
        scope: "suite",
        org: "sandbox",
        org_id: "00D000000000001",
        source_digest: "source",
        executed_digest: "executed",
        source_snapshot: "spec.source.snapshot.json",
        executed_snapshot: "spec.executed.snapshot.json",
        expected: { scenarios: [{ id: "scenario", evaluator_ids: ["ok"] }] },
      }),
    );
    await writeFile(path.join(runDir, "spec.source.snapshot.json"), JSON.stringify(spec));
    await writeFile(path.join(runDir, "spec.executed.snapshot.json"), JSON.stringify(spec));
    await writeFile(
      path.join(runDir, "transcript.jsonl"),
      `${JSON.stringify({
        test_id: "scenario",
        turn_id: "turn1",
        agent_response: "Final response",
      })}\n`,
    );
    await writeFile(
      path.join(runDir, "raw.json"),
      JSON.stringify({
        results: [
          {
            id: "scenario",
            outputs: [
              { type: "agent.send_message", id: "turn1", response: "Final response" },
              {
                type: "agent.get_state",
                id: "state1",
                response: {
                  planner_response: {
                    lastExecution: {
                      agentResponse: "Final response",
                      llmEvents: [
                        [
                          {
                            prompt_response: JSON.stringify({ content: "Intermediate response" }),
                          },
                          { prompt_response: JSON.stringify({ content: "Final response" }) },
                        ],
                      ],
                    },
                  },
                },
              },
            ],
            evaluation_results: [{ id: "ok", is_pass: true }],
          },
        ],
      }),
    );

    const artifact = await readEvalRunArtifact(runDir, { details: true });
    expect(artifact.summary.turns?.[0]?.response_sequence?.events).toHaveLength(2);
    expect(artifact.summary.turns?.[0]?.response_sequence?.non_empty_content_count).toBe(2);
  });

  it("preserves recorded verdict while deriving the current interpretation from immutable evidence", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "eval-studio-artifact-"));
    dirs.push(base);
    const runId = "run-current";
    const runDir = path.join(base, runId);
    await mkdir(runDir);
    const spec = {
      tests: [
        {
          id: "scenario",
          steps: [{ type: "evaluator.string_assertion", id: "ok" }],
        },
      ],
    };
    await writeFile(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: runId,
        created: "2026-07-30T00:00:00.000Z",
        scope: "suite",
        spec_path: "tests/agentforce/Demo.eval.json",
        org: "sandbox",
        org_id: "00D000000000001",
        agent_api_name: "Demo",
        source_digest: "source",
        executed_digest: "executed",
        source_snapshot: "spec.source.snapshot.json",
        executed_snapshot: "spec.executed.snapshot.json",
        expected: { scenarios: [{ id: "scenario", evaluator_ids: ["ok"] }] },
      }),
    );
    await writeFile(
      path.join(runDir, "metadata.json"),
      JSON.stringify({
        run_id: runId,
        started: "2026-07-30T00:00:00.000Z",
        completed: "2026-07-30T00:00:01.000Z",
        execution_state: "completed",
        evidence_verdict: "passed",
        verdict_semantics_version: 0,
        duration_ms: 1000,
        tests_count: 1,
        batches: 1,
        concurrency: 1,
        traces_mode: "off",
        traces_fetched: 0,
        totals: {
          tests: 1,
          test_pass: 1,
          test_fail: 0,
          evals: 1,
          ev_pass: 1,
          ev_fail: 0,
          errors: 0,
        },
        latency_summary: { count: 0 },
      }),
    );
    await writeFile(path.join(runDir, "spec.executed.snapshot.json"), JSON.stringify(spec));
    await writeFile(path.join(runDir, "spec.source.snapshot.json"), JSON.stringify(spec));
    await writeFile(
      path.join(runDir, "raw.json"),
      JSON.stringify({
        results: [
          {
            id: "scenario",
            evaluation_results: [
              {
                id: "ok",
                type: "evaluator.string_assertion",
                is_pass: false,
                actual_value: "token=secret-value",
              },
            ],
          },
        ],
      }),
    );

    const artifact = await readEvalRunArtifact(runDir, { details: true });
    expect(artifact.summary).toMatchObject({
      recorded_verdict: "passed",
      current_verdict: "failed",
    });
    expect(artifact.summary.evaluators?.[0]?.actual_value).not.toContain("secret-value");
  });

  it("masks resolved org-seed values across executed source, evaluator, response, and state views", async () => {
    const base = await mkdtemp(path.join(tmpdir(), "eval-studio-seed-redaction-"));
    dirs.push(base);
    const runId = "run-seeded";
    const runDir = path.join(base, runId);
    await mkdir(runDir);
    const executed = {
      tests: [
        {
          id: "scenario",
          steps: [
            {
              type: "agent.send_message",
              id: "turn1",
              context_variables: [{ name: "customer_id", type: "Text", value: "001SECRET" }],
            },
          ],
        },
      ],
    };
    await writeFile(
      path.join(runDir, "manifest.json"),
      JSON.stringify({
        schema_version: 2,
        run_id: runId,
        created: "2026-08-01T00:00:00.000Z",
        scope: "suite",
        org: "sandbox",
        org_id: "00D000000000001",
        source_digest: "source",
        executed_digest: "executed",
        source_snapshot: "spec.source.snapshot.json",
        executed_snapshot: "spec.executed.snapshot.json",
        expected: { scenarios: [{ id: "scenario", evaluator_ids: ["ok"] }] },
        seed_provenance: [
          {
            scenario_id: "scenario",
            names: ["customer_id"],
            profile: "customer",
            query_digest: "digest",
          },
        ],
      }),
    );
    await writeFile(
      path.join(runDir, "metadata.json"),
      JSON.stringify({
        run_id: runId,
        started: "2026-08-01T00:00:00.000Z",
        completed: "2026-08-01T00:00:01.000Z",
        execution_state: "completed",
        evidence_verdict: "passed",
        verdict_semantics_version: 1,
        duration_ms: 1000,
        tests_count: 1,
        batches: 1,
        concurrency: 1,
        traces_mode: "off",
        traces_fetched: 0,
        totals: {
          tests: 1,
          test_pass: 1,
          test_fail: 0,
          evals: 1,
          ev_pass: 1,
          ev_fail: 0,
          errors: 0,
        },
        latency_summary: { count: 0 },
      }),
    );
    await writeFile(path.join(runDir, "spec.source.snapshot.json"), JSON.stringify(executed));
    await writeFile(path.join(runDir, "spec.executed.snapshot.json"), JSON.stringify(executed));
    await writeFile(
      path.join(runDir, "evidence.json"),
      JSON.stringify({
        scenarios: [
          {
            id: "scenario",
            evaluators: [{ id: "ok", is_pass: true, actual_value: "Account 001SECRET is ready" }],
          },
        ],
      }),
    );
    await writeFile(
      path.join(runDir, "transcript.jsonl"),
      `${JSON.stringify({
        test_id: "scenario",
        turn_id: "turn1",
        agent_response: "Account 001SECRET is ready",
        state_variables: { customer_id: "001SECRET", safe_state: "visible" },
        response_sequence: {
          events: [
            {
              index: 0,
              batch_index: 0,
              event_index: 0,
              agent_name: "Router",
              content: "Intermediate account 001SECRET response",
              content_chars: 39,
              tool_calls: [],
              kind: "content",
              response_format: "json",
              matches_final_response: false,
            },
            {
              index: 1,
              batch_index: 0,
              event_index: 1,
              agent_name: "Service",
              content: "Account 001SECRET is ready",
              content_chars: 26,
              tool_calls: [],
              kind: "content",
              response_format: "json",
              matches_final_response: true,
            },
          ],
          llm_call_count: 2,
          non_empty_content_count: 2,
          tool_only_count: 0,
          malformed_count: 0,
          final_response: "Account 001SECRET is ready",
          final_response_event_index: 1,
          integrity: {
            status: "warning",
            max_non_empty_contents: 1,
            message: "2 non-empty LLM completions exceed the configured maximum of 1.",
          },
        },
      })}\n`,
    );

    const artifact = await readEvalRunArtifact(runDir, {
      details: true,
      source: true,
      evidence: true,
    });
    expect(JSON.stringify(artifact.summary)).not.toContain("001SECRET");
    expect(artifact.summary.turns?.[0]?.state_variables).toEqual({
      customer_id: "[REDACTED]",
      safe_state: "visible",
    });
    expect(artifact.summary.turns?.[0]?.agent_response).toContain("[REDACTED]");
    expect(artifact.summary.turns?.[0]?.response_sequence?.events).toHaveLength(2);
    expect(artifact.summary.turns?.[0]?.response_sequence?.events[0].content).toContain(
      "[REDACTED]",
    );
    expect(artifact.summary.turns?.[0]?.response_sequence?.integrity.status).toBe("warning");
    expect(artifact.summary.evaluators?.[0]?.actual_value).toContain("[REDACTED]");
  });
});
