/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proof for the current Herdr CLI empty-success response. */
import { describe, expect, it } from "vitest";
import type { ToolResultEvent } from "@earendil-works/pi-coding-agent";
import { normalizeHerdrPaneToolResult } from "../lib/tool-result-normalizer.ts";

function event(overrides: Partial<ToolResultEvent> = {}): ToolResultEvent {
  return {
    type: "tool_result",
    toolCallId: "call-1",
    toolName: "herdr_pane",
    input: { action: "run", pane: "pane-1", command: "npm test" },
    content: [
      {
        type: "text",
        text: "Expected JSON output from herdr pane run pane-1 npm test",
      },
    ],
    details: {},
    isError: true,
    ...overrides,
  } as ToolResultEvent;
}

describe("normalizeHerdrPaneToolResult", () => {
  it("turns only the current empty-success run result into a submitted result", () => {
    expect(normalizeHerdrPaneToolResult(event())).toEqual({
      content: [{ type: "text", text: "Submitted command to Herdr pane pane-1." }],
      isError: false,
    });
  });

  it("does not alter unrelated, successful, or differently shaped results", () => {
    expect(normalizeHerdrPaneToolResult(event({ toolName: "bash" }))).toBeUndefined();
    expect(normalizeHerdrPaneToolResult(event({ isError: false }))).toBeUndefined();
    expect(
      normalizeHerdrPaneToolResult(event({ input: { action: "read", pane: "pane-1" } })),
    ).toBeUndefined();
    expect(
      normalizeHerdrPaneToolResult(
        event({ content: [{ type: "text", text: "permission denied" }] }),
      ),
    ).toBeUndefined();
  });
});
