/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tool: agentscript_eval — multi-action eval surface.
 *
 * Replaces the four single-purpose tools (eval_run, eval_get_failure,
 * eval_trace, eval_resolve) with one tool dispatched on `action`. Schema
 * is a typebox discriminated union so per-action required fields are
 * enforced statically.
 *
 * Actions:
 *   run             Run a multi-turn regression spec.
 *   run_release     Generate/run the exact-version baseline and designated
 *                   release suite when configured.
 *   get_failure     Drill into one (or all) failures from a previous run.
 *   trace           Fetch a single planner trace by (session_id, plan_id).
 *   resolve_active  Resolve $active_* placeholders from the org's
 *                   Active BotVersion + matching planner definition.
 *
 * Auth: @salesforce/core Connection (no subprocess).
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "./agent-api-auth.ts";
import { connFromAlias } from "../../../lib/common/sf-conn/connection.ts";
import {
  EvalRunCancelledError,
  runEval,
  recordRunInIndex,
  readFailures,
  readMetadata,
  type RunEvalResult,
} from "./eval/orchestrator.ts";
import { evalProjectRoot, type EvalRunManifest } from "./eval/persist.ts";
import {
  resolveAgentIds,
  substitutePlaceholders,
  type ResolvedAgentIds,
  type StatusFilter,
} from "./eval/active-ids.ts";
import { fetchTrace } from "./eval/trace-client.ts";
import { generateSpec } from "./eval/spec-generator.ts";
import {
  applyGeneratedBaselineSeedConfig,
  redactResolvedSeedValues,
  type EvalSeedProvenance,
} from "./eval/seeds.ts";
import { inspectFile } from "./inspect.ts";
import { isAgentScriptFile } from "./file-classify.ts";
import {
  agentFileEvent,
  latestEvalSpec,
  resolveLatestEvalRun,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "./branch-state.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "./tool-types.ts";
import type { EvalSpec, FailureRecord, RunMetadata } from "./eval/types.ts";

import { renderEvalCall, renderEvalRunResult, renderEvalGetFailureResult } from "./render/eval.ts";
import { createTimingCollector, withTimings, type TimingCollector } from "./timings.ts";
import { readEffectiveAgentScriptSettings } from "./settings.ts";
import {
  AGENT_SCRIPT_RELEASE_BASELINE_ID,
  defaultReleaseSpecPath,
  hashEvalSpec,
  recordReleaseEvidence,
  rewriteReleaseSpecForLatest,
} from "./release-contract.ts";

export const EVAL_TOOL_NAME = "agentscript_eval";

// -------------------------------------------------------------------------------------------------
// Schema
//
// Single Type.Object: emits root `type:"object"` so OpenAI's strict tool
// validator accepts it. Per-action required-field checks happen in execute().
// -------------------------------------------------------------------------------------------------

const Params = Type.Object({
  action: Type.Union(
    [
      Type.Literal("run"),
      Type.Literal("run_release"),
      Type.Literal("get_failure"),
      Type.Literal("trace"),
      Type.Literal("resolve_active"),
      Type.Literal("generate_spec"),
    ],
    {
      description:
        "run: full multi-turn regression. run_release: generate and run the exact-version release baseline plus tests/agentforce/<AgentApiName>.eval.json when present. get_failure: drill into a previous run's failure. trace: fetch a planner trace by (session_id, plan_id). resolve_active: look up Active BotVersion ids for $active_* placeholders. generate_spec: synthesize a starter eval spec from a `.agent` file.",
    },
  ),
  target_org: Type.Optional(Type.String({ description: "sf CLI alias / username." })),
  // run
  spec_path: Type.Optional(
    Type.String({
      description: "For action='run'. Path to a JSON eval spec. Use this OR spec.",
    }),
  ),
  spec: Type.Optional(
    Type.Any({
      description: "For action='run'. Inline spec object. Use this OR spec_path.",
    }),
  ),
  release_spec_path: Type.Optional(
    Type.String({
      description:
        "Optional for action='run_release'. Explicit designated release eval spec; defaults to tests/agentforce/<AgentApiName>.eval.json when present.",
    }),
  ),
  agent_api_name: Type.Optional(
    Type.String({
      description:
        "Required for resolve_active and run_release. For run, resolves and injects missing agent.create_session ids; also required when the spec uses $active_* / $latest_* placeholders.",
    }),
  ),
  version_resolution: Type.Optional(
    Type.Union([Type.Literal("active"), Type.Literal("latest"), Type.Literal("version")], {
      description:
        "Optional for action='run' with agent_api_name. Default 'active' injects the production-serving Active BotVersion. 'latest' uses the newest version and requires acknowledge_inactive_version=true when non-Active. 'version' requires version=N.",
    }),
  ),
  overwrite_agent_ids: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='run' with agent_api_name. When true, overwrite explicit agent_id / agent_version_id fields in agent.create_session steps. Default false.",
    }),
  ),
  traces_mode: Type.Optional(
    Type.Union([Type.Literal("failed"), Type.Literal("all"), Type.Literal("off")], {
      description: "Optional for action='run'. Default 'failed'.",
    }),
  ),
  concurrency: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 32,
      description: "Optional for action='run'. Default 8.",
    }),
  ),
  prompt_chars: Type.Optional(
    Type.Number({
      minimum: 100,
      maximum: 4000,
      description: "Optional for action='run'. Max chars of llmEvents.prompt_content per turn.",
    }),
  ),
  batch_timeout_ms: Type.Optional(
    Type.Number({
      minimum: 1000,
      description:
        "Optional for action='run'. Per Evaluation API batch POST timeout. Default 300000. Client-side timeouts are not retried.",
    }),
  ),
  inline_threshold: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 100,
      description:
        "Optional for action='run'. Inline failure records when total <= threshold; otherwise summarize. Default 5.",
    }),
  ),
  acknowledge_inactive_version: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='run'. Confirms you intend to regression-test a non-Active BotVersion. Required when $latest_* placeholders resolve to an Inactive / InDevelopment version. Catches the 'I thought v12 was active but it's still v11' foot-gun.",
    }),
  ),
  // resolve_active extras; for action='run', also used when version_resolution='version'.
  version: Type.Optional(
    Type.Number({
      minimum: 0,
      description:
        "Optional for action='resolve_active' or action='run' with version_resolution='version'. Pin to a specific BotVersion.VersionNumber (any Status). Use to look up ids for an old or non-Active version, then bake into the spec.",
    }),
  ),
  status: Type.Optional(
    Type.Union([Type.Literal("Active"), Type.Literal("any")], {
      description:
        "Optional for action='resolve_active'. 'Active' (default) returns the latest Active BotVersion; 'any' returns the latest version regardless of state. Ignored when `version` is set.",
    }),
  ),
  // get_failure
  run_id: Type.Optional(
    Type.String({
      description:
        "Required for action='get_failure'. Run id from a previous agentscript_eval run.",
    }),
  ),
  test_id: Type.Optional(
    Type.String({
      description: "Optional for action='get_failure'. Restrict to one failure.",
    }),
  ),
  // trace
  session_id: Type.Optional(Type.String({ description: "Required for action='trace'." })),
  plan_id: Type.Optional(Type.String({ description: "Required for action='trace'." })),
  timeout_ms: Type.Optional(
    Type.Number({ minimum: 1000, description: "Optional for action='trace'. Default 60000." }),
  ),
  // generate_spec
  agent_file: Type.Optional(
    Type.String({
      description:
        "Required for action='generate_spec' and action='run_release'. Path to the `.agent` file used to derive the generated baseline.",
    }),
  ),
  output_path: Type.Optional(
    Type.String({
      description:
        "Optional for action='generate_spec'. When set, write the generated spec to this path (relative paths resolve against cwd). Default: return inline.",
    }),
  ),
  context_variables: Type.Optional(
    Type.Array(
      Type.Object({
        name: Type.String(),
        type: Type.Optional(Type.String()),
        value: Type.Union([Type.String(), Type.Number(), Type.Boolean()]),
      }),
      {
        description:
          "Optional for action='generate_spec'. Default context_variables attached to every generated send_message step (eval-spec shape: [{name, type?, value}]). Use for auth-bypass seeds (verified_check, RoutableId, etc.) so generated tests reach the post-auth flows.",
      },
    ),
  ),
  include_subagent_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include one routing test per non-start subagent. Default true.",
    }),
  ),
  include_action_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include one invocation probe per targeted action and connected agent. Default true.",
    }),
  ),
  include_multi_turn_tests: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include evidence-backed same-session scenarios for provable after_response state and branch behavior. Default true.",
    }),
  ),
  include_guardrail: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include the curated off-topic guardrail probe. Default true.",
    }),
  ),
  include_safety_probes: Type.Optional(
    Type.Boolean({
      description:
        "Optional for action='generate_spec'. Include the curated safety / adversarial probe block. Default true.",
    }),
  ),
  max_functional_tests: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 200,
      description:
        "Optional for action='generate_spec'. Cap the subagent + action + connected-agent test count. Default 25.",
    }),
  ),
});

interface ParamsAny {
  action: "run" | "run_release" | "get_failure" | "trace" | "resolve_active" | "generate_spec";
  target_org?: string;
  spec_path?: string;
  spec?: unknown;
  release_spec_path?: string;
  agent_api_name?: string;
  traces_mode?: "failed" | "all" | "off";
  concurrency?: number;
  prompt_chars?: number;
  batch_timeout_ms?: number;
  inline_threshold?: number;
  acknowledge_inactive_version?: boolean;
  version_resolution?: "active" | "latest" | "version";
  overwrite_agent_ids?: boolean;
  version?: number;
  status?: "Active" | "any";
  run_id?: string;
  test_id?: string;
  session_id?: string;
  plan_id?: string;
  timeout_ms?: number;
  agent_file?: string;
  output_path?: string;
  context_variables?: Array<{
    name: string;
    type?: string;
    value: string | number | boolean;
  }>;
  include_subagent_tests?: boolean;
  include_action_tests?: boolean;
  include_multi_turn_tests?: boolean;
  include_guardrail?: boolean;
  include_safety_probes?: boolean;
  max_functional_tests?: number;
  /** Internal marker set only by run_release. */
  release_contract_kind?: "generated_baseline" | "designated";
}

function checkRequired(p: ParamsAny): { ok: true } | { ok: false; error: string } {
  switch (p.action) {
    case "run":
      return { ok: true };
    case "run_release":
      if (!p.agent_file) return { ok: false, error: "action='run_release' requires agent_file." };
      if (!p.agent_api_name)
        return { ok: false, error: "action='run_release' requires agent_api_name." };
      return { ok: true };
    case "get_failure":
      return { ok: true };
    case "trace":
      if (!p.session_id) return { ok: false, error: "action='trace' requires session_id." };
      if (!p.plan_id) return { ok: false, error: "action='trace' requires plan_id." };
      return { ok: true };
    case "resolve_active":
      if (!p.agent_api_name)
        return { ok: false, error: "action='resolve_active' requires agent_api_name." };
      return { ok: true };
    case "generate_spec":
      if (!p.agent_file) return { ok: false, error: "action='generate_spec' requires agent_file." };
      return { ok: true };
  }
}

// -------------------------------------------------------------------------------------------------
// Registration
// -------------------------------------------------------------------------------------------------

export function registerEvalTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: EVAL_TOOL_NAME,
    label: "Agent Script eval",
    description:
      "Multi-action Agent Script eval surface: run specs, run the exact-version release contract, drill into failures, fetch traces, generate specs, or resolve BotVersion ids.",
    renderCall: renderEvalCall,
    renderResult: (result, opts, theme) => {
      // Dispatch on action recovered from the parameters slot. The pi-tui
      // renderResult signature receives the merged tool row but not the
      // call args directly; we use the embedded `details.action` (which we
      // set in actionRun/actionGetFailure) for routing.
      const details =
        (result as { details?: { action?: string; run_id?: string; failure?: unknown } }).details ??
        {};
      // Run results carry run_id at the top level; failure results carry
      // either a single `failure` or a `failures[]` array.
      if (details.failure || (details as { failures?: unknown[] }).failures) {
        return renderEvalGetFailureResult(result, opts, theme);
      }
      if (details.run_id) {
        return renderEvalRunResult(result, opts, theme);
      }
      // resolve_active / trace fall through to the default text rendering
      // (their single-line summaries already read well).
      return renderEvalRunResult(result, opts, theme);
    },
    promptSnippet:
      "Run / debug / introspect Agent Script regression specs against the Salesforce Evaluation API.",
    promptGuidelines: [
      "Use agentscript_eval action='run_release' after inactive publication to run the generated baseline and the current designated suite against the exact latest BotVersion.",
      "Use EvalSpec seed_profiles for scenarios that need dynamic target-org IDs; query only dedicated test fixtures with bounded read-only SOQL.",
      "Incomplete batches, missing tests, evaluator failures, and step errors are failed evidence; never treat an empty or partial run as green.",
      "Read extensions/sf-agentscript/AGENT_GUIDE.md for spec generation, failure drill-down, and version-resolution guidance.",
    ],
    parameters: Params,
    async execute(_id, params, _signal, onUpdate, ctx) {
      const timings = createTimingCollector();
      const p = params as ParamsAny;
      const reqOk = checkRequired(p);
      if (reqOk.ok === false) {
        return withTimings(toolError("INVALID_PARAMS", reqOk.error), timings, { appendLine: true });
      }
      let result;
      switch (p.action) {
        case "run":
          result = await actionRun(ctx, p, onUpdate, timings, _signal);
          break;
        case "run_release":
          result = await actionRunRelease(ctx, p, onUpdate, timings, _signal);
          break;
        case "get_failure":
          result = await timings.time("eval.get_failure", () => actionGetFailure(ctx, p));
          break;
        case "trace":
          result = await actionTrace(p, timings, _signal);
          break;
        case "resolve_active":
          result = await timings.time("eval.resolve_active", () => actionResolveActive(p, _signal));
          break;
        case "generate_spec":
          result = await timings.time("eval.generate_spec", () => actionGenerateSpec(ctx, p));
          break;
      }
      return withTimings(result, timings, { appendLine: true });
    },
  });
}

// -------------------------------------------------------------------------------------------------
// action = run
// -------------------------------------------------------------------------------------------------

type OnUpdateFn = (partial: { content: { type: "text"; text: string }[]; details: never }) => void;
type InternalRunParams = ParamsAny & {
  release_version?: number;
  source_spec?: EvalSpec;
  prepared_spec?: EvalSpec;
  coordinator_token?: string;
};

export async function actionRunRelease(
  ctx: ExtensionContext,
  input: InternalRunParams,
  onUpdate?: OnUpdateFn,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const agentApiName = input.agent_api_name as string;
  const projectRoot = evalProjectRoot(ctx.cwd);
  const designatedPath = input.release_spec_path
    ? path.resolve(projectRoot, input.release_spec_path)
    : defaultReleaseSpecPath(projectRoot, agentApiName);
  let designatedSource: EvalSpec | undefined;
  try {
    designatedSource = JSON.parse(await readFile(designatedPath, "utf8")) as EvalSpec;
  } catch (error) {
    const missing = (error as { code?: string }).code === "ENOENT";
    if (input.release_spec_path || !missing) {
      return toolError(
        missing
          ? `Designated release spec not found: ${designatedPath}`
          : `Failed to read designated release spec: ${
              error instanceof Error ? error.message : String(error)
            }`,
      );
    }
  }

  const safeName = agentApiName.replace(/[^A-Za-z0-9._-]/g, "_");
  const baselinePath = path.join(
    projectRoot,
    ".pi",
    "state",
    "sf-agentscript",
    "release-contracts",
    `${safeName}.generated.eval.json`,
  );
  const generated = await actionGenerateSpec(ctx, {
    ...input,
    action: "generate_spec",
    output_path: baselinePath,
  });
  if ((generated.details as { ok?: boolean }).ok !== true) return generated;
  const generatedSource = JSON.parse(await readFile(baselinePath, "utf8")) as EvalSpec;
  const baselineSource = designatedSource
    ? applyGeneratedBaselineSeedConfig(generatedSource, designatedSource)
    : generatedSource;
  if (designatedSource?.generated_baseline) {
    await writeFile(baselinePath, `${JSON.stringify(baselineSource, null, 2)}\n`, "utf8");
  }

  const conn = await connFromAlias(input.target_org);
  const exactVersion = await resolveAgentIds(conn, agentApiName, {
    ...(typeof input.release_version === "number"
      ? { version: input.release_version }
      : { status: "any" as const }),
    signal,
  });
  if (exactVersion.status === "Active") {
    return toolError(
      `No pending non-Active BotVersion exists for '${agentApiName}'.`,
      "Publish an inactive version before running the release contract.",
    );
  }
  const common: InternalRunParams = {
    ...input,
    action: "run",
    agent_api_name: agentApiName,
    version_resolution: "version",
    version: exactVersion.version_number,
    acknowledge_inactive_version: true,
    overwrite_agent_ids: true,
  };
  const baseline = await actionRun(
    ctx,
    {
      ...common,
      spec_path: baselinePath,
      spec: undefined,
      release_contract_kind: "generated_baseline",
      source_spec: baselineSource,
      prepared_spec: pinReleaseSpec(baselineSource, exactVersion),
    },
    onUpdate,
    timings,
    signal,
  );
  if ((baseline.details as { ok?: boolean }).ok !== true) {
    return prependResult(baseline, "❌ generated release baseline failed");
  }

  if (!designatedSource) {
    return prependResult(baseline, "✅ Agent Script release contract passed (generated baseline)");
  }

  const designated = await actionRun(
    ctx,
    {
      ...common,
      spec_path: designatedPath,
      spec: undefined,
      release_contract_kind: "designated",
      source_spec: designatedSource,
      prepared_spec: pinReleaseSpec(designatedSource, exactVersion),
    },
    onUpdate,
    timings,
    signal,
  );
  return prependResult(
    designated,
    (designated.details as { ok?: boolean }).ok === true
      ? "✅ Agent Script release contract passed (generated baseline + designated suite)"
      : "❌ designated Agent Script release suite failed after the generated baseline passed",
  );
}

function pinReleaseSpec(spec: EvalSpec, exactVersion: ResolvedAgentIds): EvalSpec {
  return substitutePlaceholders(spec, {
    active: exactVersion,
    latest: exactVersion,
  });
}

function prependResult<T extends { content: { type: "text"; text: string }[] }>(
  result: T,
  heading: string,
): T {
  return {
    ...result,
    content: result.content.map((item, index) =>
      index === 0 ? { ...item, text: `${heading}\n\n${item.text}` } : item,
    ),
  };
}

async function actionRun(
  ctx: ExtensionContext,
  input: InternalRunParams,
  onUpdate?: OnUpdateFn,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const log = (msg: string): void => {
    try {
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: { progress: msg } as never,
      });
    } catch {
      /* best-effort */
    }
  };

  if (!input.spec_path && !input.spec) {
    const inferred = latestEvalSpec(ctx);
    if (inferred) input = { ...input, spec_path: inferred.spec_path };
  }
  const sourceSpec = input.source_spec
    ? input.source_spec
    : timings
      ? await timings.time("load_eval_spec", () => loadSpec(input, ctx.cwd))
      : await loadSpec(input, ctx.cwd);
  if (!sourceSpec) {
    return toolError(
      "Either spec_path or spec must be provided.",
      "Pass spec_path: '<file.json>' or first generate a spec with agentscript_eval action='generate_spec'.",
    );
  }

  const spec = input.prepared_spec
    ? (input.prepared_spec as EvalSpec)
    : input.release_contract_kind
      ? rewriteReleaseSpecForLatest(sourceSpec)
      : sourceSpec;
  const releaseContract = input.release_contract_kind
    ? {
        kind: input.release_contract_kind,
        baseline_id: AGENT_SCRIPT_RELEASE_BASELINE_ID,
        spec_digest: hashEvalSpec(sourceSpec),
        ...(input.spec_path ? { spec_path: path.resolve(ctx.cwd, input.spec_path) } : {}),
      }
    : undefined;

  let result: RunEvalResult;
  try {
    const conn = timings
      ? await timings.time("org_connection", () => connFromAlias(input.target_org))
      : await connFromAlias(input.target_org);
    let traceConn;
    const settings = readEffectiveAgentScriptSettings(ctx.cwd);
    const tracesMode = input.traces_mode ?? settings.evalTracesMode;
    if (tracesMode !== "off") {
      try {
        const authPhase = timings?.phase("agent_api_auth");
        const auth = await connForAgentApi(input.target_org, { signal });
        authPhase?.end({ cache: auth.cache });
        traceConn = auth.conn;
      } catch {
        // Trace fetches are a debugging aid and already non-fatal; run eval even
        // when the named-user JWT bootstrap is unavailable.
      }
    }
    result = await runEval({
      conn,
      traceConn,
      targetOrg: input.target_org ?? conn.getUsername() ?? "<default>",
      spec,
      sourceSpec,
      agentApiName: input.agent_api_name,
      tracesMode,
      concurrency: input.concurrency ?? settings.evalConcurrency,
      promptChars: input.prompt_chars ?? 600,
      batchTimeoutMs: input.batch_timeout_ms,
      acknowledgeInactiveVersion: input.acknowledge_inactive_version,
      versionResolution: input.version_resolution,
      version: input.version,
      overwriteAgentIds: input.overwrite_agent_ids,
      releaseContract,
      coordinator: input.coordinator_token
        ? { kind: "studio", owner_token: input.coordinator_token }
        : undefined,
      cwd: ctx.cwd,
      specPath: input.spec_path,
      log,
      timings,
      signal,
    });
  } catch (err) {
    return classifyRunError(err, input);
  }

  await (timings
    ? timings.time("record_eval_run_index", () => recordRunInIndex(ctx.cwd, result.run_id))
    : recordRunInIndex(ctx.cwd, result.run_id));
  if (input.release_contract_kind) {
    try {
      await recordReleaseEvidence(ctx.cwd, result.run_id);
    } catch (error) {
      log(
        `Release-evidence index update deferred; activation can rebuild it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const inlineThreshold = input.inline_threshold ?? 5;
  const passed = result.metadata.evidence_verdict === "passed";
  const head = headline(result, passed);

  const summary = {
    run_id: result.run_id,
    run_dir: result.run_dir,
    ok: passed,
    execution_state: result.metadata.execution_state,
    evidence_verdict: result.metadata.evidence_verdict,
    totals: result.metadata.totals,
    latency: result.latency,
    failed_batches: result.failed_batches,
    returned_tests: result.metadata.returned_tests_count,
    expected_tests: result.metadata.tests_count,
    missing_test_ids: result.metadata.missing_test_ids,
    ...(result.batch_failures.length > 0
      ? {
          batch_failures: result.batch_failures.slice(0, 3).map((failure) => ({
            batch_index: failure.batch_index,
            status: failure.status,
            test_ids: failure.test_ids,
            body_preview: JSON.stringify(failure.body).slice(0, 1200),
          })),
        }
      : {}),
  };

  const failureCount = result.failures.length;
  const inline = failureCount <= inlineThreshold;
  const failuresPayload = inline ? result.failures : result.failures.slice(0, 3);

  const text =
    head +
    "\n\n" +
    JSON.stringify(
      {
        ...summary,
        failures: failuresPayload,
        ...(inline
          ? {}
          : {
              failures_truncated: true,
              total_failures: failureCount,
              hint: `Showing 3/${failureCount}. Use agentscript_eval action='get_failure' run_id='${result.run_id}' test_id='<id>' to drill in.`,
            }),
      },
      null,
      2,
    );

  return {
    content: [{ type: "text", text }],
    details: withAgentScriptBranchState(
      {
        ok: passed,
        run_id: result.run_id,
        run_dir: result.run_dir,
        execution_state: result.metadata.execution_state,
        evidence_verdict: result.metadata.evidence_verdict,
        totals: result.metadata.totals,
        latency: result.latency,
        failed_test_ids: result.failures.map((f) => f.test_id),
      },
      evalRunEvents({
        runId: result.run_id,
        runDir: result.run_dir,
        ok: passed,
        failedTestIds: result.failures.map((f) => f.test_id),
        metadata: result.metadata,
      }),
    ),
  };
}

function classifyRunError(
  err: unknown,
  input: ParamsAny,
): { content: { type: "text"; text: string }[]; details: ToolError } {
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof EvalRunCancelledError) {
    return toolError(
      "Eval run cancelled.",
      "The partial run status is available on disk when persistence was enabled.",
    );
  }
  // If the error is "spec uses $active_* / $latest_* but no agent_api_name",
  // point the LLM at resolve_active so it can bake values directly.
  if ((msg.includes("$active_") || msg.includes("$latest_")) && !input.agent_api_name) {
    return toolError(msg, "Pass agent_api_name to resolve placeholders.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: "<name>" },
    });
  }
  // If $latest_* resolved to a non-Active version and the user didn't
  // acknowledge, surface the explicit recover_via with the flag set.
  if (msg.includes("acknowledge_inactive_version")) {
    return toolError(msg, "Pass acknowledge_inactive_version=true to confirm.", {
      tool: EVAL_TOOL_NAME,
      params: {
        action: "run",
        spec_path: input.spec_path ?? "<path>",
        agent_api_name: input.agent_api_name ?? "<name>",
        acknowledge_inactive_version: true,
      },
    });
  }
  // If the error mentions an Agent not found, suggest resolve_active to discover it.
  if (/Agent .* not found/i.test(msg)) {
    return toolError(msg, "Verify the DeveloperName.", {
      tool: EVAL_TOOL_NAME,
      params: { action: "resolve_active", agent_api_name: input.agent_api_name ?? "<name>" },
    });
  }
  return toolError(msg);
}

function evalRunEvents(input: {
  runId: string;
  runDir: string;
  ok: boolean;
  failedTestIds: string[];
  metadata: RunMetadata;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "eval_run",
      run_id: input.runId,
      run_dir: input.runDir,
      ok: input.ok,
      failed_test_ids: input.failedTestIds,
      org_id: input.metadata.org_id,
      agent_api_name: input.metadata.agent_api_name,
      bot_version_id: input.metadata.bot_version_id,
      release_contract_kind: input.metadata.release_contract?.kind,
      release_spec_digest: input.metadata.release_contract?.spec_digest,
      source: "eval.run",
    },
  ];
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

function headline(result: RunEvalResult, passed: boolean): string {
  const t = result.metadata.totals;
  const lat = result.latency;
  const latPart = lat.count > 0 ? `  |  latency p50=${lat.p50_ms}ms p95=${lat.p95_ms}ms` : "";
  const marker = passed ? "✅" : "❌";
  return (
    `${marker} eval run ${result.run_id}\n` +
    `Tests: ${t.test_pass}/${t.tests} passed  |  ` +
    `Evaluators: ${t.ev_pass}/${t.evals} passed  |  ` +
    `Step errors: ${t.errors}${latPart}` +
    (result.failed_batches > 0
      ? `\n⚠ ${result.failed_batches} batch(es) returned non-200 (some tests may be missing)`
      : "")
  );
}

async function loadSpec(input: ParamsAny, cwd: string): Promise<EvalSpec | null> {
  if (input.spec_path) {
    const path = await import("node:path");
    const abs = path.isAbsolute(input.spec_path)
      ? input.spec_path
      : path.resolve(cwd, input.spec_path);
    const raw = await readFile(abs, "utf-8");
    return JSON.parse(raw) as EvalSpec;
  }
  if (input.spec && typeof input.spec === "object") {
    return input.spec as EvalSpec;
  }
  return null;
}

// -------------------------------------------------------------------------------------------------
// action = get_failure
// -------------------------------------------------------------------------------------------------

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

async function actionGetFailure(
  ctx: ExtensionContext,
  input: ParamsAny,
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

async function actionTrace(
  input: ParamsAny,
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

// -------------------------------------------------------------------------------------------------
// action = resolve_active
// -------------------------------------------------------------------------------------------------

async function actionResolveActive(
  input: ParamsAny,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  try {
    const conn = await connFromAlias(input.target_org);
    // Pin a specific version (any state) when `version` is provided.
    // Otherwise honor the `status` filter (default Active).
    const status: StatusFilter = input.status ?? "Active";
    const ids =
      typeof input.version === "number"
        ? await resolveAgentIds(conn, input.agent_api_name, { version: input.version, signal })
        : status === "Active"
          ? await resolveAgentIds(conn, input.agent_api_name, { status: "Active", signal })
          : await resolveAgentIds(conn, input.agent_api_name, { status: "any", signal });

    // The placeholder-shaped fields ($active_* / $latest_*) reflect the
    // resolution mode so an LLM consumer can copy-paste the right token
    // into a spec without remembering which family applies. When `version`
    // is pinned, neither placeholder family applies cleanly — we surface
    // both shapes so the LLM picks the right one for its workflow.
    const placeholderShapes: Record<string, string | null> = {};
    if (typeof input.version === "number" || status === "any") {
      placeholderShapes.$latest_bot_version_id = ids.bot_version_id;
      placeholderShapes.$latest_planner_id = ids.planner_id;
    }
    if (typeof input.version !== "number" && status === "Active") {
      placeholderShapes.$active_bot_version_id = ids.bot_version_id;
      placeholderShapes.$active_planner_id = ids.planner_id;
    }
    placeholderShapes.$active_bot_id = ids.bot_id;

    return toolOk({
      ok: true as const,
      agent_api_name: input.agent_api_name,
      target_org: input.target_org ?? conn.getUsername() ?? "<default>",
      resolution_mode: typeof input.version === "number" ? `version=${input.version}` : status,
      bot_id: ids.bot_id,
      bot_version_id: ids.bot_version_id,
      version_number: ids.version_number,
      bot_version_status: ids.status,
      planner_id: ids.planner_id,
      ...placeholderShapes,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = generate_spec
//
// Read a `.agent` file via the existing inspect machinery, derive a starter
// regression spec covering subagent routing + action/connected-agent probes + safety/guardrail
// rows, optionally write it to disk. The output spec uses `$active_*`
// placeholders so it runs against whichever BotVersion is Active at run time.
// -------------------------------------------------------------------------------------------------

async function actionGenerateSpec(
  ctx: ExtensionContext,
  input: ParamsAny,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // Resolve + validate the .agent path before doing any work.
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const agentFile = resolved.absPath;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }

  // Inspect locally; refuse if the file has parse errors (the structural
  // surface is incomplete and would emit nonsense).
  const inspect = await inspectFile(agentFile);
  if (!inspect.ok) {
    return toolError(
      `inspect failed: ${inspect.reason ?? "unknown"}${inspect.reason_detail ? ` — ${inspect.reason_detail}` : ""}`,
      "Run agentscript_authoring compile/check to see and fix the underlying issue.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: agentFile },
      },
    );
  }
  if (inspect.has_parse_errors) {
    return toolError(
      `Agent has ${inspect.parse_error_count} severity-1 parse error(s). The structural surface is incomplete; refusing to generate a spec from it.`,
      "Fix the parse errors first via agentscript_authoring compile/check and mutate/apply_quick_fix.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: agentFile },
      },
    );
  }

  let result;
  try {
    result = generateSpec({
      inspect,
      contextVariables: input.context_variables,
      includeSubagentTests: input.include_subagent_tests,
      includeActionTests: input.include_action_tests,
      includeMultiTurnTests: input.include_multi_turn_tests,
      includeGuardrail: input.include_guardrail,
      includeSafetyProbes: input.include_safety_probes,
      maxFunctionalTests: input.max_functional_tests,
    });
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }

  // Persist when output_path is set. Resolve relative to cwd; create parents.
  let writtenPath: string | undefined;
  if (input.output_path) {
    const abs = path.isAbsolute(input.output_path)
      ? input.output_path
      : path.resolve(ctx.cwd, input.output_path);
    try {
      await withFileMutationQueue(abs, async () => {
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, JSON.stringify(result.spec, null, 2) + "\n", "utf-8");
      });
      writtenPath = abs;
    } catch (err) {
      return toolError(
        `Failed to write generated spec to ${abs}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const summary = result.summary;
  const totals =
    `${summary.total_tests} test(s): ${summary.subagent_tests} subagent, ` +
    `${summary.action_tests} action, ${summary.connected_agent_tests} connected, ` +
    `${summary.multi_turn_tests} multi-turn, ${summary.guardrail_tests} guardrail, ` +
    `${summary.safety_tests} safety`;
  const head = `✨ spec generated for ${path.basename(agentFile)}\n${totals}${writtenPath ? `\nWritten: ${writtenPath}` : ""}`;

  // Hand back the next-step hint so the LLM chains directly into a run.
  // We don't execute it here so the user can edit the spec first if they
  // want to refine wording or add multi-turn scenarios.
  const nextStep = writtenPath
    ? `\n\n→ Next: agentscript_eval action='run' spec_path='${writtenPath}'`
    : "";

  return {
    content: [
      {
        type: "text",
        text: head + nextStep + "\n\n" + JSON.stringify({ summary, spec: result.spec }, null, 2),
      },
    ],
    details: withAgentScriptBranchState(
      {
        ok: true,
        agent_file: agentFile,
        output_path: writtenPath,
        summary,
      },
      [
        agentFileEvent(agentFile, "eval.generate_spec"),
        ...(writtenPath
          ? [
              {
                schema_version: 1 as const,
                kind: "eval_spec" as const,
                spec_path: writtenPath,
                agent_file: agentFile,
                source: "eval.generate_spec",
              },
            ]
          : []),
      ],
    ),
  };
}
