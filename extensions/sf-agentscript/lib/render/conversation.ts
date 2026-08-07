/* SPDX-License-Identifier: Apache-2.0 */
/** Shared human-only conversation replay for Preview sessions and Eval runs. */

import type { Theme } from "@earendil-works/pi-coding-agent";
import { fmtMs } from "./shared.ts";

export interface ConversationReplayTurn {
  turn: number | string;
  user?: string;
  agent?: string;
  topic?: string;
  path?: string[];
  latency_ms?: number;
  integrity?: "pass" | "warning" | "unavailable";
  llm_call_count?: number;
  non_empty_content_count?: number;
  integrity_message?: string;
}

export interface ConversationReplayScenario {
  test_id: string;
  verdict: "passed" | "failed" | "incomplete" | "unknown";
  turns: ConversationReplayTurn[];
}

export function conversationReplayLines(
  scenarios: ConversationReplayScenario[] | undefined,
  theme?: Theme,
  options: { expanded?: boolean; maxScenarios?: number; maxTurns?: number } = {},
): string[] {
  if (!scenarios || scenarios.length === 0) return [];
  const fg = (token: Parameters<Theme["fg"]>[0], value: string): string =>
    theme ? theme.fg(token, value) : value;
  const bold = (value: string): string => (theme ? theme.bold(value) : `**${value}**`);
  const dim = (value: string): string => fg("dim", value);
  const code = (value: string): string => fg("mdCode", value);
  const success = (value: string): string => fg("success", value);
  const error = (value: string): string => fg("error", value);
  const warning = (value: string): string => fg("warning", value);
  const expanded = options.expanded ?? true;
  const maxScenarios = options.maxScenarios ?? 20;
  const maxTurns = options.maxTurns ?? 40;
  const lines: string[] = [bold("💬 Conversation Replay")];
  let renderedTurns = 0;

  for (const scenario of scenarios.slice(0, maxScenarios)) {
    const glyph =
      scenario.verdict === "passed"
        ? success("✅")
        : scenario.verdict === "failed"
          ? error("❌")
          : scenario.verdict === "incomplete"
            ? warning("⚠")
            : dim("·");
    const integrityWarnings = scenario.turns.filter(
      (turn) => turn.integrity === "warning" || turn.integrity === "unavailable",
    ).length;
    lines.push(
      `  ${glyph} ${code(scenario.test_id)} ${dim(`· ${scenario.turns.length} turn${scenario.turns.length === 1 ? "" : "s"}`)}${
        integrityWarnings > 0
          ? ` ${warning(`· ${integrityWarnings} integrity gap${integrityWarnings === 1 ? "" : "s"}`)}`
          : ""
      }`,
    );
    if (!expanded) continue;

    for (const turn of scenario.turns) {
      if (renderedTurns >= maxTurns) break;
      renderedTurns++;
      const head = [`Turn ${turn.turn}`];
      if (typeof turn.latency_ms === "number") head.push(fmtMs(turn.latency_ms));
      if (turn.topic) head.push(`topic=${turn.topic}`);
      lines.push(`    ${dim("──")} ${bold(head.join(" · "))}`);
      if (turn.user) lines.push(`      👤 ${code("User ")} ${turn.user}`);
      if (turn.agent) lines.push(`      🤖 ${code("Agent")} ${turn.agent}`);
      if (turn.path && turn.path.length > 0) {
        lines.push(`      🧭 ${code("Path ")} ${turn.path.join(dim(" → "))}`);
      }
      const integrity = integrityLabel(turn, { success, warning, dim });
      if (integrity) lines.push(`      🗣 ${code("Proof")} ${integrity}`);
    }
    if (renderedTurns >= maxTurns) break;
  }

  const totalTurns = scenarios.reduce((sum, scenario) => sum + scenario.turns.length, 0);
  const passed = scenarios.filter((scenario) => scenario.verdict === "passed").length;
  const failed = scenarios.filter((scenario) => scenario.verdict === "failed").length;
  const incomplete = scenarios.filter((scenario) => scenario.verdict === "incomplete").length;
  lines.push(
    `  ${dim(`Summary: ${totalTurns} turns · ${passed} passed · ${failed} failed · ${incomplete} incomplete`)}`,
  );
  if (scenarios.length > maxScenarios || totalTurns > maxTurns) {
    lines.push(
      `  ${dim(`Showing ${Math.min(scenarios.length, maxScenarios)} scenarios and ${Math.min(totalTurns, maxTurns)} turns; complete evidence remains in the run/session artifacts.`)}`,
    );
  }
  return lines;
}

function integrityLabel(
  turn: ConversationReplayTurn,
  style: {
    success: (value: string) => string;
    warning: (value: string) => string;
    dim: (value: string) => string;
  },
): string | undefined {
  if (!turn.integrity) return undefined;
  const counts = `${turn.llm_call_count ?? 0} LLM call${turn.llm_call_count === 1 ? "" : "s"} · ${turn.non_empty_content_count ?? 0} non-empty`;
  if (turn.integrity === "pass") return `${style.success("✓ pass")} ${style.dim(`· ${counts}`)}`;
  if (turn.integrity === "warning") {
    return `${style.warning("⚠ warning")} ${style.dim(`· ${counts}`)}${turn.integrity_message ? ` · ${turn.integrity_message}` : ""}`;
  }
  return `${style.warning("ⓘ unavailable")} ${style.dim(`· ${counts}`)}${turn.integrity_message ? ` · ${turn.integrity_message}` : ""}`;
}
