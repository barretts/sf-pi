/* SPDX-License-Identifier: Apache-2.0 */
/** Preview session actions: start, send, and end. */
import path from "node:path";
import { readFile } from "node:fs/promises";
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { getAgentScriptAnalysis } from "../../analysis-snapshot.ts";
import {
  resolveActivePreviewSession,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import {
  previewReportPath,
  reportHeader,
  writeMarkdownReport,
} from "../../render/report-writer.ts";
import { previewSendMarkdown } from "../../render/timeline.ts";
import type { ConversationReplayScenario } from "../../render/conversation.ts";
import { readEffectiveAgentScriptSettings } from "../../settings.ts";
import type { TimingCollector } from "../../timings.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import {
  endPreview,
  loadSession,
  sendMessage,
  startPreview,
  startPreviewByApiName,
} from "../client.ts";
import {
  getSessionDir,
  readTurnIndex,
  resolveSessionArtifactPath,
  type PreviewMetadata,
} from "../session-store.ts";
import { summarizeTrace } from "../trace-digest.ts";

export interface PreviewContextVariable {
  name: string;
  type?: string;
  value: string | number | boolean;
  label?: string;
  description?: string;
  isList?: boolean;
}

export interface StartPreviewActionInput {
  target_org?: string;
  agent_file?: string;
  agent_api_name?: string;
  agent_name?: string;
  mock_mode?: "Mock" | "Live Test";
  version_developer_name?: string;
  context_variables?: PreviewContextVariable[];
}

export interface SendPreviewActionInput {
  target_org?: string;
  agent_name?: string;
  session_id?: string;
  message?: string;
  apex_debug?: boolean;
  context_variables?: PreviewContextVariable[];
}

export interface EndPreviewActionInput {
  target_org?: string;
  agent_name?: string;
  session_id?: string;
}

export type PreviewOnUpdateFn = (partial: {
  content: { type: "text"; text: string }[];
  details: never;
}) => void;

export async function actionStart(
  ctx: ExtensionContext,
  input: StartPreviewActionInput,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  // Validate exclusivity — exactly one of agent_file / agent_api_name.
  if (input.agent_file && input.agent_api_name) {
    return toolError(
      "Pass agent_file OR agent_api_name, not both.",
      "agent_file = preview a local `.agent` (compiles + uploads). agent_api_name = converse with an already-published agent.",
    );
  }
  if (!input.agent_file && !input.agent_api_name) {
    return toolError(
      "Pass agent_file or agent_api_name.",
      "agent_file = local `.agent` path. agent_api_name = an already-published agent's DeveloperName.",
    );
  }

  // Path A — published agent (no local file, no compile).
  if (input.agent_api_name) {
    if (input.context_variables && input.context_variables.length > 0) {
      return toolError(
        "context_variables on preview start are only supported with agent_file.",
        "Published-agent preview uses the production v1 session API and has no compiled AgentJSON payload to patch. Start from the local .agent file when testing linked VoiceCall/MessagingSession variables.",
      );
    }
    if (input.version_developer_name) {
      return toolError(
        "version_developer_name on preview start is only supported with agent_file.",
        "Published-agent preview resolves the active published version from the org. Use agent_file when you need to pin a local Agent Script preview to v0/vN.",
      );
    }
    const agentName = input.agent_name ?? input.agent_api_name;
    try {
      const authPhase = timings?.phase("agent_api_auth");
      const auth = await connForAgentApi(input.target_org, { signal });
      authPhase?.end({ cache: auth.cache });
      const { conn } = auth;
      const result = await startPreviewByApiName({
        conn,
        cwd: ctx.cwd,
        agentApiName: input.agent_api_name,
        targetOrg: input.target_org,
        timings,
        signal,
      });
      return toolOk(
        withAgentScriptBranchState(
          {
            ok: true as const,
            session_id: result.sessionId,
            agent_response: result.agentResponse,
            started_at: result.startedAt,
            session_dir: result.sessionDir,
            agent_name: agentName,
            via: "api_name" as const,
            digest: result.digest,
          },
          previewSessionEvents({
            agentName,
            sessionId: result.sessionId,
            sessionDir: result.sessionDir,
            targetOrg: input.target_org,
            sessionKind: "api_name",
            status: "active",
            source: "preview.start",
          }),
        ),
        [
          `🎬 Preview started against published ${input.agent_api_name}`,
          `session_id: ${result.sessionId}`,
          result.digest?.summary_line ? `→ ${result.digest.summary_line}` : null,
          result.agentResponse,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/not found in the org/i.test(msg)) {
        return toolError(msg, undefined, {
          tool: "agentscript_lifecycle",
          params: { action: "list_versions", agent_api_name: input.agent_api_name },
        });
      }
      return toolError(msg);
    }
  }

  // Path B — local .agent file.
  const resolved = safeResolveToolPath(input.agent_file, ctx.cwd);
  if ("absPath" in resolved === false) return resolved;
  const filePath = resolved.absPath;
  if (!isAgentScriptFile(filePath)) {
    return toolError(`Not an Agent Script file: ${filePath}`, "Pass a path ending in `.agent`.");
  }
  let analysis;
  try {
    analysis = timings
      ? await timings.time("load_analysis_snapshot", () => getAgentScriptAnalysis(filePath))
      : await getAgentScriptAnalysis(filePath);
  } catch (err) {
    return toolError(
      `Cannot read ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const source = analysis.source;
  const agentName = input.agent_name ?? path.basename(filePath, ".agent");

  const localCheck = timings
    ? await timings.time("local_compile", () => analysis.getCompile())
    : await analysis.getCompile();
  if (!localCheck.ok) {
    return toolError(
      localCheck.unavailableReason ?? "Local Agent Script compile failed before preview.",
      "Run agentscript_authoring compile/check to see the full diagnostic details.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }
  const blocking = localCheck.diagnostics.filter((d) => d.severity === 1);
  if (blocking.length > 0) {
    return toolError(
      `Local diagnostics rejected preview (${blocking.length} severity-1 issue${blocking.length === 1 ? "" : "s"}).`,
      "Run agentscript_authoring compile/check to see and fix the diagnostics before starting preview.",
      {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      },
    );
  }
  const featureProfile = await analysis.getFeatureProfile();

  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(input.target_org, { signal });
    authPhase?.end({ cache: auth.cache });
    const { conn } = auth;
    const result = await startPreview({
      conn,
      cwd: ctx.cwd,
      agentName,
      agentSource: source,
      agentFilePath: filePath,
      versionDeveloperName: input.version_developer_name,
      mockMode: input.mock_mode ?? readEffectiveAgentScriptSettings(ctx.cwd).previewMockMode,
      targetOrg: input.target_org,
      contextVariables: input.context_variables,
      timings,
      signal,
      skipLocalValidation: true,
      publishFeatureRisks: featureProfile?.publish_risks,
      // (agentFilePath above is also persisted to metadata.json by
      //  startPreview — used by `end` to suggest the next publish command.)
    });
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          session_id: result.sessionId,
          agent_response: result.agentResponse,
          started_at: result.startedAt,
          session_dir: result.sessionDir,
          agent_name: agentName,
          via: "agent_file" as const,
          context_patch: result.contextPatch,
          version_resolution: result.versionResolution,
          warnings: result.warnings,
        },
        previewSessionEvents({
          agentName,
          sessionId: result.sessionId,
          sessionDir: result.sessionDir,
          targetOrg: input.target_org,
          sessionKind: "agent_file",
          status: "active",
          source: "preview.start",
        }),
      ),
      [
        `🎬 Preview started`,
        `session_id: ${result.sessionId}`,
        result.versionResolution
          ? `agent_version: ${result.versionResolution.developerName} (${result.versionResolution.source})`
          : null,
        result.contextPatch && result.contextPatch.variables.length > 0
          ? `context_variables: ${result.contextPatch.variables.length} seeded · ${result.contextPatch.registeredStateVariables} state slot(s) · ${result.contextPatch.rewrittenBindings} binding rewrite(s)`
          : null,
        ...(result.warnings ?? []).map((w) => `⚠ ${w}`),
        result.agentResponse,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("Local compile rejected")) {
      return toolError(msg, undefined, {
        tool: "agentscript_authoring",
        params: { verb: "compile", mode: "check", agent_file: filePath },
      });
    }
    return toolError(msg);
  }
}

// -------------------------------------------------------------------------------------------------
// action = send
// -------------------------------------------------------------------------------------------------

export async function actionSend(
  ctx: ExtensionContext,
  input: SendPreviewActionInput,
  onUpdate?: PreviewOnUpdateFn,
  timings?: TimingCollector,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const stream = (msg: string): void => {
    try {
      onUpdate?.({
        content: [{ type: "text", text: msg }],
        details: { progress: msg } as never,
      });
    } catch {
      /* best-effort */
    }
  };
  stream("Sending message…");

  const resolvedSession = timings
    ? await timings.time("resolve_preview_session", () =>
        resolveActivePreviewSession(ctx, input.agent_name, input.session_id),
      )
    : await resolveActivePreviewSession(ctx, input.agent_name, input.session_id);
  if ("agentName" in resolvedSession === false) return resolvedSession;
  input = {
    ...input,
    agent_name: resolvedSession.agentName,
    session_id: resolvedSession.sessionId,
    target_org: input.target_org ?? resolvedSession.targetOrg,
  };

  // Resolve the target_org from session metadata when the caller didn't
  // pass one (or refuse if it conflicts with what start was called with).
  // Prevents the silent "send hits the wrong org → Session not found" bug.
  const orgResolution = timings
    ? await timings.time("resolve_session_org", () =>
        resolveSessionTargetOrg(ctx.cwd, input.agent_name, input.session_id, input.target_org),
      )
    : await resolveSessionTargetOrg(ctx.cwd, input.agent_name, input.session_id, input.target_org);
  if (orgResolution.kind === "conflict") return toolError(orgResolution.message);

  try {
    const authPhase = timings?.phase("agent_api_auth");
    const auth = await connForAgentApi(orgResolution.targetOrg, { signal });
    authPhase?.end({ cache: auth.cache });
    const { conn } = auth;
    const result = await sendMessage({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      message: input.message,
      apexDebug: input.apex_debug,
      contextVariables: input.context_variables,
      timings,
      signal,
    });
    stream("Trace captured");

    // Best-effort: write a Markdown report alongside the trace JSON so the
    // user can re-open the rendered timeline later. Failure here never
    // breaks the tool result.
    let reportFile: string | undefined;
    try {
      if (result.digest && result.traceFile) {
        const sessionDir = path.dirname(path.dirname(result.traceFile));
        // <session>/traces/<plan_id>.json -> session dir is parent.parent
        const md =
          reportHeader({
            kind: "preview",
            title: `Preview turn ${result.planId.slice(0, 8)}…`,
            meta: {
              agent_name: input.agent_name,
              session_id: input.session_id,
              plan_id: result.planId,
              latency_ms: result.latencyMs,
            },
          }) +
          previewSendMarkdown(result.digest, {
            ok: true,
            agent_response: result.agentResponse,
            topic: result.topic,
            latency_ms: result.latencyMs,
            plan_id: result.planId,
            trace_file: result.traceFile,
          });
        const written = timings
          ? await timings.time("write_preview_report", () =>
              writeMarkdownReport(previewReportPath(sessionDir, result.planId), md),
            )
          : await writeMarkdownReport(previewReportPath(sessionDir, result.planId), md);
        reportFile = written.path;
      }
    } catch {
      // Best-effort — swallow and continue.
    }

    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          agent_response: result.agentResponse,
          topic: result.topic,
          invoked_actions: result.invokedActions,
          latency_ms: result.latencyMs,
          plan_id: result.planId,
          trace_file: result.traceFile,
          report_file: reportFile,
          digest: result.digest,
          trace_mode: result.traceFile ? "full_v1_1" : "surface_only_production_v1",
          ...(result.digest?.state_variables
            ? { state_variables: result.digest.state_variables }
            : {}),
          ...(result.apexDebugLog ? { apex_debug_log: result.apexDebugLog } : {}),
        },
        previewTurnEvents({
          agentName: input.agent_name,
          sessionId: input.session_id,
          planId: result.planId,
          traceFile: result.traceFile,
          reportFile,
          source: "preview.send",
        }),
      ),
      [
        `🤖 ${result.agentResponse}`,
        result.digest?.summary_line ? `→ ${result.digest.summary_line}` : null,
        result.digest?.variable_changes?.length
          ? `state_changes=${result.digest.variable_changes.length}`
          : null,
        result.digest?.tool_activity?.called?.length
          ? `actions_called=${result.digest.tool_activity.called.length}`
          : null,
        result.digest && result.digest.errors.length > 0
          ? `⚠️ errors=${result.digest.errors.length}`
          : null,
        result.traceFile
          ? `plan=${result.planId.slice(0, 8)}… trace=full_v1_1`
          : `plan=${result.planId.slice(0, 8)}… trace=surface_only (use agent_file preview for full v1.1 traces)`,
        reportFile ? "human_report=written" : null,
        "Use details.digest for compact structured trace; use agentscript_preview trace for full raw trace.",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

// -------------------------------------------------------------------------------------------------
// action = end
// -------------------------------------------------------------------------------------------------

export async function actionEnd(
  ctx: ExtensionContext,
  input: EndPreviewActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolvedSession = await resolveActivePreviewSession(
    ctx,
    input.agent_name,
    input.session_id,
  );
  if ("agentName" in resolvedSession === false) return resolvedSession;
  input = {
    ...input,
    agent_name: resolvedSession.agentName,
    session_id: resolvedSession.sessionId,
    target_org: input.target_org ?? resolvedSession.targetOrg,
  };

  // Same target_org resolution as actionSend.
  const orgResolution = await resolveSessionTargetOrg(
    ctx.cwd,
    input.agent_name,
    input.session_id,
    input.target_org,
  );
  if (orgResolution.kind === "conflict") return toolError(orgResolution.message);

  try {
    let conn;
    try {
      ({ conn } = await connForAgentApi(orgResolution.targetOrg));
    } catch {
      // Local metadata end should still work if remote auth/bootstrap is unavailable.
    }
    const result = await endPreview({
      conn,
      cwd: ctx.cwd,
      agentName: input.agent_name,
      sessionId: input.session_id,
      signal,
    });
    const conversation = await buildPreviewConversation(
      ctx.cwd,
      input.agent_name,
      input.session_id,
    );
    // Suggest the obvious next lifecycle step. We only nudge for sessions
    // that have an agent_file on disk — api_name sessions are already
    // running against a published agent.
    const nextStepHint =
      result.metadata.sessionKind === "agent_file" && result.metadata.agentFilePath
        ? `

→ Ready to publish inactive? agentscript_lifecycle action='publish' agent_file='${result.metadata.agentFilePath}'${
            result.metadata.targetOrg ? ` target_org='${result.metadata.targetOrg}'` : ""
          }
→ Then run the exact-version release contract: agentscript_eval action='run_release' agent_file='${result.metadata.agentFilePath}' agent_api_name='${result.metadata.agentName}'${
            result.metadata.targetOrg ? ` target_org='${result.metadata.targetOrg}'` : ""
          }`
        : "";
    return toolOk(
      withAgentScriptBranchState(
        {
          ok: true as const,
          ended_at: result.endedAt,
          summary: result.summary,
          metadata: result.metadata,
          remote_ended: result.remoteEnded,
          remote_end_error: result.remoteEndError,
          preview_end: true,
          agent_name: input.agent_name,
          session_id: input.session_id,
          conversation: conversation.scenarios,
          conversation_summary: conversation.summary,
        },
        previewSessionEvents({
          agentName: input.agent_name,
          sessionId: input.session_id,
          sessionDir: result.metadata
            ? path.join(ctx.cwd, ".sfdx", "agents", input.agent_name, "sessions", input.session_id)
            : "",
          targetOrg: result.metadata?.targetOrg,
          sessionKind: result.metadata?.sessionKind,
          status: "ended",
          source: "preview.end",
        }),
      ),
      [
        `🏁 session ${input.session_id.slice(0, 8)}… ended (${result.summary.turns} turns, ${result.summary.plans} plans)`,
        result.remoteEnded === false ? `⚠️ ${result.remoteEndError}` : null,
      ]
        .filter(Boolean)
        .join("\n") + nextStepHint,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

async function buildPreviewConversation(
  cwd: string,
  agentName: string,
  sessionId: string,
): Promise<{
  scenarios: ConversationReplayScenario[];
  summary: { turns: number; plans: number; passed: number; warnings: number; unavailable: number };
}> {
  const sessionDir = getSessionDir(cwd, agentName, sessionId);
  const index = await readTurnIndex(sessionDir);
  const turns = [];
  for (const entry of index?.turns ?? []) {
    let pathLabels: string[] = [];
    let integrity: "pass" | "warning" | "unavailable" = "unavailable";
    let llmCalls = 0;
    let nonEmpty = 0;
    let digestLatency: number | undefined = entry.latencyMs;
    let integrityMessage: string | undefined;
    const tracePath = resolveSessionArtifactPath(sessionDir, entry.traceFile ?? undefined);
    if (tracePath) {
      try {
        const trace = JSON.parse(await readFile(tracePath, "utf8")) as unknown;
        const digest = summarizeTrace(trace, {
          userInput: entry.userText,
          agentResponse: entry.agentText,
          planId: entry.planId ?? undefined,
          traceFile: tracePath,
        });
        pathLabels = previewPath(digest);
        integrity = digest.response_sequence?.integrity.status ?? "unavailable";
        llmCalls = digest.response_sequence?.llm_call_count ?? 0;
        nonEmpty = digest.response_sequence?.non_empty_content_count ?? 0;
        digestLatency = digest.turn.latency_ms;
        integrityMessage = digest.response_sequence?.integrity.message;
      } catch {
        // Transcript remains useful even when an individual trace file is unreadable.
      }
    }
    turns.push({
      turn: entry.turn,
      user: entry.userText,
      agent: entry.agentText,
      path: pathLabels,
      latency_ms: digestLatency,
      integrity,
      llm_call_count: llmCalls,
      non_empty_content_count: nonEmpty,
      ...(integrityMessage ? { integrity_message: integrityMessage } : {}),
    });
  }
  const warnings = turns.filter((turn) => turn.integrity === "warning").length;
  const unavailable = turns.filter((turn) => turn.integrity === "unavailable").length;
  return {
    scenarios: [
      {
        test_id: `${agentName} · ${sessionId.slice(0, 8)}…`,
        verdict: warnings > 0 ? "failed" : unavailable > 0 ? "incomplete" : "passed",
        turns,
      },
    ],
    summary: {
      turns: turns.length,
      plans: index?.turns.filter((turn) => Boolean(turn.planId)).length ?? 0,
      passed: turns.length - warnings - unavailable,
      warnings,
      unavailable,
    },
  };
}

function previewPath(digest: ReturnType<typeof summarizeTrace>): string[] {
  const pathLabels: string[] = [];
  const add = (value: string | undefined): void => {
    if (value && pathLabels[pathLabels.length - 1] !== value) pathLabels.push(value);
  };
  for (const route of digest.route_path ?? []) {
    add(route.from);
    add(route.to);
  }
  if (pathLabels.length === 0) {
    for (const event of digest.response_sequence?.events ?? []) add(event.agent_name);
  }
  add(digest.turn.topic);
  return pathLabels;
}

function previewSessionEvents(input: {
  agentName: string;
  sessionId: string;
  sessionDir: string;
  targetOrg?: string;
  sessionKind?: "agent_file" | "api_name";
  status: "active" | "ended";
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "preview_session",
      status: input.status,
      agent_name: input.agentName,
      session_id: input.sessionId,
      session_dir: input.sessionDir,
      target_org: input.targetOrg,
      session_kind: input.sessionKind,
      source: input.source,
    },
  ];
}

function previewTurnEvents(input: {
  agentName: string;
  sessionId: string;
  planId: string;
  traceFile?: string;
  reportFile?: string;
  source: string;
}): AgentScriptBranchStateEvent[] {
  return [
    {
      schema_version: 1,
      kind: "preview_turn",
      agent_name: input.agentName,
      session_id: input.sessionId,
      plan_id: input.planId,
      trace_file: input.traceFile,
      report_file: input.reportFile,
      source: input.source,
    },
  ];
}

async function resolveSessionTargetOrg(
  cwd: string,
  agentName: string,
  sessionId: string,
  callerTargetOrg: string | undefined,
): Promise<{ kind: "ok"; targetOrg: string | undefined } | { kind: "conflict"; message: string }> {
  let metadata: PreviewMetadata | undefined;
  try {
    const loaded = await loadSession(cwd, agentName, sessionId);
    metadata = loaded.metadata;
  } catch {
    // No metadata on disk — fall back to whatever the caller passed.
    return { kind: "ok", targetOrg: callerTargetOrg };
  }
  const stored = metadata?.targetOrg;
  if (callerTargetOrg && stored && callerTargetOrg !== stored) {
    return {
      kind: "conflict",
      message:
        `target_org mismatch: session was started against '${stored}' but ` +
        `you passed '${callerTargetOrg}'. Re-run with target_org='${stored}' ` +
        `or omit target_org to reuse the session's stored org.`,
    };
  }
  return { kind: "ok", targetOrg: callerTargetOrg ?? stored };
}
