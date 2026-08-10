/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");
const CATALOG_PATH = path.join(ROOT, "catalog", "index.json");
const EXTENSION_COPY_PATH = path.join(ROOT, "docs", "extension-copy.json");
const EXTENSIONS_DOC_PATH = path.join(ROOT, "docs", "extensions.md");
const EXTENSION_DETAIL_DIR = path.join(ROOT, "docs", "extensions");
const EXTENSION_SIDEBAR_PATH = path.join(
  ROOT,
  "docs",
  ".vitepress",
  "generated-extension-sidebar.ts",
);
const VALID_INTENT_GROUPS = new Set([
  "Build agents",
  "Build apps",
  "Query data",
  "Work with Salesforce orgs",
  "Work with Data Cloud",
  "Work safely",
  "Collaborate and improve",
  "Personalize pi",
]);

// Deliberately limited to living user/operator surfaces. Historical ADRs,
// changelogs, completed plans/audits, and compatibility source stay out of this
// current-copy contract.
const CURRENT_COPY_SURFACES = [
  "README.md",
  "AGENTS.md",
  "ARCHITECTURE.md",
  "CONTRIBUTING.md",
  "catalog/index.json",
  "docs/agent-orientation.md",
  "docs/commands.md",
  "docs/extension-copy.json",
  "docs/extensions.md",
  "docs/extensions/sf-brain.md",
  "docs/extensions/sf-docs.md",
  "docs/extensions/sf-herdr.md",
  "docs/human-orientation.md",
  "extensions/sf-brain/manifest.json",
  "extensions/sf-brain/README.md",
  "extensions/sf-docs/manifest.json",
  "extensions/sf-docs/README.md",
  "extensions/sf-herdr/manifest.json",
  "extensions/sf-herdr/README.md",
  "extensions/sf-data360/README.md",
  "scripts/scaffold.mjs",
] as const;

const RETIRED_CURRENT_COPY = [
  /operator kernel/i,
  /compact reference map/i,
  /workflow profiles/i,
  /signal inference/i,
  /local credential storage/i,
  /lifecycle settings that close/i,
  /lane that closes on success/i,
  /clean themselves up/i,
  /v2 capability sweep/i,
  /plans dry-run coverage for every v2 action family/i,
  /D360_SWEEP_ALLOW_DESTRUCTIVE/,
  /--preset agentforce-stdm/i,
  /--category core/i,
  /\bd360_metadata\b/i,
  /\bd360_probe\b/i,
  /`d360`/i,
] as const;

type Manifest = {
  id: string;
  tools?: string[];
  docs?: {
    primaryFiles?: string[];
    editingRules?: string;
    agentGuide?: string;
    contextGlossary?: string;
  };
};

type ExtensionCopy = Record<string, { intentGroup?: string }>;

function readManifests(): Manifest[] {
  return readdirSync(EXTENSIONS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(path.join(EXTENSIONS_DIR, entry.name, "manifest.json"), "utf8")),
    );
}

describe("generated extension documentation contract", () => {
  it("contains exactly one browse card for every catalog extension", () => {
    const expectedIds = (JSON.parse(readFileSync(CATALOG_PATH, "utf8")) as Manifest[])
      .map((manifest) => manifest.id)
      .sort();
    const extensionsDoc = readFileSync(EXTENSIONS_DOC_PATH, "utf8");
    const cardIds = [
      ...extensionsDoc.matchAll(/<a class="sfpi-extension-card" href="\.\/extensions\/([^"/]+)">/g),
    ]
      .map((match) => match[1])
      .sort();
    const detailPageIds = readdirSync(EXTENSION_DETAIL_DIR)
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3))
      .sort();
    const sidebar = readFileSync(EXTENSION_SIDEBAR_PATH, "utf8");
    const sidebarIds = [...sidebar.matchAll(/link: "\/extensions\/([^"/]+)"/g)]
      .map((match) => match[1])
      .sort();

    expect(cardIds).toEqual(expectedIds);
    expect(new Set(cardIds).size).toBe(cardIds.length);
    expect(detailPageIds).toEqual(expectedIds);
    expect(sidebarIds).toEqual(expectedIds);
  });

  it("uses a known intent group and one copy entry for every extension", () => {
    const manifestIds = readManifests()
      .map((manifest) => manifest.id)
      .sort();
    const copy = JSON.parse(readFileSync(EXTENSION_COPY_PATH, "utf8")) as ExtensionCopy;

    expect(Object.keys(copy).sort()).toEqual(manifestIds);
    for (const [id, item] of Object.entries(copy)) {
      expect(VALID_INTENT_GROUPS.has(item.intentGroup ?? ""), `${id}.intentGroup`).toBe(true);
    }
  });

  it("resolves unique extension-relative primaryFiles within the repository root", () => {
    for (const manifest of readManifests()) {
      const extensionRoot = path.join(EXTENSIONS_DIR, manifest.id);
      const resolvedPaths = new Set<string>();
      const primaryFiles = manifest.docs?.primaryFiles;
      expect(Array.isArray(primaryFiles), `${manifest.id}: docs.primaryFiles`).toBe(true);
      expect(primaryFiles?.length ?? 0, `${manifest.id}: docs.primaryFiles`).toBeGreaterThan(0);

      for (const primaryFile of primaryFiles ?? []) {
        expect(path.isAbsolute(primaryFile), `${manifest.id}: ${primaryFile}`).toBe(false);
        const resolved = path.resolve(extensionRoot, primaryFile);
        const relativeToRoot = path.relative(ROOT, resolved);
        expect(
          relativeToRoot !== "" &&
            !relativeToRoot.startsWith(`..${path.sep}`) &&
            relativeToRoot !== "..",
          `${manifest.id}: ${primaryFile}`,
        ).toBe(true);
        expect(existsSync(resolved), `${manifest.id}: ${primaryFile}`).toBe(true);
        expect(resolvedPaths.has(resolved), `${manifest.id}: duplicate ${primaryFile}`).toBe(false);
        resolvedPaths.add(resolved);
      }
    }
  });

  it("declares every extension-local agent document by its role", () => {
    const roles = [
      ["editingRules", "AGENTS.md"],
      ["agentGuide", "AGENT_GUIDE.md"],
      ["contextGlossary", "CONTEXT.md"],
    ] as const;

    for (const manifest of readManifests()) {
      const extensionRoot = path.join(EXTENSIONS_DIR, manifest.id);
      for (const [field, relativePath] of roles) {
        const present = existsSync(path.join(extensionRoot, relativePath));
        expect(manifest.docs?.[field], `${manifest.id}: docs.${field}`).toBe(
          present ? relativePath : undefined,
        );
      }
      if ((manifest.tools?.length ?? 0) > 0) {
        expect(manifest.docs?.agentGuide, `${manifest.id}: tool operating guide`).toBe(
          "AGENT_GUIDE.md",
        );
      }
    }
  });

  it("rejects retired descriptions on current user and operator surfaces", () => {
    for (const relativePath of CURRENT_COPY_SURFACES) {
      const source = readFileSync(path.join(ROOT, relativePath), "utf8");
      for (const retiredPhrase of RETIRED_CURRENT_COPY) {
        expect(retiredPhrase.test(source), `${relativePath}: ${retiredPhrase}`).toBe(false);
      }
    }
  });
});
