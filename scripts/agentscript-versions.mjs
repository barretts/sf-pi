#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Report the exact official AgentScript packages SF Pi uses.
 *
 * This is a maintainer convenience for intentional package refreshes. It does
 * not mutate package.json/package-lock.json; use npm install --save-exact for
 * the specific packages you choose to bump.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AGENT_SCRIPT_PACKAGES,
  collectLockedAgentScriptVersions,
} from "../extensions/sf-agentscript/lib/package-catalog.ts";
import { npmRegistryPackageUrl } from "./lib/npm-registry-url.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function declaredVersions() {
  const pkg = readJson(path.join(ROOT, "package.json"));
  return pkg.dependencies ?? {};
}

async function latestVersion(packageName) {
  try {
    const url = npmRegistryPackageUrl(packageName);
    const response = await fetch(url, { headers: { accept: "application/json" } });
    if (!response.ok) return undefined;
    const body = await response.json();
    return body?.["dist-tags"]?.latest;
  } catch {
    return undefined;
  }
}

const deps = declaredVersions();
const lock = readJson(path.join(ROOT, "package-lock.json"));
const lockedVersions = collectLockedAgentScriptVersions(lock.packages ?? {});
const rows = [];
for (const pkg of AGENT_SCRIPT_PACKAGES) {
  const declared = deps[pkg.name];
  const resolvedVersions = lockedVersions.get(pkg.name) ?? [];
  const resolved =
    resolvedVersions.length === 1 ? resolvedVersions[0] : resolvedVersions.join(", ");
  const latest = await latestVersion(pkg.name);
  rows.push({
    package: pkg.name,
    kind: pkg.kind,
    declared: declared ?? "—",
    resolved: resolved ?? "—",
    latest: typeof latest === "string" ? latest : "unknown",
    status:
      resolvedVersions.length > 1
        ? "duplicate versions"
        : typeof latest === "string" && resolved
          ? latest === resolved
            ? "current"
            : "update available"
          : "unknown",
  });
}

console.table(rows);
const coherenceIssues = rows.flatMap((row) => {
  if (row.resolved === "—") return [`${row.package} is unresolved`];
  if (row.kind === "direct" && row.declared === "—") return [`${row.package} is undeclared`];
  if (row.status === "duplicate versions") return [`${row.package} resolves ${row.resolved}`];
  return [];
});
console.log(
  coherenceIssues.length === 0
    ? "\nPackage coherence: current graph resolves one version per package."
    : `\nPackage coherence issues: ${coherenceIssues.join("; ")}`,
);
if (coherenceIssues.length > 0) process.exitCode = 1;
console.log("\nIntentional refresh workflow:");
console.log(
  "  npm install --save-exact @sf-agentscript/agentforce@<version> @sf-agentscript/language@<version> @sf-agentscript/lsp@<version>",
);
console.log("  npm run check && npm test && npm run generate-catalog:check");
console.log("\nNote: @sf-agentscript/compiler is transitive through @sf-agentscript/agentforce.");
