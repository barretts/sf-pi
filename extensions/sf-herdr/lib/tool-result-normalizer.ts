/* SPDX-License-Identifier: Apache-2.0 */
/** Normalize Herdr's current successful empty-body pane-run response. */
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";

// The control package emits this only after `herdr pane run` exits zero, then
// mistakes the command's intentionally empty body for a missing JSON envelope.
const EMPTY_RUN_RESULT_PREFIX = "Expected JSON output from herdr pane run ";

export function normalizeHerdrPaneToolResult(
  event: ToolResultEvent,
): Pick<ToolResultEvent, "content" | "isError"> | undefined {
  if (event.toolName !== "herdr_pane" || !event.isError) return;
  if (event.input.action !== "run") return;

  const pane = event.input.pane;
  const command = event.input.command;
  if (typeof pane !== "string" || typeof command !== "string") return;

  const errorText = event.content.find((item) => item.type === "text")?.text.trim();
  if (!errorText?.startsWith(EMPTY_RUN_RESULT_PREFIX)) return;

  return {
    content: [{ type: "text", text: `Submitted command to Herdr pane ${pane}.` }],
    isError: false,
  };
}
