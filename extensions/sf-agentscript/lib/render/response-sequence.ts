/* SPDX-License-Identifier: Apache-2.0 */
/** Human-only rendering for parsed LLM response-sequence evidence. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import type { LlmResponseEventEvidence, TurnResponseSequence } from "../llm-response-sequence.ts";
import { clipLine } from "./shared.ts";

export function responseSequenceLines(
  sequence: TurnResponseSequence | undefined,
  theme?: Theme,
): string[] {
  if (!sequence) return [];
  const fg = (token: Parameters<Theme["fg"]>[0], value: string): string =>
    theme ? theme.fg(token, value) : value;
  const bold = (value: string): string => (theme ? theme.bold(value) : `**${value}**`);
  const dim = (value: string): string => fg("dim", value);
  const warning = (value: string): string => fg("warning", value);
  const success = (value: string): string => fg("success", value);
  const code = (value: string): string => fg("mdCode", value);

  const lines = [bold("🗣 LLM Response Sequence")];
  if (sequence.integrity.status === "warning") {
    lines.push(
      `  ${warning("⚠")} ${warning(sequence.integrity.message ?? "Response integrity warning")}`,
    );
  } else if (sequence.integrity.status === "unavailable") {
    lines.push(
      `  ${dim("ⓘ")} ${dim(sequence.integrity.message ?? "Response evidence unavailable")}`,
    );
  } else {
    lines.push(
      `  ${success("✓")} ${dim(`${sequence.non_empty_content_count} non-empty completion${sequence.non_empty_content_count === 1 ? "" : "s"}`)}`,
    );
  }
  if (sequence.mirrored_alias_count > 0) {
    lines.push(
      `  ${dim("↳")} ${dim(`${sequence.raw_llm_event_count} raw events · ${sequence.physical_llm_call_count} physical call${sequence.physical_llm_call_count === 1 ? "" : "s"} · ${sequence.mirrored_alias_count} mirrored safety alias${sequence.mirrored_alias_count === 1 ? "" : "es"}`)}`,
    );
  }

  for (const event of sequence.events) {
    const actor = event.agent_name ?? event.prompt_name ?? "LLM";
    const label = eventLabel(event);
    const detail = eventDetail(event);
    const glyph =
      event.mirrored_alias_of !== undefined
        ? dim("↳")
        : event.matches_final_response
          ? success("✅")
          : event.kind === "content" || event.kind === "malformed"
            ? warning("⚠")
            : dim(event.kind === "tool_only" ? "🛠" : "·");
    lines.push(
      `  ${glyph} ${code(String(event.index + 1).padStart(2, " "))} ${code(actor)} ${label}${detail ? ` · ${detail}` : ""}`,
    );
  }
  return lines;
}

function eventLabel(event: LlmResponseEventEvidence): string {
  if (event.mirrored_alias_of !== undefined) {
    return `mirrored alias of ${event.mirrored_alias_of + 1}`;
  }
  if (event.matches_final_response) return "final content";
  if (event.kind === "content") return "candidate content";
  if (event.kind === "tool_only") return "tool-only";
  if (event.kind === "malformed") return "malformed response";
  return "empty completion";
}

function eventDetail(event: LlmResponseEventEvidence): string {
  if (event.kind === "tool_only") {
    return event.tool_calls.length > 0 ? `calls ${event.tool_calls.join(", ")}` : "";
  }
  if (event.content.length > 0) return `“${clipLine(event.content.replace(/\s+/g, " "), 240)}”`;
  return event.tool_calls.length > 0 ? `calls ${event.tool_calls.join(", ")}` : "";
}
