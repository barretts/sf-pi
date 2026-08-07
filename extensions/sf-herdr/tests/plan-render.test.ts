/* SPDX-License-Identifier: Apache-2.0 */
/** Public planner behavior proofs for the current split Herdr tools. */
import { describe, expect, it, vi } from "vitest";

import {
  buildSfHerdrPlan,
  registerSfHerdrPlanTool,
  renderSfHerdrPlan,
} from "../lib/sf_herdr_plan-tool.ts";
import { DEFAULT_SF_HERDR_SETTINGS } from "../lib/settings.ts";

type CapturedTool = {
  execute: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: { plan: { steps: Array<Record<string, unknown>> } };
  }>;
};

describe("sf_herdr_plan", () => {
  it("returns current tool/action steps that pass the opaque split-pane result forward", async () => {
    let tool: CapturedTool | undefined;
    registerSfHerdrPlanTool({
      registerTool: vi.fn((definition) => (tool = definition as CapturedTool)),
    } as never);

    const result = await tool!.execute("plan-1", {
      intent: "verify",
      primaryWorkflow: "generic",
    });
    const steps = result.details.plan.steps;

    expect(steps.map(({ tool, action }) => [tool, action])).toEqual([
      ["herdr_layout", "pane_split"],
      ["herdr_pane", "run"],
      ["herdr_pane", "wait_output"],
      ["herdr_pane", "close"],
    ]);
    expect(steps[0]).toMatchObject({
      id: "split",
      tool: "herdr_layout",
      action: "pane_split",
      arguments: { focus: false },
    });
    expect(
      steps
        .slice(1)
        .map((step) => (step.argumentBindings as Record<string, unknown> | undefined)?.pane),
    ).toEqual([
      { stepId: "split", path: "details.pane.pane_id" },
      { stepId: "split", path: "details.pane.pane_id" },
      { stepId: "split", path: "details.pane.pane_id" },
    ]);
    expect(steps.at(-1)).toMatchObject({ when: "observed_success_only" });
    expect(JSON.stringify(result)).not.toContain('"tool":"herdr"');
    expect(JSON.stringify(result)).not.toContain("<shortid>");
    expect(result.content[0]?.text).toContain("1. herdr_layout.pane_split · focus=false");
    expect(result.content[0]?.text).toContain(
      "2. herdr_pane.run · pane←split.details.pane.pane_id · caller supplies command",
    );
    expect(result.content[0]?.text).toContain(
      "3. herdr_pane.wait_output · source=recent-unwrapped · pane←split.details.pane.pane_id",
    );
    expect(result.content[0]?.text).not.toContain("herdr_pane.read");
  });

  it("uses herdr_agent for review lanes and keeps the default manual pane open", async () => {
    let tool: CapturedTool | undefined;
    registerSfHerdrPlanTool({
      registerTool: vi.fn((definition) => (tool = definition as CapturedTool)),
    } as never);

    const result = await tool!.execute("plan-2", {
      intent: "review",
      primaryWorkflow: "apex",
    });

    expect(result.details.plan.steps.map(({ tool, action }) => [tool, action])).toEqual([
      ["herdr_layout", "pane_split"],
      ["herdr_agent", "start"],
      ["herdr_agent", "prompt"],
      ["herdr_agent", "read"],
    ]);
    expect(result.details.plan.steps.some((step) => step.action === "close")).toBe(false);
    expect(result.content[0]?.text).toContain(
      "manual lifecycle; leave open until explicit cleanup",
    );
  });

  it("applies explicit split direction and lifecycle settings without aliases", () => {
    const plan = buildSfHerdrPlan(
      {
        ...DEFAULT_SF_HERDR_SETTINGS,
        splitDirection: "down",
        lifecycleByIntent: {
          ...DEFAULT_SF_HERDR_SETTINGS.lifecycleByIntent,
          verify: "sticky",
        },
      },
      { intent: "verify", primaryWorkflow: "generic" },
    );

    expect(plan.lifecycle).toBe("sticky");
    expect(plan.steps[0]).toMatchObject({
      tool: "herdr_layout",
      action: "pane_split",
      arguments: { focus: false, direction: "down" },
    });
    expect(plan.steps.some((step) => step.action === "close")).toBe(false);
    expect(renderSfHerdrPlan(plan)).toContain(
      "herdr_layout.pane_split · focus=false · direction=down",
    );
    expect(JSON.stringify(plan)).not.toContain("alias");
  });
});
