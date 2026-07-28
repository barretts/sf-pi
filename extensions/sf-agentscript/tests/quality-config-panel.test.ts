/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";

const state = vi.hoisted(() => ({ settingsPath: "" }));
vi.mock("../../../lib/common/sf-pi-settings.ts", async () => {
  const fs = await import("node:fs");
  const p = await import("node:path");
  return {
    globalSettingsPath: () => state.settingsPath,
    projectSettingsPath: (cwd: string) => p.join(cwd, ".pi", "settings.json"),
    readJsonFile: (file: string) => {
      if (!fs.existsSync(file)) return {};
      try {
        return JSON.parse(fs.readFileSync(file, "utf8"));
      } catch {
        return {};
      }
    },
    writeJsonFile: (file: string, data: Record<string, unknown>) => {
      fs.mkdirSync(p.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, "utf8");
    },
  };
});

import { createConfigPanel } from "../lib/config-panel.ts";
import { readEffectiveAgentScriptQualitySettings } from "../lib/quality/settings.ts";

const theme = {
  fg: (_color: string, text: string) => text,
  bg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

type TestPanel = {
  handleInput(data: string): void;
  renderContent(width?: number): string[];
};

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-agentscript-quality-panel-"));
  state.settingsPath = path.join(dir, "global-settings.json");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function panel(scope: "global" | "project" = "global"): TestPanel {
  return createConfigPanel(theme, dir, scope, vi.fn() as never) as unknown as TestPanel;
}

describe("Agent Script quality settings panel", () => {
  it("shows global-only quality automation and coverage", () => {
    const rendered = panel("global").renderContent(120).join("\n");
    expect(rendered).toContain("Quality auto-run");
    expect(rendered).toContain("Quality rules");
    expect(rendered).toContain("18/18 enabled");
  });

  it("keeps project settings focused on existing tool defaults", () => {
    const rendered = panel("project").renderContent(120).join("\n");
    expect(rendered).toContain("Quality rule controls are global-only");
    expect(rendered).not.toContain("18/18 enabled");
  });

  it("opens the global rules page and saves an individual toggle", () => {
    const p = panel("global");
    for (let i = 0; i < 4; i++) p.handleInput("\x1b[B");
    p.handleInput("\r");
    expect(p.renderContent(120).join("\n")).toContain("Endless Transition Loop");

    p.handleInput(" ");
    expect(p.renderContent(120).join("\n")).toContain("unsaved changes");
    p.handleInput("s");

    expect(readEffectiveAgentScriptQualitySettings().rules["unconditional-transition-cycle"]).toBe(
      false,
    );
    expect(p.renderContent(120).join("\n")).toContain("Saved Agent Script quality rules");
  });
});
