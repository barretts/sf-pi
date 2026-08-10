/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  CONSTITUTION_ENTRY_TYPE,
  CONSTITUTION_OPEN_TAG,
  constitutionAddendumPath,
  loadConstitution,
  readBundledConstitution,
} from "../lib/constitution.ts";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", () => ({
  getAgentDir: () => tempAgentDir,
}));

beforeEach(() => {
  tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-brain-constitution-"));
});

afterEach(() => rmSync(tempAgentDir, { recursive: true, force: true }));

describe("Salesforce Engineering Constitution", () => {
  it("keeps the bundled constitution present with or without sf CLI", () => {
    const installed = loadConstitution({ cliInstalled: true });
    const missing = loadConstitution({ cliInstalled: false });

    expect(installed).toContain(CONSTITUTION_OPEN_TAG);
    expect(installed).toContain("SALESFORCE-FIRST INTERPRETATION");
    expect(installed).toContain("BEHAVIOR-PROOF-FIRST DEVELOPMENT");
    expect(missing).toContain(CONSTITUTION_OPEN_TAG);
    expect(missing).toContain("<sf_cli_status>");
    expect(missing).not.toContain("brew install");
    expect(CONSTITUTION_ENTRY_TYPE).toBe("sf-brain-constitution");
  });

  it("routes every tool owner directly to its manifest-declared operating guide", () => {
    const constitution = readBundledConstitution();
    const extensionsRoot = path.resolve(import.meta.dirname, "../..");
    const expected = readdirSync(extensionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) =>
        JSON.parse(readFileSync(path.join(extensionsRoot, entry.name, "manifest.json"), "utf8")),
      )
      .filter((manifest) => (manifest.tools?.length ?? 0) > 0)
      .map((manifest) => `extensions/${manifest.id}/${manifest.docs.agentGuide}`)
      .sort();
    const actual = [...constitution.matchAll(/extensions\/(sf-[a-z0-9-]+)\/(AGENT_GUIDE\.md)/g)]
      .map((match) => `extensions/${match[1]}/${match[2]}`)
      .sort();

    expect(actual).toEqual(expected);
    expect(constitution).not.toContain("SF_REFERENCE_MAP.md");
  });

  it("always keeps the bundled constitution and appends user guidance", () => {
    const dir = path.dirname(constitutionAddendumPath());
    mkdirSync(dir, { recursive: true });
    writeFileSync(constitutionAddendumPath(), "Prefer project-specific test suites.\n");

    const content = loadConstitution({ cliInstalled: true });
    expect(content).toContain(readBundledConstitution().trim());
    expect(content).toContain("<sf_user_constitution_addendum>");
    expect(content).toContain("Prefer project-specific test suites.");
  });

  it("does not read the legacy replacement-style SF_KERNEL.md", () => {
    const legacy = path.join(tempAgentDir, "sf-brain", "SF_KERNEL.md");
    mkdirSync(path.dirname(legacy), { recursive: true });
    writeFileSync(legacy, "LEGACY REPLACEMENT CONTENT\n");

    const content = loadConstitution({ cliInstalled: true });
    expect(content).not.toContain("LEGACY REPLACEMENT CONTENT");
    expect(content).toContain(CONSTITUTION_OPEN_TAG);
  });
});
