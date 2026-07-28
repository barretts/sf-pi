/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf-tldraw settings", () => {
  let cwd: string;
  let settings: typeof import("../lib/settings.ts");

  beforeEach(async () => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-agent-"));
    cwd = mkdtempSync(path.join(tmpdir(), "sf-tldraw-cwd-"));
    vi.resetModules();
    settings = await import("../lib/settings.ts");
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("resolves each field as project then global then default", () => {
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      cardinalityDetail: "simplified",
      cardFill: "transparent",
      ldvThreshold: "2M",
      recordTypeMode: "off",
      legendRelationships: "show",
    });
    settings.writeTldrawPreference(cwd, "global", "cardFill", "family");
    settings.writeTldrawPreference(cwd, "global", "ldvThreshold", "5M");
    settings.writeTldrawPreference(cwd, "global", "recordTypeMode", "auto");
    settings.writeTldrawPreference(cwd, "global", "legendRelationships", "hide");
    settings.writeTldrawPreference(cwd, "project", "recordTypeMode", "always");
    settings.writeTldrawPreference(cwd, "project", "legendRelationships", "show");
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      cardFill: "family",
      ldvThreshold: "5M",
      recordTypeMode: "always",
      legendRelationships: "show",
      sources: {
        cardFill: { scope: "global" },
        ldvThreshold: { scope: "global" },
        recordTypeMode: { scope: "project" },
        legendRelationships: { scope: "project" },
      },
    });
  });

  it("preserves the custom settings page with five descriptor-backed rows", async () => {
    const { createConfigPanel } = await import("../lib/config-panel.ts");
    const theme = {
      fg: (_color: string, value: string) => value,
      bold: (value: string) => value,
    };
    const done = vi.fn();
    const panel = createConfigPanel(theme as never, cwd, "global", done) as unknown as {
      render(width: number): string[];
    };
    const rendered = panel.render(120).join("\n");
    expect(rendered).toContain("🎨 SF tldraw Settings");
    expect(rendered).toContain("Five scalar presentation choices only");
    expect(rendered).toContain("Cardinality detail");
    expect(rendered).toContain("Card fill");
    expect(rendered).toContain("LDV threshold");
    expect(rendered).toContain("Record types");
    expect(rendered).toContain("Legend — Relationships");
    expect(rendered).not.toContain("Sequence interaction");
    expect(rendered).toContain("↑/↓ move · ←/→ change · S/Enter save · Esc back");
  });

  it("preserves keyboard navigation, save, scoped clearing, and Escape", async () => {
    const { createConfigPanel } = await import("../lib/config-panel.ts");
    const theme = {
      fg: (_color: string, value: string) => value,
      bold: (value: string) => value,
    };
    const done = vi.fn();
    const panel = createConfigPanel(theme as never, cwd, "global", done) as unknown as {
      handleInput(data: string): void;
      render(width: number): string[];
    };

    panel.handleInput(" ");
    panel.handleInput("\x1b[B");
    panel.handleInput(" ");
    panel.handleInput("s");
    expect(settings.readScopedTldrawPreferences(cwd, "global")).toMatchObject({
      cardinalityDetail: "simplified",
      cardFill: "transparent",
    });
    expect(panel.render(120).join("\n")).toContain("Saved SF tldraw settings.");

    settings.writeTldrawPreference(cwd, "global", "cardinalityDetail", "full");
    const clearPanel = createConfigPanel(theme as never, cwd, "global", done) as unknown as {
      handleInput(data: string): void;
    };
    clearPanel.handleInput(" ");
    clearPanel.handleInput("\r");
    expect(settings.readScopedTldrawPreferences(cwd, "global")).not.toHaveProperty(
      "cardinalityDetail",
    );

    panel.handleInput("\x1b");
    expect(done).toHaveBeenCalledWith(undefined);
  });

  it("clears only the selected scoped field", () => {
    settings.writeTldrawPreference(cwd, "global", "ldvThreshold", "10M");
    settings.writeTldrawPreference(cwd, "project", "ldvThreshold", "1M");
    settings.writeTldrawPreference(cwd, "project", "cardFill", "family");
    settings.clearTldrawPreference(cwd, "project", "ldvThreshold");
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      ldvThreshold: "10M",
      cardFill: "family",
    });
  });

  it("ignores invalid persisted values", () => {
    const projectDir = path.join(cwd, ".pi");
    mkdirSync(projectDir, { recursive: true });
    writeFileSync(
      path.join(projectDir, "settings.json"),
      JSON.stringify({
        sfPi: {
          tldraw: {
            cardFill: "pattern",
            ldvThreshold: "999M",
            recordTypeMode: "sometimes",
            legendRelationships: "sometimes",
            interactionMode: "step_through",
          },
        },
      }),
    );
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      cardFill: "transparent",
      ldvThreshold: "2M",
      recordTypeMode: "off",
      legendRelationships: "show",
    });
    expect(settings.readScopedTldrawPreferences(cwd, "project")).not.toHaveProperty(
      "interactionMode",
    );
  });
});
