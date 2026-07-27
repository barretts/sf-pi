/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { AGENT_SCRIPT_PACKAGES, collectLockedAgentScriptVersions } from "../lib/package-catalog.ts";

describe("Agent Script package coherence", () => {
  test("resolves one locked version for every package in the local toolchain", () => {
    const pkg = JSON.parse(readFileSync(path.resolve("package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    const lock = JSON.parse(readFileSync(path.resolve("package-lock.json"), "utf8")) as {
      packages?: Record<string, { version?: string }>;
    };

    const versionsByPackage = collectLockedAgentScriptVersions(lock.packages ?? {});
    for (const entry of AGENT_SCRIPT_PACKAGES) {
      expect(versionsByPackage.get(entry.name), entry.name).toHaveLength(1);
      if (entry.kind === "direct") {
        expect(pkg.dependencies?.[entry.name], `${entry.name} direct declaration`).toBeDefined();
      }
    }
  });
});
