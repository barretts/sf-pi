#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */

/** Static command-source checks that complement the Manager-first behavior proof. */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalog = JSON.parse(readFileSync(join(ROOT, "catalog/index.json"), "utf8"));
const forbiddenFiles = new Map([
  [
    "lib/panel.ts",
    "reserved legacy name; use lib/command-panel.ts for an explicit specialized panel",
  ],
  [
    "lib/settings-panel.ts",
    "reserved legacy name; use lib/preferences-panel.ts or the Manager config panel",
  ],
]);

function readTypeScriptFiles(directory) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...readTypeScriptFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(full);
  }
  return files;
}

function checkExtension(extension) {
  if (!Array.isArray(extension.commands) || extension.commands.length === 0) return null;
  const entryPath = join(ROOT, extension.entry);
  const extensionRoot = dirname(entryPath);
  const sources = [entryPath, ...readTypeScriptFiles(join(extensionRoot, "lib"))]
    .map((file) => readFileSync(file, "utf8"))
    .join("\n");
  const issues = [];

  if (/pi\.registerCommand\s*\(/.test(sources) && !/withSafeCommandHandler\s*\(/.test(sources)) {
    issues.push(
      "registered slash commands must use withSafeCommandHandler so failures remain visible",
    );
  }
  for (const [relativePath, reason] of forbiddenFiles) {
    if (existsSync(join(extensionRoot, relativePath))) {
      issues.push(`${relativePath}: ${reason}`);
    }
  }

  return { id: extension.id, issues };
}

const reports = catalog.map(checkExtension).filter(Boolean);
const failures = reports.filter((report) => report.issues.length > 0);
console.log(
  `Command contract check — ${reports.length - failures.length} ok, ${failures.length} violation(s)`,
);
for (const report of reports) {
  console.log(`  ${report.issues.length === 0 ? "✓" : "✗"} ${report.id}`);
  for (const issue of report.issues) console.log(`      - ${issue}`);
}
if (failures.length > 0) process.exit(1);
