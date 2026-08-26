/* SPDX-License-Identifier: Apache-2.0 */
/** Mutate actions for agentscript_authoring. */

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
  agentFileEvent,
  resolveCurrentAgentFile,
  withAgentScriptBranchState,
  type AgentScriptBranchStateEvent,
} from "../../branch-state.ts";
import { isAgentScriptFile } from "../../file-classify.ts";
import { applyMutation, type MutateOp } from "../../mutate.ts";
import { safeResolveToolPath, toolError, toolOk, type ToolError } from "../../tool-types.ts";
import type { AuthoringParams } from "../params.ts";

export async function runMutateAction(
  ctx: ExtensionContext,
  input: AuthoringParams,
): Promise<{
  content: { type: "text"; text: string }[];
  details: Record<string, unknown> | ToolError;
}> {
  const resolved = await resolveCurrentAgentFile(ctx, input.agent_file, (value) =>
    safeResolveToolPath(value, ctx.cwd),
  );
  if ("agentFile" in resolved === false) return resolved;
  const agentFile = resolved.agentFile;
  if (!isAgentScriptFile(agentFile)) {
    return toolError(`Not an Agent Script file: ${agentFile}`, "Pass a path ending in `.agent`.");
  }
  if (!input.mode) return toolError("INVALID_PARAMS", "verb='mutate' requires mode.");

  const built = toMutateOp({ ...input, agent_file: agentFile });
  if ("missing" in built) {
    return toolError(
      "INVALID_PARAMS",
      `mutate ${input.mode} requires: ${built.missing.join(", ")}.`,
    );
  }

  const result = await applyMutation(built);
  if (!result.ok) {
    const recompileReasons = new Set([
      "has_parse_errors",
      "stale_source",
      "ambiguous_diagnostic",
      "ambiguous_quick_fix",
      "no_matching_diagnostic",
      "no_matching_quick_fix",
      "code_action_provider_unavailable",
    ]);
    const recover = recompileReasons.has(result.reason ?? "")
      ? {
          tool: "agentscript_authoring",
          params: { verb: "compile", mode: "check", agent_file: agentFile },
        }
      : result.reason === "sdk_unavailable"
        ? { tool: "sf-agentscript", params: { action: "doctor" } }
        : undefined;
    return toolError(
      `Mutate failed (${result.reason ?? "unknown"})`,
      result.reason_detail ?? "See the sf-agentscript skill for supported mutate modes.",
      recover,
      {
        reason: result.reason,
        ...(result.candidates ? { candidates: result.candidates } : {}),
      },
    );
  }

  const errors = (result.diagnostics_after ?? []).filter((d) => d.severity === 1).length;
  const warnings = (result.diagnostics_after ?? []).filter((d) => d.severity === 2).length;
  const details = withAgentScriptBranchState(
    {
      ok: true as const,
      action: `mutate.${input.mode}`,
      agent_file: agentFile,
      path: agentFile,
      op: input.mode,
      applied_via: result.applied_via,
      diff_summary: result.diff_summary,
      bytes_changed: result.bytes_changed,
      diagnostics_after: result.diagnostics_after,
      ...(result.was_dry_run
        ? {
            was_dry_run: true,
            dry_run: true,
            diff: result.diff,
            preview_source: result.preview_source,
          }
        : {}),
    },
    mutationEvents(agentFile, input.mode, errors, warnings),
  );

  return toolOk(details, renderSummary(agentFile, result));
}

function toMutateOp(p: AuthoringParams): MutateOp | { ok: false; missing: string[] } {
  const required: Record<string, string[]> = {
    set_field: ["component", "field", "value"],
    rename: ["from", "to"],
    insert: ["parent", "child"],
    delete: ["target"],
    apply_quick_fix: [],
  };
  const mode = p.mode as string;
  const bag = p as unknown as Record<string, unknown>;
  const missing = (required[mode] ?? []).filter((k) => bag[k] === undefined);
  if (missing.length > 0) return { ok: false, missing };
  if (
    mode === "apply_quick_fix" &&
    !p.action_id &&
    !p.diagnostic_id &&
    !(p.diagnostic_code && p.line !== undefined)
  ) {
    return {
      ok: false,
      missing: ["source_version/diagnostic_id/action_id or diagnostic_code/line"],
    };
  }
  const path = p.agent_file as string;
  switch (mode) {
    case "set_field":
      return {
        op: "set_field",
        path,
        component: p.component as string,
        field: p.field as string,
        value: p.value,
        dry_run: p.dry_run,
      };
    case "rename":
      return { op: "rename", path, from: p.from as string, to: p.to as string, dry_run: p.dry_run };
    case "insert":
      return { op: "insert", path, parent: p.parent as string, child: p.child, dry_run: p.dry_run };
    case "delete":
      return { op: "delete", path, target: p.target as string, dry_run: p.dry_run };
    case "apply_quick_fix":
      return {
        op: "apply_quick_fix",
        path,
        diagnostic_code: p.diagnostic_code,
        line: p.line,
        fix_index: p.fix_index,
        source_version: p.source_version,
        diagnostic_id: p.diagnostic_id,
        action_id: p.action_id,
        dry_run: p.dry_run,
      };
    default:
      return { ok: false, missing: ["supported mode"] };
  }
}

function mutationEvents(
  agentFile: string,
  mode: string,
  errors: number,
  warnings: number,
): AgentScriptBranchStateEvent[] {
  return [
    agentFileEvent(agentFile, `mutate.${mode}`),
    {
      schema_version: 1,
      kind: "mutation_result",
      agent_file: agentFile,
      mode,
      diagnostics_after_errors: errors,
      diagnostics_after_warnings: warnings,
      source: `mutate.${mode}`,
    },
  ];
}

function renderSummary(
  agentFile: string,
  result: {
    applied_via?: string;
    diff_summary?: string;
    bytes_changed?: number;
    diagnostics_after?: { severity: number }[];
    was_dry_run?: boolean;
    diff?: string;
  },
): string {
  if (result.was_dry_run) {
    const truncated = (result.diff ?? "").split("\n").slice(0, 30).join("\n");
    return [
      `🔍 Dry-run: ${result.diff_summary ?? "mutation"} (${result.applied_via})`,
      `${agentFile}  Δ ${result.bytes_changed ?? 0} bytes (NOT written)`,
      truncated,
    ].join("\n");
  }
  const errors = (result.diagnostics_after ?? []).filter((d) => d.severity === 1).length;
  const warnings = (result.diagnostics_after ?? []).filter((d) => d.severity === 2).length;
  const status = errors === 0 ? "✓ clean" : `❌ ${errors} error(s)`;
  return [
    `🔧 ${result.diff_summary ?? "mutation"} (${result.applied_via})`,
    `${agentFile}  Δ ${result.bytes_changed ?? 0} bytes`,
    `Post-compile: ${status}${warnings > 0 ? ` · ${warnings} warning(s)` : ""}`,
  ].join("\n");
}
