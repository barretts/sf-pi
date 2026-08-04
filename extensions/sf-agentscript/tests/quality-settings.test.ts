/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

import { AGENT_SCRIPT_QUALITY_RULE_IDS } from "../lib/quality/catalog.ts";
import {
  readEffectiveAgentScriptQualitySettings,
  setGlobalAgentScriptQualityAutoRun,
  setGlobalAgentScriptQualityRule,
} from "../lib/quality/settings.ts";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sf-agentscript-quality-settings-"));
  state.settingsPath = path.join(dir, "settings.json");
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("global Agent Script quality settings", () => {
  it("defaults all 20 stable rules on with auto-run enabled", () => {
    const settings = readEffectiveAgentScriptQualitySettings();
    expect(settings.autoRun).toBe(true);
    expect(Object.values(settings.rules).filter(Boolean)).toHaveLength(20);
    expect(settings.disabledRules).toEqual([]);
  });

  it("stores only global disabled overrides and reports coverage", () => {
    setGlobalAgentScriptQualityRule("unused-action", false);
    const settings = readEffectiveAgentScriptQualitySettings();
    expect(settings.rules["unused-action"]).toBe(false);
    expect(settings.disabledRules).toEqual([
      expect.objectContaining({ id: "unused-action", source: "global" }),
    ]);

    const saved = JSON.parse(readFileSync(state.settingsPath, "utf8"));
    expect(saved.sfPi.agentScript.quality.rules).toEqual({ "unused-action": false });
  });

  it("removes an override when a rule is turned back on", () => {
    setGlobalAgentScriptQualityRule("unused-action", false);
    setGlobalAgentScriptQualityRule("unused-action", true);
    expect(readEffectiveAgentScriptQualitySettings().rules["unused-action"]).toBe(true);
    const saved = JSON.parse(readFileSync(state.settingsPath, "utf8"));
    expect(saved.sfPi.agentScript.quality.rules ?? {}).toEqual({});
  });

  it("round-trips every catalog rule through the shared global setting path", () => {
    for (const ruleId of AGENT_SCRIPT_QUALITY_RULE_IDS) {
      setGlobalAgentScriptQualityRule(ruleId, false);
      expect(readEffectiveAgentScriptQualitySettings().rules[ruleId]).toBe(false);
      setGlobalAgentScriptQualityRule(ruleId, true);
      expect(readEffectiveAgentScriptQualitySettings().rules[ruleId]).toBe(true);
    }
    const saved = JSON.parse(readFileSync(state.settingsPath, "utf8"));
    expect(saved.sfPi.agentScript.quality.rules ?? {}).toEqual({});
  });

  it("uses a global auto-run toggle without affecting explicit rule enablement", () => {
    setGlobalAgentScriptQualityAutoRun(false);
    const settings = readEffectiveAgentScriptQualitySettings();
    expect(settings.autoRun).toBe(false);
    expect(Object.values(settings.rules).filter(Boolean)).toHaveLength(20);
  });

  it("preserves unrelated Agent Script and Pi settings", () => {
    writeFileSync(
      state.settingsPath,
      JSON.stringify({ sfPi: { agentScript: { evalConcurrency: 16 }, other: { keep: true } } }),
    );
    setGlobalAgentScriptQualityRule("unused-action", false);
    const saved = JSON.parse(readFileSync(state.settingsPath, "utf8"));
    expect(saved.sfPi.agentScript.evalConcurrency).toBe(16);
    expect(saved.sfPi.other).toEqual({ keep: true });
  });
});
