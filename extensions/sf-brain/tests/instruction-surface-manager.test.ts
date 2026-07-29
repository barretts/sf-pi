/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";

import { buildSfBrainManagerActions } from "../lib/instruction-surface-manager.ts";

describe("SF Brain Manager actions", () => {
  it("opens a read-only Instruction Surface diagnostic panel", () => {
    const pi = {
      getAllTools: () => [{ name: "sf_apex", description: "Apex", parameters: { type: "object" } }],
    };
    const actions = buildSfBrainManagerActions(pi as never, {
      sfPiPackageRoot: "/repo",
      sfPiToolNames: ["sf_apex"],
      piRuntimeVersion: "0.82.1",
      sfPiVersion: "1.0.0",
    });

    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({
      id: "instruction-surface",
      label: "Instruction surface",
      group: "Diagnostics",
      acceptsScope: false,
    });
    expect(actions[0]?.createPanel).toBeTypeOf("function");
  });
});
