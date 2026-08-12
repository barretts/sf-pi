/* SPDX-License-Identifier: Apache-2.0 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("ESLint rule promotions", () => {
  it("treats useless assignments as errors", async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const config = await eslint.calculateConfigForFile(
      path.join(ROOT, "extensions/sf-data360/lib/v2/dispatcher.ts"),
    );

    expect(config?.rules?.["no-useless-assignment"]?.[0]).toBe(2);
  });
});
