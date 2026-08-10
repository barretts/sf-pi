/* SPDX-License-Identifier: Apache-2.0 */
/**
 * lint-staged configuration.
 *
 * For `*.{ts,mjs,js}` we run, in order:
 *   1. add-spdx-headers on the staged files (auto-add missing headers)
 *   2. prettier --write
 *   3. eslint --fix
 *
 * Why SPDX runs first: CI's Validate job runs `spdx:check` which fails
 * the whole pipeline on any missing header. Catching it at pre-commit is
 * much cheaper than a red CI run + fix commit + release PR rebase.
 * Running the auto-add variant (not --check) means the developer doesn't
 * have to fix it by hand — lint-staged re-stages modified files
 * automatically, so the header lands in the same commit.
 *
 * Generated artifacts are never repaired or staged here. The outer
 * pre-commit hook validates the staged catalog snapshot after these fixes,
 * when lint-staged has re-staged its source changes.
 */

function quoteArg(value) {
  // string-argv does not implement backslash escapes. Pick the quote style
  // absent from the path; failing is safer than silently splitting a rare
  // filename containing both quote characters.
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  throw new Error(`Cannot safely pass a path containing both quote styles: ${value}`);
}

export default {
  "*.{ts,mjs,js}": (files) => {
    const paths = files.map(quoteArg).join(" ");
    return [
      // Auto-add SPDX headers to any staged .ts/.mjs that lacks one. The
      // script is idempotent and scoped to the given paths, so files that
      // already have the header are no-ops. .js is skipped by the script's
      // internal EXTS set, which matches our repo convention.
      `node scripts/add-spdx-headers.mjs ${paths}`,
      `prettier --write ${paths}`,
      `eslint --fix ${paths}`,
    ];
  },
  "*.{json,md,yml,yaml}": (files) => [`prettier --write ${files.map(quoteArg).join(" ")}`],
};
