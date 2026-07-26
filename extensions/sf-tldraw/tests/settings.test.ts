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
      interactionMode: "static",
    });
    settings.writeTldrawPreference(cwd, "global", "cardFill", "family");
    settings.writeTldrawPreference(cwd, "global", "ldvThreshold", "5M");
    settings.writeTldrawPreference(cwd, "global", "recordTypeMode", "auto");
    settings.writeTldrawPreference(cwd, "project", "recordTypeMode", "always");
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      cardFill: "family",
      ldvThreshold: "5M",
      recordTypeMode: "always",
      sources: {
        cardFill: { scope: "global" },
        ldvThreshold: { scope: "global" },
        recordTypeMode: { scope: "project" },
      },
    });
  });

  it("clears only the selected scoped field", () => {
    settings.writeTldrawPreference(cwd, "global", "ldvThreshold", "10M");
    settings.writeTldrawPreference(cwd, "project", "ldvThreshold", "1M");
    settings.writeTldrawPreference(cwd, "project", "interactionMode", "step_through");
    settings.clearTldrawPreference(cwd, "project", "ldvThreshold");
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      ldvThreshold: "10M",
      interactionMode: "step_through",
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
          },
        },
      }),
    );
    expect(settings.readEffectiveTldrawPreferences(cwd)).toMatchObject({
      cardFill: "transparent",
      ldvThreshold: "2M",
      recordTypeMode: "off",
    });
  });
});
