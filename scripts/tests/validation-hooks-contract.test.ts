/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseArgsStringToArgv } from "string-argv";
import lintStagedConfig from "../../.lintstagedrc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function read(relativePath: string): string {
  return readFileSync(path.join(ROOT, relativePath), "utf8");
}

describe("generated-artifact validation hooks", () => {
  it("keeps staged hygiene fixes without generating or staging catalog outputs", () => {
    const typescriptTask = lintStagedConfig["*.{ts,mjs,js}"];
    const commands = typescriptTask(["example.ts"]);
    const configSource = read(".lintstagedrc.mjs");

    expect(commands).toEqual([
      "node scripts/add-spdx-headers.mjs 'example.ts'",
      "prettier --write 'example.ts'",
      "eslint --fix 'example.ts'",
    ]);
    expect(configSource).not.toContain("GENERATED_PATHS");
    expect(configSource).not.toMatch(/npm run generate-catalog(?!:check)/);
    expect(configSource).not.toContain("git add");
  });

  it("quotes string-argv paths containing spaces and embedded quotes", () => {
    const typescriptTask = lintStagedConfig["*.{ts,mjs,js}"];
    const paths = ['folder/example "draft".ts', "folder/agent's notes.ts"];
    const commands = typescriptTask(paths);
    const quotedPaths = `'folder/example "draft".ts' "folder/agent's notes.ts"`;

    expect(commands).toEqual([
      `node scripts/add-spdx-headers.mjs ${quotedPaths}`,
      `prettier --write ${quotedPaths}`,
      `eslint --fix ${quotedPaths}`,
    ]);
    for (const command of commands) {
      expect(parseArgsStringToArgv(command).slice(-2)).toEqual(paths);
    }
    expect(() => typescriptTask([`folder/both'"quotes.ts`])).toThrow(
      "Cannot safely pass a path containing both quote styles",
    );
  });

  it("checks generated catalog drift during local validation", () => {
    const validation = read("scripts/validate.sh");

    expect(validation).toContain('banner "Check generated catalog"');
    expect(validation).toContain("npm run generate-catalog:check --silent");
    expect(validation).not.toMatch(/node scripts\/generate-catalog\.mjs\s*(?:\n|$)/);
  });

  it("runs one unconditional staged-snapshot catalog check after lint-staged", () => {
    const hook = read(".husky/pre-commit");
    const lintStagedIndex = hook.indexOf("npx lint-staged");
    const checkCommand = "npm run generate-catalog:check-staged --silent";
    const checkIndex = hook.indexOf(checkCommand);

    expect(lintStagedIndex).toBeGreaterThan(-1);
    expect(checkIndex).toBeGreaterThan(lintStagedIndex);
    expect(hook.split(checkCommand)).toHaveLength(2);
    expect(hook).not.toContain("npm run generate-catalog:check --silent");
    expect(hook).not.toMatch(/npm run generate-catalog(?!:check)/);
    expect(hook).not.toContain("git add");
    expect(hook).not.toContain("git diff --cached --name-only");
  });

  it("materializes and checks the Git index with the staged generator copy", () => {
    const checker = read("scripts/check-staged-catalog.mjs");

    expect(checker).toContain('"checkout-index", "--all", "--force"');
    expect(checker).toContain('path.join(snapshotRoot, "scripts", "generate-catalog.mjs")');
    expect(checker).toContain('[stagedGenerator, "--check"]');
    expect(checker).toContain('path.join(stagedNodeModules, "prettier")');
  });
});
