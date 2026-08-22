/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  TOGGLE_BODY_LINES,
  TOGGLE_INVOCATION_HEADER,
  TOGGLE_INVOCATION_MIN,
  TOGGLE_ORIGIN_HEADER,
  TOGGLE_ORIGIN_MIN,
  TOGGLE_PREVIEW_WHY_LINES,
  buildPreviewLines,
  splitTogglePane,
  wrapPlain,
} from "../lib/toggle-layout.ts";
import { fitColumns } from "../lib/funnel-view/layout.ts";

describe("toggle layout", () => {
  it("keeps a stable left/right split", () => {
    const pane = splitTogglePane(120);
    expect(pane.left + pane.gutter + pane.right).toBe(120);
    expect(pane.right).toBeGreaterThanOrEqual(pane.left);
  });

  it("keeps Origin and Invocation labels untruncated at typical pane widths", () => {
    const pane = splitTogglePane(140);
    const widths = fitColumns(pane.left, [
      { key: "cur", header: "", min: 1 },
      { key: "icon", header: "", min: 2 },
      { key: "name", header: "Name", min: 14, weight: 2 },
      { key: "origin", header: TOGGLE_ORIGIN_HEADER, min: TOGGLE_ORIGIN_MIN },
      { key: "count", header: "#", min: 3, align: "right" },
      { key: "state", header: TOGGLE_INVOCATION_HEADER, min: TOGGLE_INVOCATION_MIN },
    ]);
    expect(widths[3]).toBeGreaterThanOrEqual(TOGGLE_ORIGIN_MIN);
    expect(widths[5]).toBeGreaterThanOrEqual(TOGGLE_INVOCATION_MIN);
  });

  it("pads every preview to the same line count", () => {
    const short = buildPreviewLines({
      width: 36,
      row: {
        kind: "skill",
        id: "dx-org-switch",
        packLabel: "DX / DevOps",
        origin: "Salesforce",
        mode: "manual-only",
        locked: false,
        description: "Switch orgs.",
        filePath: "/tmp/dx-org-switch/SKILL.md",
      },
    });
    const long = buildPreviewLines({
      width: 36,
      row: {
        kind: "skill",
        id: "automation-sandbox-post-copy-config-generate",
        packLabel: "Automation",
        origin: "Salesforce",
        mode: "manual-only",
        locked: false,
        description: "A".repeat(800),
        filePath: "/tmp/long/SKILL.md",
      },
    });
    expect(short).toHaveLength(TOGGLE_BODY_LINES);
    expect(long).toHaveLength(TOGGLE_BODY_LINES);
    expect(wrapPlain("A".repeat(800), 36).length).toBeGreaterThan(TOGGLE_PREVIEW_WHY_LINES);
  });
});
