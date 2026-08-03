/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function source(relativePath: string): string {
  return readFileSync(path.resolve(import.meta.dirname, relativePath), "utf8");
}

const lifecycleRegistration = source("../lib/lifecycle-tool.ts");
const lifecycleRelease = source("../lib/lifecycle/actions/release.ts");
const evalRegistration = source("../lib/eval-tool.ts");
const evalRun = source("../lib/eval/actions/run.ts");

describe("Agent Script Release Sequence wiring", () => {
  it("publishes inactive and gates separate activation on exact-version evidence", () => {
    expect(lifecycleRegistration).not.toContain("input.activate");
    expect(lifecycleRegistration).not.toMatch(/activate:\s*Type\.Optional/);
    expect(lifecycleRelease).toContain("evaluateActivationEvidence");
    expect(lifecycleRegistration).toContain("acknowledge_untested_activation");
    expect(lifecycleRelease).toContain('action: "run_release"');
  });

  it("offers a generated-baseline plus designated-suite release eval action", () => {
    expect(evalRegistration).toContain('Type.Literal("run_release")');
    expect(evalRun).toContain('release_contract_kind: "generated_baseline"');
    expect(evalRun).toContain('release_contract_kind: "designated"');
    expect(evalRegistration).toContain("tests/agentforce/<AgentApiName>.eval.json");
  });
});
