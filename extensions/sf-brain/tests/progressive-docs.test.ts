/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const guideOwners = [
  "sf-brain",
  "sf-agentscript",
  "sf-apex",
  "sf-soql",
  "sf-lwc",
  "sf-browser",
  "sf-code-analyzer",
  "sf-data360",
  "sf-docs",
  "sf-slack",
  "sf-tldraw",
  "sf-herdr",
];

describe("Progressive SF Pi Documentation", () => {
  it("keeps agent guides beside their owning extensions and removes bundled skill routing", () => {
    for (const owner of guideOwners) {
      const guide = path.join(repoRoot, "extensions", owner, "AGENT_GUIDE.md");
      expect(existsSync(guide), guide).toBe(true);
      expect(readFileSync(guide, "utf8")).toMatch(/^# /);
    }
    expect(existsSync(path.join(repoRoot, "extensions", "sf-brain", "SF_REFERENCE_MAP.md"))).toBe(
      false,
    );
    expect(existsSync(path.join(repoRoot, "extensions", "sf-browser", "skills"))).toBe(false);
    expect(existsSync(path.join(repoRoot, "extensions", "sf-agentscript", "skills"))).toBe(false);
  });
});
