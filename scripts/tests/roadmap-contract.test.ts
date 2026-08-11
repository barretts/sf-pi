/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function roadmapPaths(): string[] {
  const paths = ["ROADMAP.md"];
  const extensionsDir = path.join(ROOT, "extensions");
  for (const entry of readdirSync(extensionsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const relative = `extensions/${entry.name}/ROADMAP.md`;
    if (existsSync(path.join(ROOT, relative))) paths.push(relative);
  }
  return paths.sort();
}

describe("active roadmap contract", () => {
  for (const relativePath of roadmapPaths()) {
    it(relativePath, () => {
      const source = readFileSync(path.join(ROOT, relativePath), "utf8");

      expect(source).toMatch(/^## Now(?:\s|—|$)/m);
      expect(source).toMatch(/^## Non-goals\s*$/m);
      expect(source).not.toMatch(/^##\s+(?:Shipped|Completed|Delivered)\b/im);
      expect(source).not.toMatch(/^\s*-\s*\[[xX~]\]/m);
    });
  }
});
