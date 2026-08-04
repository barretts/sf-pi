/* SPDX-License-Identifier: Apache-2.0 */
import { visibleWidth } from "@earendil-works/pi-tui";
import { describe, expect, it, vi } from "vitest";
import { EvalStudioComponent } from "../lib/eval-studio/component.ts";
import type { StudioInventory } from "../lib/eval-studio/types.ts";
import { buildLlmResponseSequence } from "../lib/llm-response-sequence.ts";

const theme = {
  fg: (_name: string, value: string) => value,
  bold: (value: string) => value,
} as never;
const glyphs = {
  mode: "ascii",
  agent: "a",
  actions: ">",
  automation: "o",
  codeAnalyzer: "ca",
  controls: "o",
  data: "d",
  discovery: "?",
  evidence: "#",
  info: "i",
  lifecycle: "-",
  loading: "~",
  reference: "?",
  safety: "!",
  scope: "#",
  selected: ">",
  selectedRow: ">",
  status: "*",
  success: "+",
  warning: "!",
  error: "x",
} as never;

function inventory(): StudioInventory {
  return {
    issues: [],
    unassigned_runs: [],
    suites: [
      {
        id: "tests/agentforce/Demo.eval.json",
        path: "/project/tests/agentforce/Demo.eval.json",
        display_name: "Demo",
        agent_api_name: "Demo",
        designated: true,
        source_digest: "abc",
        runs: [],
        projection: {
          projectable: true,
          issues: [],
          scenarios: [
            {
              id: "greeting",
              name: "greeting",
              source_index: 0,
              projectable: true,
              blocking_issues: [],
              turns: [{ id: "turn", utterance: "Hello" }],
              evaluators: [
                {
                  id: "ok",
                  type: "evaluator.string_assertion",
                  label: "String assertion",
                  capability: "live_proven",
                  scope: "turn",
                  turn_id: "turn",
                  expected: "greets the user",
                },
              ],
              seeds: [],
              checkpoints: [],
            },
          ],
        },
      },
    ],
  };
}

describe("Eval Studio component", () => {
  it("keeps every rendered line within narrow, normal, and wide widths", () => {
    const component = new EvalStudioComponent(theme, inventory(), glyphs, vi.fn());
    component.setTerminalRows(28);
    for (const width of [64, 80, 96, 144, 220]) {
      const lines = component.render(width);
      expect(lines.length).toBeLessThanOrEqual(28);
      expect(lines.every((line) => visibleWidth(line) === width)).toBe(true);
      expect(lines[0]).toContain("╭");
      expect(lines.at(-1)).toContain("╯");
    }
  });

  it("keeps priority columns and ellipsizes long Unicode names responsively", () => {
    const data = inventory();
    data.suites[0].display_name =
      "重要な顧客対応フロー-with-a-very-long-suite-name-that-must-not-shift-columns";
    const component = new EvalStudioComponent(theme, data, glyphs, vi.fn());
    const medium = component.render(96).join("\n");
    expect(medium).toContain("Source");
    expect(medium).toContain("designated");
    expect(medium).not.toContain("Agent API Name");
    expect(medium).toContain("…");
  });

  it("keeps the selected row visible when the table exceeds the viewport", () => {
    const data = inventory();
    const base = data.suites[0];
    data.suites = Array.from({ length: 30 }, (_, index) => ({
      ...structuredClone(base),
      id: `suite-${index}`,
      path: `/project/tests/agentforce/Demo.${index}.eval.json`,
      display_name: `Suite-${index}`,
    }));
    const component = new EvalStudioComponent(theme, data, glyphs, vi.fn());
    component.setTerminalRows(24);
    for (let index = 0; index < 20; index++) component.handleInput("j");
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("Suite-20");
    expect(rendered).toContain("more above");
    expect(rendered).toContain("more below");
  });

  it("reserves headroom so the overlay never clips its bottom border", () => {
    const component = new EvalStudioComponent(theme, inventory(), glyphs, vi.fn(), () => 50);
    expect(component.render(180).length).toBeLessThanOrEqual(46);
    expect(component.render(180).at(-1)).toContain("╯");
  });

  it("uses theme colors and semantic icons for prominent hierarchy", () => {
    const colorTheme = {
      fg: (name: string, value: string) =>
        `\u001b[3${name === "toolTitle" ? "5" : name === "success" ? "2" : "6"}m${value}\u001b[0m`,
      bold: (value: string) => `\u001b[1m${value}\u001b[0m`,
    } as never;
    const component = new EvalStudioComponent(colorTheme, inventory(), glyphs, vi.fn());
    const lines = component.render(180);
    expect(lines.every((line) => visibleWidth(line) === 180)).toBe(true);
    const rendered = lines.join("\n");
    expect(rendered).toContain("\u001b[35m");
    expect(rendered).toContain("a Agent Script Eval Studio");
    expect(rendered).toContain("+");
  });

  it("drills Agent → Suite → Scenario and returns a Scenario Run intent", () => {
    const done = vi.fn();
    const component = new EvalStudioComponent(theme, inventory(), glyphs, done);
    component.handleInput("\r");
    expect(component.render(100).join("\n")).toContain("Agents / Demo");
    component.handleInput("\r");
    expect(component.render(100).join("\n")).toContain("Agents / Demo / greeting");
    component.handleInput("r");
    expect(done).toHaveBeenCalledWith({
      kind: "run_scenario",
      suite_path: "/project/tests/agentforce/Demo.eval.json",
      scenario_id: "greeting",
    });
  });

  it("selects a historical Run for Run Source and Executed evidence", () => {
    const data = inventory();
    data.suites[0].runs = [
      {
        run_id: "run-new",
        run_dir: "/runs/run-new",
        classification: "current",
        scope: "suite",
        execution_state: "completed",
        recorded_verdict: "passed",
        current_verdict: "passed",
        source_digest: "new-source",
        executed_digest: "new-executed",
        source_snapshot_preview: "new source",
        executed_snapshot_preview: "new executed",
      },
      {
        run_id: "run-old",
        run_dir: "/runs/run-old",
        classification: "current",
        scope: "suite",
        execution_state: "completed",
        recorded_verdict: "failed",
        current_verdict: "failed",
        source_digest: "old-source",
        executed_digest: "old-executed",
        source_snapshot_preview: "old source",
        executed_snapshot_preview: "old executed",
      },
    ];
    const component = new EvalStudioComponent(theme, data, glyphs, vi.fn());
    component.handleInput("\r");
    component.handleInput("3");
    component.handleInput("j");
    component.handleInput("\r");
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("Selected Run  run-old");
    expect(rendered).toContain("Digest        old-source");
  });

  it("shows response-integrity counts and expands the selected turn sequence", () => {
    const data = inventory();
    data.suites[0].runs = [
      {
        run_id: "run-sequence",
        run_dir: "/runs/run-sequence",
        classification: "current",
        scope: "suite",
        execution_state: "completed",
        recorded_verdict: "passed",
        current_verdict: "passed",
        turns: [
          {
            scenario_id: "greeting",
            turn_id: "turn",
            utterance: "Hello",
            agent_response: "Final greeting",
            topic: "welcome",
            response_sequence: buildLlmResponseSequence(
              [
                [
                  {
                    agent_name: "Router",
                    prompt_response: JSON.stringify({
                      content: "",
                      tool_invocations: [{ function: { name: "continue_flow" } }],
                    }),
                  },
                  {
                    agent_name: "Router",
                    prompt_response: JSON.stringify({ content: "Intermediate greeting" }),
                  },
                  {
                    agent_name: "Welcome",
                    prompt_response: JSON.stringify({ content: "Final greeting" }),
                  },
                ],
              ],
              "Final greeting",
            ),
          },
        ],
      },
    ];

    const component = new EvalStudioComponent(theme, data, glyphs, vi.fn());
    component.handleInput("\r");
    component.handleInput("\r");
    const rendered = component.render(120).join("\n");
    expect(rendered).toContain("LLM");
    expect(rendered).toContain("3 calls");
    expect(rendered).toContain("2 candidate");
    expect(rendered).toContain("warning");
    expect(rendered).toContain("LLM Response Sequence");
    expect(rendered).toContain("Intermediate greeting");
    expect(rendered).toContain("Final greeting");
  });

  it("uses Pi Input for focused Unicode filtering", () => {
    const component = new EvalStudioComponent(theme, inventory(), glyphs, vi.fn());
    component.focused = true;
    component.handleInput("/");
    component.handleInput("D");
    component.handleInput("é");
    component.handleInput("\r");
    expect(component.render(100).join("\n")).toContain("Dé");
  });

  it("returns refresh and closes only from the Agent level", () => {
    const done = vi.fn();
    const component = new EvalStudioComponent(theme, inventory(), glyphs, done);
    component.handleInput("R");
    expect(done).toHaveBeenCalledWith({ kind: "refresh" });
    component.handleInput("q");
    expect(done).toHaveBeenCalledWith({ kind: "close" });
  });
});
