/* SPDX-License-Identifier: Apache-2.0 */
/** Preview planner-trace action. */
import { connForAgentApi } from "../../agent-api-auth.ts";
import { fetchTrace } from "../../eval/trace-client.ts";
import type { TimingCollector } from "../../timings.ts";
import { toolError, toolOk, type ToolError } from "../../tool-types.ts";

export interface TracePreviewActionInput {
  target_org?: string;
  session_id?: string;
  plan_id?: string;
}

export async function actionTrace(
  input: TracePreviewActionInput,
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
          fetchTrace(auth.conn, input.session_id, input.plan_id, { signal }),
        )
      : await fetchTrace(auth.conn, input.session_id, input.plan_id, { signal });
    if (trace == null) {
      return toolError(
        `Trace not found for session=${input.session_id} plan=${input.plan_id}.`,
        "Confirm both ids and that the session is still resident on the planner.",
      );
    }
    const { summarizeTrace } = await import("../trace-digest.ts");
    const digest = summarizeTrace(trace, {
      planId: input.plan_id,
    });
    return toolOk({
      ok: true as const,
      session_id: input.session_id,
      plan_id: input.plan_id,
      digest,
      trace_hint:
        "`digest.timeline[]` keeps every step type the runtime emitted (UserInputStep, LLMStep, UpdateTopicStep, TransitionStep, VariableUpdateStep, FunctionStep, NodeEntryStateStep, EnabledToolsStep, BeforeReasoningIterationStep, AfterReasoningStep, PlannerResponseStep, OutputEvaluationStep, PlatformNotificationStep, ReasoningStep, etc.). Heavy fields (full prompts, full variable maps) are clipped — the full trace JSON is in `trace`.",
      trace,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
