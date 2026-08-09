/* SPDX-License-Identifier: Apache-2.0 */
/** Behavior proofs for the compact SF LSP readiness row in SF Welcome. */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import {
  __resetSfLspHealthRegistryForTests,
  setSfLspHealthFromDoctor,
  type SfLspAvailability,
  type SfLspHealthSnapshot,
  type SupportedLspLanguage,
} from "../../../lib/common/sf-lsp-health/index.ts";
import { collectInitialSplashData } from "../lib/splash-data.ts";
import { SfWelcomeOverlay } from "../lib/splash-component.ts";
import type { SplashData } from "../lib/types.ts";

const ANSI_ESCAPE_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE_RE, "");
}

function health(
  apex: SfLspAvailability,
  lwc: SfLspAvailability,
  agentscript: SfLspAvailability,
): SfLspHealthSnapshot {
  const entry = (language: SupportedLspLanguage, availability: SfLspAvailability) => ({
    language,
    availability,
    activity: "idle" as const,
  });
  return {
    revision: 1,
    byLanguage: {
      apex: entry("apex", apex),
      lwc: entry("lwc", lwc),
      agentscript: entry("agentscript", agentscript),
    },
  };
}

function baseData(overrides: Partial<SplashData> = {}): SplashData {
  return {
    modelName: "Example Model",
    providerName: "example-provider",
    loadedCounts: { extensions: 3, skills: 1, promptTemplates: 0 },
    recentSessions: [],
    extensionHealth: [],
    slackConnected: false,
    monthlyCost: 0,
    monthlyBudget: 3000,
    lspEnabled: true,
    lspHealth: health("unknown", "unknown", "unknown"),
    ...overrides,
  };
}

function lspLines(data: SplashData, width = 180): string[] {
  return new SfWelcomeOverlay(data)
    .render(width)
    .filter((line) => stripAnsi(line).includes("SF LSP"));
}

beforeEach(() => __resetSfLspHealthRegistryForTests());
afterEach(() => __resetSfLspHealthRegistryForTests());

describe("SF Welcome LSP readiness row", () => {
  it("renders all three ready languages on exactly one line", () => {
    const lines = lspLines(baseData({ lspHealth: health("available", "available", "available") }));

    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0] ?? "")).toContain("✓ Apex · ✓ LWC · ✓ Agent Script");
    expect(visibleWidth(lines[0] ?? "")).toBeLessThanOrEqual(180);
  });

  it("renders mixed readiness without blending in last-file activity", () => {
    const lines = lspLines(
      baseData({ lspHealth: health("available", "unavailable", "available") }),
    );

    expect(lines).toHaveLength(1);
    expect(stripAnsi(lines[0] ?? "")).toContain("✓ Apex · ✗ LWC · ✓ Agent Script");
  });

  it("renders unknown and disabled states calmly on one line", () => {
    const unknown = lspLines(baseData());
    const disabled = lspLines(baseData({ lspEnabled: false }));

    expect(unknown).toHaveLength(1);
    expect(stripAnsi(unknown[0] ?? "")).toContain("○ Apex · ○ LWC · ○ Agent Script");
    expect(disabled).toHaveLength(1);
    expect(stripAnsi(disabled[0] ?? "")).toContain("○ Disabled");
  });

  it("uses the shared snapshot for cache-first splash data", () => {
    setSfLspHealthFromDoctor([
      { language: "apex", available: true, detail: "ready" },
      { language: "lwc", available: false, detail: "missing" },
      { language: "agentscript", available: true, detail: "ready" },
    ]);

    const data = collectInitialSplashData("Example Model", "example-provider");
    expect(data.lspHealth?.byLanguage.apex.availability).toBe("available");
    expect(data.lspHealth?.byLanguage.lwc.availability).toBe("unavailable");
    expect(data.lspHealth?.byLanguage.agentscript.availability).toBe("available");
  });

  it("uses the shared ASCII icon fallback", () => {
    const previous = process.env.SF_PI_ASCII_ICONS;
    process.env.SF_PI_ASCII_ICONS = "1";
    try {
      const line = stripAnsi(lspLines(baseData(), 180)[0] ?? "");
      expect(line).toMatch(/ls\s+SF LSP/);
      expect(line).not.toContain("🩻");
    } finally {
      if (previous === undefined) delete process.env.SF_PI_ASCII_ICONS;
      else process.env.SF_PI_ASCII_ICONS = previous;
    }
  });
});
