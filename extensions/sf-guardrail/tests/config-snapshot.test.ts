/* SPDX-License-Identifier: Apache-2.0 */
/** Strict engine selection and raw policy validation without touching user files. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { GuardrailConfigError, loadGuardrailSnapshot, userConfigPath } from "../lib/config.ts";
import { setGuardrailEngine } from "../lib/guardrail-settings.ts";
import { globalSettingsPath } from "../../../lib/common/sf-pi-settings.ts";

let tempAgentDir: string;
vi.mock("@earendil-works/pi-coding-agent", () => ({ getAgentDir: () => tempAgentDir }));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-guardrail-snapshot-"));
});
afterEach(() => {
  rmSync(tempAgentDir, { recursive: true, force: true });
});

function settings(guardrail: unknown): void {
  writeFileSync(globalSettingsPath(), JSON.stringify({ sfPi: { guardrail }, theme: "dark" }));
}
function override(value: unknown): void {
  mkdirSync(path.dirname(userConfigPath()), { recursive: true });
  writeFileSync(userConfigPath(), JSON.stringify(value));
}
function category(): string {
  try {
    loadGuardrailSnapshot();
  } catch (error) {
    expect(error).toBeInstanceOf(GuardrailConfigError);
    expect((error as Error).message).not.toContain("private-sentinel");
    return (error as GuardrailConfigError).category;
  }
  throw new Error("Expected configuration to fail closed.");
}

describe("strict Guardrail snapshot", () => {
  it("defaults to deterministic with missing optional files", () => {
    expect(loadGuardrailSnapshot()).toMatchObject({ engine: "deterministic", source: "bundled" });
  });

  it("captures Jev selection and current override/settings precedence", () => {
    override({
      confirmTimeoutMs: 30000,
      commandGate: { patterns: [{ id: "rm-rf", pattern: "rm -rf", behavior: "off" }] },
    });
    settings({
      engine: "jev",
      confirmTimeoutMs: 60000,
      ruleBehaviors: { commandGate: { "rm-rf": "block" } },
    });
    const loaded = loadGuardrailSnapshot();
    expect(loaded).toMatchObject({
      engine: "jev",
      source: "override+settings",
      config: { confirmTimeoutMs: 60000 },
    });
    expect(loaded.config.commandGate.patterns.find((rule) => rule.id === "rm-rf")).toMatchObject({
      behavior: "block",
      enabled: true,
    });
  });

  it.each([
    null,
    [],
    { sfPi: [] },
    { sfPi: { guardrail: null } },
    { sfPi: { guardrail: { engine: "private-sentinel" } } },
  ])("refuses a settings shape that could erase engine selection: %j", (value) => {
    writeFileSync(globalSettingsPath(), JSON.stringify(value));
    expect(category()).toBe("settings-invalid-schema");
  });

  it("reports JSON errors without parse text or file contents", () => {
    writeFileSync(globalSettingsPath(), '{ "private-sentinel":');
    expect(category()).toBe("settings-invalid-json");
  });

  it("rejects duplicate selectors including escaped equivalent keys", () => {
    writeFileSync(
      globalSettingsPath(),
      '{"sfPi":{"guardrail":{"engine":"jev","engin\\u0065":"deterministic"}}}',
    );
    expect(category()).toBe("settings-invalid-json");
  });

  it("bounds reads and rejects a non-file settings source", () => {
    writeFileSync(globalSettingsPath(), " ".repeat(256 * 1024 + 1));
    expect(category()).toBe("settings-too-large");
    rmSync(globalSettingsPath());
    mkdirSync(globalSettingsPath());
    expect(category()).toBe("settings-unreadable");
  });

  it.each([
    { ruleBehaviors: { commandGate: { "rm-rf": "private-sentinel" } } },
    { ruleBehaviors: { commandGate: ["block"] } },
    { productionAliases: ["prod", 3] },
    { confirmTimeoutMs: "30000" },
    { powerTool: { mode: "unexpected" } },
  ])("rejects Jev settings before malformed values are normalized away: %j", (value) => {
    settings({ engine: "jev", ...value });
    expect(category()).toBe("settings-invalid-schema");
  });

  it.each([
    { policies: { rules: [{ id: "custom", patterns: [], protection: "noAccess" }] } },
    {
      policies: {
        rules: [
          { id: "custom", patterns: [{ pattern: "[", regex: true }], protection: "noAccess" },
        ],
      },
    },
    {
      commandGate: {
        patterns: [{ id: "custom", pattern: "rm -rf", behavior: "private-sentinel" }],
      },
    },
    {
      orgAwareGate: {
        rules: [
          {
            id: "custom",
            match: { tool: "bash", ast: { cmd: "sf", flagIn: { "--method": "DELETE" } } },
            whenOrgType: ["production"],
          },
        ],
      },
    },
    {
      orgAwareGate: {
        rules: [
          {
            id: "custom",
            match: { tool: "bash", ast: { cmd: "sf" } },
            whenOrgType: ["unrecognized"],
          },
        ],
      },
    },
  ])("rejects malformed supplied Jev override rules before merging: %j", (value) => {
    settings({ engine: "jev" });
    override(value);
    expect(category()).toBe("override-invalid-schema");
  });

  it("keeps deterministic legacy override fallback when the engine is known", () => {
    settings({ engine: "deterministic" });
    mkdirSync(path.dirname(userConfigPath()), { recursive: true });
    writeFileSync(userConfigPath(), "{ invalid");
    expect(loadGuardrailSnapshot()).toMatchObject({ engine: "deterministic", source: "settings" });
    settings({ engine: "jev" });
    expect(category()).toBe("override-invalid-json");
  });

  it("preserves special stable rule ids rather than dropping their behaviors", () => {
    override({ commandGate: { patterns: [{ id: "__proto__", pattern: "danger" }] } });
    writeFileSync(
      globalSettingsPath(),
      '{"sfPi":{"guardrail":{"engine":"jev","ruleBehaviors":{"commandGate":{"__proto__":"block"}}}}}',
    );
    expect(
      loadGuardrailSnapshot().config.commandGate.patterns.find((rule) => rule.id === "__proto__")
        ?.behavior,
    ).toBe("block");
  });
});

describe("explicit engine updates", () => {
  it("preserves other settings and creates no advanced override", () => {
    settings({ confirmTimeoutMs: 60000 });
    setGuardrailEngine("jev");
    expect(JSON.parse(readFileSync(globalSettingsPath(), "utf8"))).toMatchObject({
      theme: "dark",
      sfPi: { guardrail: { engine: "jev", confirmTimeoutMs: 60000 } },
    });
    expect(loadGuardrailSnapshot().engine).toBe("jev");
  });

  it("allows switching away from a malformed Jev override", () => {
    settings({ engine: "jev" });
    override({ commandGate: { patterns: [{ id: "broken" }] } });
    expect(category()).toBe("override-invalid-schema");
    setGuardrailEngine("deterministic");
    expect(loadGuardrailSnapshot().engine).toBe("deterministic");
  });

  it.each([
    '{ "private-sentinel":',
    '{"sfPi":{"guardrail":{"engine":"private-sentinel"}}}',
    '{"sfPi":{"guardrail":{"engine":"jev","ruleBehaviors":{"commandGate":{"rm-rf":"invalid"}}}}}',
  ])("refuses to overwrite malformed settings: %s", (text) => {
    writeFileSync(globalSettingsPath(), text);
    expect(() => setGuardrailEngine("deterministic")).toThrow();
    expect(readFileSync(globalSettingsPath(), "utf8")).toBe(text);
  });
});
