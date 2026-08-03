/* SPDX-License-Identifier: Apache-2.0 */
/** Preview session maintenance actions: end_all and cleanup. */
import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { connForAgentApi } from "../../agent-api-auth.ts";
import { toolError, toolOk, type ToolError } from "../../tool-types.ts";
import { cleanupSessions, endPreview, listStoredSessions } from "../client.ts";

export interface EndAllPreviewActionInput {
  target_org?: string;
  agent_name?: string;
  session_kind?: "agent_file" | "api_name";
  include_ended?: boolean;
  older_than_days?: number;
  dry_run?: boolean;
}

export interface CleanupPreviewActionInput {
  older_than_days?: number;
  dry_run?: boolean;
}

export async function actionEndAll(
  ctx: ExtensionContext,
  input: EndAllPreviewActionInput,
  signal?: AbortSignal,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const dryRun = input.dry_run ?? true;
  const includeEnded = input.include_ended ?? false;
  try {
    const sessions = await listStoredSessions(ctx.cwd);
    const skipped: Array<{ agent: string; session_id: string; reason: string }> = [];
    const candidates = sessions.filter((s) => {
      if (!s.metadata) {
        skipped.push({ agent: s.agent, session_id: s.session_id, reason: "metadata_unreadable" });
        return false;
      }
      const kind = s.metadata.sessionKind ?? "agent_file";
      if (input.agent_name && s.agent !== input.agent_name) return false;
      if (input.session_kind && kind !== input.session_kind) return false;
      if (input.target_org && s.metadata.targetOrg !== input.target_org) return false;
      if (!includeEnded && s.metadata.endTime) return false;
      if (typeof input.older_than_days === "number" && s.age_days < input.older_than_days) {
        return false;
      }
      return true;
    });

    const candidateRows = candidates.map((s) => ({
      agent: s.agent,
      session_id: s.session_id,
      session_kind: s.metadata?.sessionKind ?? "agent_file",
      target_org: s.metadata?.targetOrg,
      age_days: s.age_days,
      session_dir: s.session_dir,
    }));

    if (dryRun) {
      return toolOk(
        {
          ok: true as const,
          dry_run: true,
          matched: candidateRows.length,
          candidates: candidateRows,
          skipped,
        },
        `🏁 end_all dry run: ${candidateRows.length} session(s) would be ended; skipped ${skipped.length}. Pass dry_run=false to execute.`,
      );
    }

    const ended: Array<Record<string, unknown>> = [];
    const localFinalized: Array<Record<string, unknown>> = [];
    const failed: Array<Record<string, unknown>> = [];
    const connCache = new Map<string, Awaited<ReturnType<typeof connForAgentApi>>["conn"]>();

    for (const s of candidates) {
      const meta = s.metadata;
      if (!meta) {
        failed.push({ agent: s.agent, session_id: s.session_id, reason: "metadata_unreadable" });
        continue;
      }
      const kind = meta.sessionKind ?? "agent_file";
      try {
        if (kind === "api_name") {
          const orgKey = meta.targetOrg ?? input.target_org ?? "";
          let conn = connCache.get(orgKey);
          if (!conn) {
            try {
              ({ conn } = await connForAgentApi(meta.targetOrg ?? input.target_org));
              connCache.set(orgKey, conn);
            } catch (err) {
              failed.push({
                agent: s.agent,
                session_id: s.session_id,
                session_kind: kind,
                reason: "agent_api_auth_failed",
                error: err instanceof Error ? err.message : String(err),
              });
              continue;
            }
          }
          const result = await endPreview({
            conn,
            cwd: ctx.cwd,
            agentName: s.agent,
            sessionId: s.session_id,
            signal,
          });
          const row = {
            agent: s.agent,
            session_id: s.session_id,
            session_kind: kind,
            ended_at: result.endedAt,
            session_dir: s.session_dir,
            remote_ended: result.remoteEnded,
          };
          if (result.remoteEnded === false) {
            failed.push({ ...row, error: result.remoteEndError ?? "remote_end_failed" });
          } else {
            ended.push(row);
          }
        } else {
          const result = await endPreview({
            cwd: ctx.cwd,
            agentName: s.agent,
            sessionId: s.session_id,
            signal,
          });
          localFinalized.push({
            agent: s.agent,
            session_id: s.session_id,
            session_kind: kind,
            ended_at: result.endedAt,
            session_dir: s.session_dir,
            remote_ended: "not_applicable",
          });
        }
      } catch (err) {
        failed.push({
          agent: s.agent,
          session_id: s.session_id,
          session_kind: kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return toolOk(
      {
        ok: failed.length === 0,
        dry_run: false,
        matched: candidates.length,
        ended,
        local_finalized: localFinalized,
        skipped,
        failed,
      },
      `🏁 end_all: ended ${ended.length} remote session(s), finalized ${localFinalized.length} local session(s), failed ${failed.length}, skipped ${skipped.length}.`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}

export async function actionCleanup(
  ctx: ExtensionContext,
  input: CleanupPreviewActionInput,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const days = input.older_than_days ?? 30;
  const dryRun = input.dry_run ?? false;
  try {
    const result = await cleanupSessions(ctx.cwd, days, dryRun);
    return toolOk(
      {
        ok: true as const,
        older_than_days: days,
        dry_run: dryRun,
        removed: result.removed,
        kept_count: result.kept_count,
      },
      `🧹 cleanup: ${dryRun ? "would remove" : "removed"} ${result.removed.length} session(s) older than ${days} day(s); kept ${result.kept_count}.`,
    );
  } catch (err) {
    return toolError(err instanceof Error ? err.message : String(err));
  }
}
