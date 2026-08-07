/* SPDX-License-Identifier: Apache-2.0 */
/** Public settings-panel behavior proof for global native Pi settings. */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Theme } from "@earendil-works/pi-coding-agent";
import { createConfigPanel } from "../lib/config-panel.ts";

const stubTheme: Theme = {
  fg: (_color: string, text: string) => text,
  bold: (text: string) => text,
} as Theme;

type TestPanel = { handleInput(data: string): void; renderContent(width: number): string[] };
let tmpDir: string;
let projectDir: string;
let previousAgentDir: string | undefined;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-herdr-config-"));
  projectDir = path.join(tmpDir, "project");
  previousAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = tmpDir;
});

afterEach(() => {
  if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previousAgentDir;
  rmSync(tmpDir, { recursive: true, force: true });
});

function makePanel(onDone: (value: unknown) => void = () => undefined): TestPanel {
  return createConfigPanel(stubTheme, projectDir, "project", onDone) as unknown as TestPanel;
}

describe("SF Herdr settings panel", () => {
  it("ignores the retired profile file instead of migrating it", () => {
    const retiredDir = path.join(tmpDir, "sf-pi", "herdr");
    mkdirSync(retiredDir, { recursive: true });
    writeFileSync(
      path.join(retiredDir, "preferences.json"),
      JSON.stringify({ state: { defaults: { splitDirection: "down" } } }),
    );

    const rendered = makePanel().renderContent(100).join("\n");
    expect(rendered).toMatch(/Split direction\s+auto/);
    expect(existsSync(path.join(tmpDir, "settings.json"))).toBe(false);
  });

  it("writes only the new global sfPi.herdr schema and supports dirty, save, and discard", () => {
    let done: unknown = "not-called";
    const panel = makePanel((value) => (done = value));
    const initial = panel.renderContent(100).join("\n");
    expect(initial).toContain("Split direction");
    expect(initial).toContain("Intent");
    expect(initial).toContain("Lifecycle");
    expect(initial).toContain("Saved");

    panel.handleInput(" ");
    expect(panel.renderContent(100).join("\n")).toContain("Unsaved changes");
    panel.handleInput("s");
    expect(panel.renderContent(100).join("\n")).toContain("Saved");
    expect(done).toBe("not-called");

    const global = JSON.parse(readFileSync(path.join(tmpDir, "settings.json"), "utf8"));
    expect(global).toEqual({
      sfPi: {
        herdr: {
          splitDirection: "right",
          lifecycleByIntent: {
            "run-tests": "ephemeral",
            "tail-logs": "ephemeral",
            "deploy-validate": "ephemeral",
            preview: "ephemeral",
            eval: "ephemeral",
            server: "sticky",
            review: "manual",
            verify: "ephemeral",
          },
        },
      },
    });
    expect(existsSync(path.join(projectDir, ".pi", "settings.json"))).toBe(false);
    expect(existsSync(path.join(tmpDir, "sf-pi", "herdr", "preferences.json"))).toBe(false);

    panel.handleInput(" ");
    expect(panel.renderContent(100).join("\n")).toContain("Unsaved changes");
    panel.handleInput("\u001b");
    expect(done).toBeUndefined();
    expect(JSON.parse(readFileSync(path.join(tmpDir, "settings.json"), "utf8"))).toEqual(global);
  });

  it("edits lifecycle by explicit intent without creating workflow profiles", () => {
    const panel = makePanel();

    panel.handleInput("\x1b[B"); // Intent
    panel.handleInput(" "); // tail-logs
    panel.handleInput("\x1b[B"); // Lifecycle
    panel.handleInput(" "); // sticky
    panel.handleInput("s");

    const global = JSON.parse(readFileSync(path.join(tmpDir, "settings.json"), "utf8"));
    expect(global.sfPi.herdr.lifecycleByIntent["tail-logs"]).toBe("sticky");
    expect(global.sfPi.herdr.lifecycleByIntent["run-tests"]).toBe("ephemeral");
    expect(JSON.stringify(global)).not.toContain("workflows");
    expect(JSON.stringify(global)).not.toContain("lanes");
  });
});
