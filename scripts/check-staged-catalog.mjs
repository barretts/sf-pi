/* SPDX-License-Identifier: Apache-2.0 */
// Validate generated catalog artifacts from the Git index, not from unstaged
// working-tree files. The index is exported to an isolated temporary root and
// the staged generator copy runs there in --check mode.

import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_EXECUTION_MS = 120_000;

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    encoding: "utf8",
    maxBuffer: MAX_OUTPUT_BYTES,
    timeout: MAX_EXECUTION_MS,
    ...options,
  });
}

function forward(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(`❌ ${result.error.message}`);
}

const rootResult = run("git", ["rev-parse", "--show-toplevel"]);
if (rootResult.status !== 0) {
  forward(rootResult);
  process.exit(1);
}

const gitRoot = rootResult.stdout.trim();
const snapshotRoot = mkdtempSync(path.join(tmpdir(), "sf-pi-staged-catalog-"));

try {
  const checkout = run(
    "git",
    ["checkout-index", "--all", "--force", `--prefix=${snapshotRoot}${path.sep}`],
    { cwd: gitRoot },
  );
  if (checkout.status !== 0) {
    forward(checkout);
    process.exitCode = 1;
  } else {
    const stagedGenerator = path.join(snapshotRoot, "scripts", "generate-catalog.mjs");
    if (!existsSync(stagedGenerator)) {
      console.error("❌ Staged snapshot is missing scripts/generate-catalog.mjs");
      process.exitCode = 1;
    } else {
      // Prettier is the generator's only package import. Link only that local
      // dependency into the snapshot; generator inputs still come from Git.
      const requireFromRepository = createRequire(path.join(gitRoot, "package.json"));
      const prettierRoot = path.dirname(requireFromRepository.resolve("prettier/package.json"));
      const stagedNodeModules = path.join(snapshotRoot, "node_modules");
      mkdirSync(stagedNodeModules, { recursive: true });
      symlinkSync(
        prettierRoot,
        path.join(stagedNodeModules, "prettier"),
        process.platform === "win32" ? "junction" : "dir",
      );

      const env = { ...process.env };
      delete env.SF_PI_GENERATE_CATALOG_ROOT;
      const checked = run(process.execPath, [stagedGenerator, "--check"], {
        cwd: snapshotRoot,
        env,
      });
      forward(checked);
      process.exitCode = checked.status === 0 ? 0 : 1;
    }
  }
} finally {
  rmSync(snapshotRoot, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}
