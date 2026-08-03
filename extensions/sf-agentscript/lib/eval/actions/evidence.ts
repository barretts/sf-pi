/* SPDX-License-Identifier: Apache-2.0 */
/** Eval evidence actions: failure drill-down and explicit trace retrieval. */
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { readFailures, readMetadata } from "../orchestrator.ts";
import { evalProjectRoot, type EvalRunManifest } from "../persist.ts";
import { fetchTrace } from "../trace-client.ts";
import { redactResolvedSeedValues, type EvalSeedProvenance } from "../seeds.ts";
import {
  resolveLatestEvalRun,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { EvalSpec, FailureRecord, RunMetadata } from "../types.ts";
import type { TimingCollector } from "../../timings.ts";

const EVAL_TOOL_NAME = "agentscript_eval";

export interface GetEvalFailureActionInput {
  run_id?: string;
  test_id?: string;
}

export interface TraceEvalActionInput {
  target_org?: string;
  session_id?: string;
  plan_id?: string;
  timeout_ms?: number;
}

function evalTraceEvents(sessionId: string, planId: string): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "eval_trace",
      session_id: sessionId,
      plan_id: planId,
      source: "eval.trace",
    },
  ];
}

export async function readPublicFailures(
  ctx: ExtensionContext,
  runId: string,
): Promise<FailureRecord[]> {
  const failures = await readFailures(ctx.cwd, runId);
  const runDir = path.join(
    evalProjectRoot(ctx.cwd),
    ".pi",
    "state",
    "sf-agentscript",
    "runs",
    runId,
  );
  let manifest: EvalRunManifest;
  try {
    manifest = JSON.parse(
      await readFile(path.join(runDir, "manifest.json"), "utf8"),
    ) as EvalRunManifest;
  } catch {
    throw new Error(`Unable to safely expose failure evidence for run '${runId}'.`);
  }
  if (manifest.schema_version !== 2 || manifest.run_id !== runId) {
    throw new Error(`Unable to safely expose failure evidence for run '${runId}'.`);
  }
  const rows = manifest.seed_provenance ?? [];
  if (rows.length === 0) return failures;
  let spec: EvalSpec;
  try {
    spec = JSON.parse(
      await readFile(path.join(runDir, "spec.executed.snapshot.json"), "utf8"),
    ) as EvalSpec;
  } catch {
    throw new Error(`Unable to safely redact seeded failure evidence for run '${runId}'.`);
  }
  const provenance: EvalSeedProvenance[] = rows.map((row) => ({
    profile: row.profile ?? "context_variables",
    scenario_ids: [row.scenario_id],
    variable_names: row.names,
    sensitive_variable_names: row.sensitive_names ?? row.names,
    query_digest: row.query_digest ?? "",
  }));
  return redactResolvedSeedValues(failures, spec, provenance);
}

export async function actionGetFailure(
  ctx: ExtensionContext,
  input: GetEvalFailureActionInput,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolvedRun = await resolveLatestEvalRun(ctx, input.run_id);
  if ("runId" in resolvedRun === false) return resolvedRun;
  input = { ...input, run_id: resolvedRun.runId };

  let all: FailureRecord[];
  let meta: RunMetadata | null;
  try {
    all = await readPublicFailures(ctx, input.run_id);
    meta = await readMetadata(ctx.cwd, input.run_id);
  } catch (err) {
    return toolError(
      err instanceof Error ? err.message : String(err),
      "Confirm the run id from a previous agentscript_eval action='run' result.",
    );
  }

  if (input.test_id) {
    const found = all.find((f) => f.test_id === input.test_id);
    if (!found) {
      return toolError(
        `No failure with test_id='${input.test_id}' in run ${input.run_id}.`,
        `Available test_ids: ${all.map((f) => f.test_id).join(", ") || "(none)"}.`,
        {
          tool: EVAL_TOOL_NAME,
          params: { action: "get_failure", run_id: input.run_id },
        },
      );
    }
    return toolOk({ ok: true as const, run_id: input.run_id, failure: found, run_metadata: meta });
  }

  return toolOk({
    ok: true as const,
    run_id: input.run_id,
    total_failures: all.length,
    failures: all,
    run_metadata: meta,
  });
}

// -------------------------------------------------------------------------------------------------
// action = trace
// -------------------------------------------------------------------------------------------------

export async function actionTrace(
  input: TraceEvalActionInput,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org, { signal });
    authPhase?.end({ cache: auth.cache });
    const trace = timings
      ? await timings.time("trace_fetch", () =>
          fetchTrace(auth.conn, input.session_id, input.plan_id, {
            timeoutMs: input.timeout_ms ?? 60_000,
            signal,
          }),
        )
      : await fetchTrace(auth.conn, input.session_id, input.plan_id, {
          timeoutMs: input.timeout_ms ?? 60_000,
          signal,
        });
    if (trace == null) {
      return toolError(
        `Trace not found for session=${input.session_id} plan=${input.plan_id}.`,
        "Confirm both ids and that the session is still resident on the planner.",
      );
    }
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          session_id: input.session_id,
          plan_id: input.plan_id,
          trace_hint:
            "PlannerResponse with steps[]: UserInputStep, UpdateTopicStep, " +
            "LLMExecutionStep (promptContent, promptResponse, executionLatency), " +
            "FunctionCallStep, ValidationPromptStep, EventStep.",
          trace,
        },
        evalTraceEvents(input.session_id, input.plan_id),
      ),
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
