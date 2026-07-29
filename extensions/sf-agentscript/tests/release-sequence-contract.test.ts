/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const lifecycleSource = readFileSync(
  path.resolve(import.meta.dirname, "../lib/lifecycle-tool.ts"),
  "utf8",
);
const evalSource = readFileSync(path.resolve(import.meta.dirname, "../lib/eval-tool.ts"), "utf8");

describe("Agent Script Release Sequence wiring", () => {
  it("publishes inactive and gates separate activation on exact-version evidence", () => {
    expect(lifecycleSource).not.toContain("input.activate");
    expect(lifecycleSource).not.toMatch(/activate:\s*Type\.Optional/);
    expect(lifecycleSource).toContain("evaluateActivationEvidence");
    expect(lifecycleSource).toContain("acknowledge_untested_activation");
    expect(lifecycleSource).toContain('action: "run_release"');
  });

  it("offers a generated-baseline plus designated-suite release eval action", () => {
    expect(evalSource).toContain('Type.Literal("run_release")');
    expect(evalSource).toContain('release_contract_kind: "generated_baseline"');
    expect(evalSource).toContain('release_contract_kind: "designated"');
    expect(evalSource).toContain("tests/agentforce/<AgentApiName>.eval.json");
  });
});
