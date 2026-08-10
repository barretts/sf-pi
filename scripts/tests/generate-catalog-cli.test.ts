/* SPDX-License-Identifier: Apache-2.0 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const GENERATOR_PATH = path.join(REPOSITORY_ROOT, "scripts", "generate-catalog.mjs");

const BASE_MANIFEST = {
  id: "alpha",
  name: "Alpha",
  description: "A minimal fixture extension.",
  category: "ui",
  defaultEnabled: true,
  docs: {
    summary: "Minimal fixture extension for catalog generation.",
    primaryFiles: ["index.ts"],
  },
};

function validCopy() {
  return {
    shortName: "Alpha",
    intentGroup: "Personalize pi",
    promise: "Provide a minimal fixture.",
    bestFor: "Catalog tests.",
    benefits: ["Small and deterministic."],
    useCases: ["Exercise catalog generation."],
    whatYouGet: ["One fixture extension."],
    tryFirst: { label: "Open Alpha", code: "/alpha" },
  };
}

type GeneratorResult = ReturnType<typeof spawnSync>;
type Manifest = typeof BASE_MANIFEST & Record<string, unknown>;

const MAX_EXECUTION_MS = 120_000;
let root: string;

function writeText(relativePath: string, contents: string): void {
  const absolutePath = path.join(root, relativePath);
  const parent = path.dirname(absolutePath);
  mkdirSync(parent, { recursive: true });
  writeFileSync(absolutePath, contents, "utf8");
}

function writeJson(relativePath: string, value: unknown): void {
  writeText(relativePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createExtension(directory: string, manifest: Manifest): void {
  writeText(`extensions/${directory}/index.ts`, "export default function alpha() {}\n");
  writeJson(`extensions/${directory}/manifest.json`, manifest);
}

function writePackage(entries: unknown = ["./extensions/alpha/index.ts"]): void {
  writeJson("package.json", { pi: { extensions: entries } });
}

function writeCopy(copy: Record<string, unknown>): void {
  writeJson("docs/extension-copy.json", copy);
}

function createFixture(): void {
  writePackage();
  createExtension("alpha", { ...BASE_MANIFEST });
  writeCopy({ alpha: validCopy() });
  writeText(
    "README.md",
    [
      "# Fixture",
      "",
      "<!-- GENERATED:bundled-extensions:start -->",
      "stale",
      "<!-- GENERATED:bundled-extensions:end -->",
      "",
      "<!-- GENERATED:command-reference:start -->",
      "stale",
      "<!-- GENERATED:command-reference:end -->",
      "",
    ].join("\n"),
  );
  writeText(
    "ARCHITECTURE.md",
    [
      "# Architecture",
      "",
      "<!-- GENERATED:folder-layout:start -->",
      "stale",
      "<!-- GENERATED:folder-layout:end -->",
      "",
    ].join("\n"),
  );
  writeText(
    "docs/troubleshooting.md",
    [
      "# Troubleshooting",
      "",
      "<!-- GENERATED:extension-troubleshooting-index:start -->",
      "stale",
      "<!-- GENERATED:extension-troubleshooting-index:end -->",
      "",
    ].join("\n"),
  );
  writeText("catalog/.keep", "fixture\n");
  writeText("docs/.vitepress/.keep", "fixture\n");
}

function runGenerator(args: string[] = []): GeneratorResult {
  return spawnSync(process.execPath, [GENERATOR_PATH, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    timeout: MAX_EXECUTION_MS,
    env: {
      ...process.env,
      NODE_ENV: "test",
      SF_PI_GENERATE_CATALOG_ROOT: root,
    },
  });
}

function output(result: GeneratorResult): string {
  return `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
}

function expectFailure(fragment: string): void {
  const before = snapshotTree();
  const result = runGenerator();
  expect(result.status, output(result)).toBe(1);
  expect(output(result)).toContain(fragment);
  expect(snapshotTree()).toEqual(before);
  expect(existsSync(path.join(root, "catalog/index.json"))).toBe(false);
}

function snapshotTree(): Record<string, string> {
  const snapshot: Record<string, string> = {};
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const absolutePath = path.join(directory, entry.name);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
      if (entry.isDirectory()) {
        snapshot[`${relativePath}/`] = "directory";
        walk(absolutePath);
      } else if (entry.isFile()) {
        snapshot[relativePath] = readFileSync(absolutePath).toString("base64");
      }
    }
  };
  walk(root);
  return snapshot;
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "sf-pi-catalog-"));
  createFixture();
});

afterEach(() => {
  rmSync(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
});

describe("generate-catalog CLI", () => {
  it("writes generated outputs for a valid minimal root", () => {
    const result = runGenerator();

    expect(result.status, output(result)).toBe(0);
    const catalog = JSON.parse(readFileSync(path.join(root, "catalog/index.json"), "utf8")) as {
      id: string;
    }[];
    expect(catalog.map((entry) => entry.id)).toEqual(["alpha"]);
    expect(existsSync(path.join(root, "docs/extensions/alpha.md"))).toBe(true);
  });

  it("fails closed when an extension manifest is missing", () => {
    createExtension("beta", { ...BASE_MANIFEST, id: "beta", name: "Beta" });
    writePackage(["./extensions/beta/index.ts"]);
    writeCopy({ beta: validCopy() });
    unlinkSync(path.join(root, "extensions/alpha/manifest.json"));
    expectFailure("extensions/alpha/manifest.json is missing");
  });

  it("fails closed when an extension entry point is missing", () => {
    createExtension("beta", { ...BASE_MANIFEST, id: "beta", name: "Beta" });
    writePackage(["./extensions/beta/index.ts"]);
    writeCopy({ beta: validCopy() });
    unlinkSync(path.join(root, "extensions/alpha/index.ts"));
    expectFailure("extensions/alpha/index.ts is missing");
  });

  it("reports malformed manifest JSON without relabeling later validation", () => {
    writeText("extensions/alpha/manifest.json", "{ not json\n");
    expectFailure("extensions/alpha/manifest.json is not valid JSON");
  });

  it.each([
    ["id", { id: undefined }, "required field id"],
    ["name", { name: "" }, "required field name"],
    ["description", { description: 42 }, "required field description"],
    ["category", { category: "" }, "required field category"],
    ["defaultEnabled missing", { defaultEnabled: undefined }, "required field defaultEnabled"],
    ["defaultEnabled invalid", { defaultEnabled: "yes" }, "required field defaultEnabled"],
  ])("rejects an invalid %s field", (_label, overrides, fragment) => {
    writeJson("extensions/alpha/manifest.json", { ...BASE_MANIFEST, ...overrides });
    expectFailure(fragment);
  });

  it("rejects duplicate manifest ids before directory mismatch", () => {
    createExtension("beta", { ...BASE_MANIFEST });
    writePackage(["./extensions/alpha/index.ts", "./extensions/beta/index.ts"]);
    writeCopy({ alpha: validCopy(), beta: validCopy() });
    expectFailure('duplicate manifest id "alpha"');
  });

  it("finds duplicate ids globally before an earlier directory mismatch", () => {
    createExtension("beta", { ...BASE_MANIFEST, id: "zeta", name: "Zeta" });
    writeJson("extensions/alpha/manifest.json", { ...BASE_MANIFEST, id: "zeta" });
    writePackage(["./extensions/alpha/index.ts", "./extensions/beta/index.ts"]);
    writeCopy({ zeta: validCopy() });
    expectFailure('duplicate manifest id "zeta"');
  });

  it("rejects a manifest id that differs from its directory", () => {
    rmSync(path.join(root, "extensions/alpha"), { recursive: true });
    createExtension("beta", { ...BASE_MANIFEST });
    writePackage(["./extensions/beta/index.ts"]);
    writeCopy({ alpha: validCopy() });
    expectFailure('manifest id "alpha" does not match directory "beta"');
  });

  it("rejects extension-copy entries without a discovered extension", () => {
    writeCopy({ alpha: validCopy(), ghost: validCopy() });
    expectFailure("entries with no discovered manifest: ghost");
  });

  it("rejects a missing extension-copy entry", () => {
    writeCopy({});
    expectFailure("extension-copy.json is missing alpha");
  });

  it.each([
    ["malformed JSON", "{ invalid\n", "docs/extension-copy.json is not valid JSON"],
    ["null", "null\n", "docs/extension-copy.json must contain a JSON object"],
    ["an array", "[]\n", "docs/extension-copy.json must contain a JSON object"],
  ])("rejects extension-copy containing %s", (_label, contents, fragment) => {
    writeText("docs/extension-copy.json", contents);
    expectFailure(fragment);
  });

  it("rejects an explicitly empty maturity", () => {
    writeJson("extensions/alpha/manifest.json", { ...BASE_MANIFEST, maturity: "" });
    expectFailure('invalid maturity ""');
  });

  it.each([
    ["empty", [], "docs.primaryFiles (non-empty string[])"],
    ["non-string", [42], "must contain only non-empty strings"],
    ["absolute", [path.resolve(path.sep, "outside.ts")], "must be extension-relative"],
    ["escaping", ["../../../outside.ts"], "escapes the repository root"],
    ["missing", ["missing.ts"], "does not exist"],
    ["normalized duplicate", ["index.ts", "./index.ts"], "contains duplicate path"],
  ])("rejects %s docs.primaryFiles", (_label, primaryFiles, fragment) => {
    writeJson("extensions/alpha/manifest.json", {
      ...BASE_MANIFEST,
      docs: { ...BASE_MANIFEST.docs, primaryFiles },
    });
    expectFailure(fragment);
  });

  it.each([
    ["missing", { pi: {} }],
    ["non-array", { pi: { extensions: "./extensions/alpha/index.ts" } }],
  ])("rejects a %s package.json pi.extensions inventory", (_label, pkg) => {
    writeJson("package.json", pkg);
    expectFailure("package.json pi.extensions must be an array");
  });

  it("reports a discovered entry missing from package.json", () => {
    writePackage([]);
    expectFailure("missing discovered entries: ./extensions/alpha/index.ts");
  });

  it("reports a package-only entry", () => {
    writePackage(["./extensions/alpha/index.ts", "./extensions/ghost/index.ts"]);
    expectFailure("package-only entries: ./extensions/ghost/index.ts");
  });

  it("rejects duplicate package extension paths", () => {
    writePackage(["./extensions/alpha/index.ts", "./extensions/alpha/index.ts"]);
    expectFailure("duplicate pi.extensions entry: ./extensions/alpha/index.ts");
  });

  it("rejects noncanonical package extension paths", () => {
    writePackage(["extensions/alpha/index.ts"]);
    expectFailure("noncanonical pi.extensions entry: extensions/alpha/index.ts");
  });

  it.each([
    ["recommendations", "catalog/recommendations.json"],
    ["announcements", "catalog/announcements.json"],
  ])("rejects malformed late %s input before changing outputs", (_label, relativePath) => {
    writeText(relativePath, "{ invalid\n");
    expectFailure(`${relativePath} is not valid JSON`);
  });

  it.each([
    ["recommendations", "catalog/recommendations.json"],
    ["announcements", "catalog/announcements.json"],
  ])("rejects invalid late %s structure before changing outputs", (_label, relativePath) => {
    writeJson(relativePath, {});
    expectFailure(`${relativePath} is invalid`);
  });

  it("preflights all required marker pairs before changing outputs", () => {
    writeText(
      "ARCHITECTURE.md",
      "# Architecture\n\n<!-- GENERATED:folder-layout:start -->\nstale\n",
    );
    expectFailure("ARCHITECTURE.md is missing markers");
  });

  it("preflights marker pairs in existing extension READMEs", () => {
    writeText("extensions/alpha/README.md", "# Alpha\n");
    expectFailure("extensions/alpha/README.md is missing markers");
  });

  it("does not change any fixture path or bytes in --check mode", () => {
    expect(existsSync(path.join(root, "docs/extensions"))).toBe(false);
    const before = snapshotTree();

    const result = runGenerator(["--check"]);

    expect(result.status, output(result)).toBe(1);
    expect(output(result)).toContain("docs/extensions directory is missing");
    expect(snapshotTree()).toEqual(before);
    expect(existsSync(path.join(root, "docs/extensions"))).toBe(false);
    expect(statSync(path.join(root, "catalog/.keep")).isFile()).toBe(true);
  });
});
