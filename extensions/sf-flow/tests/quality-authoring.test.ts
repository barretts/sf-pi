/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it } from "vitest";
import { buildAuthoringPlan } from "../lib/author.ts";

describe("preventive Flow authoring constraints", () => {
  it("compiles family-aware generation rules into the initial blueprint", async () => {
    const result = await buildAuthoringPlan(
      {
        action: "author.plan",
        intent: "When an account is updated, update a related record after save",
        flow_type: "record-triggered",
        trigger_timing: "after-save",
        record_event: "update",
        object: "Account",
      },
      process.cwd(),
    );
    const constraints = result.details.generation_constraints as Array<{ rule_id: string }>;
    const ids = constraints.map((constraint) => constraint.rule_id);

    expect(ids).toEqual(
      expect.arrayContaining([
        "missing-record-trigger-filter",
        "recursive-record-update",
        "dml-in-loop",
        "hardcoded-id",
      ]),
    );
    expect(result.content[0]?.text).toContain("Preventive Rules");
  });
});
