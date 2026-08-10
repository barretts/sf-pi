/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const extensionsRoot = path.join(repoRoot, "extensions");

type Manifest = {
  id: string;
  tools?: string[];
  docs?: {
    editingRules?: string;
    agentGuide?: string;
    contextGlossary?: string;
  };
};

function manifests(): Manifest[] {
  return readdirSync(extensionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) =>
      JSON.parse(readFileSync(path.join(extensionsRoot, entry.name, "manifest.json"), "utf8")),
    );
}

describe("Progressive SF Pi Documentation", () => {
  it("declares every extension-local agent document in its manifest", () => {
    for (const manifest of manifests()) {
      for (const field of ["editingRules", "agentGuide", "contextGlossary"] as const) {
        const relativePath = manifest.docs?.[field];
        if (!relativePath) continue;
        const file = path.join(extensionsRoot, manifest.id, relativePath);
        expect(existsSync(file), `${manifest.id}: docs.${field}`).toBe(true);
        expect(readFileSync(file, "utf8"), file).toMatch(/^# /);
      }
      if ((manifest.tools?.length ?? 0) > 0) {
        expect(manifest.docs?.agentGuide, `${manifest.id}: tool operating guide`).toBe(
          "AGENT_GUIDE.md",
        );
      }
    }
  });

  it("keeps retired bundled skill/reference routing absent", () => {
    expect(existsSync(path.join(extensionsRoot, "sf-brain", "SF_REFERENCE_MAP.md"))).toBe(false);
    expect(existsSync(path.join(extensionsRoot, "sf-browser", "skills"))).toBe(false);
    expect(existsSync(path.join(extensionsRoot, "sf-agentscript", "skills"))).toBe(false);
  });
});
