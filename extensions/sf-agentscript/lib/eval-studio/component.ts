/* SPDX-License-Identifier: Apache-2.0 */
/** Read-only responsive Eval Studio overlay. It returns intent; callers own effects. */

import {
  Input,
  type Focusable,
  matchesKey,
  truncateToWidth,
  visibleWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { UiGlyphs } from "../../../../lib/common/ui-glyphs.ts";
import { renderStudioTable, type StudioTableColumn } from "./layout.ts";
import { redactStudioValue } from "./redaction.ts";
import type {
  StudioEvaluator,
  StudioInventory,
  StudioRunSummary,
  StudioScenario,
  StudioSuiteSummary,
} from "./types.ts";

export type EvalStudioIntent =
  | { kind: "close" }
  | { kind: "refresh" }
  | { kind: "run_suite"; suite_path: string }
  | { kind: "run_scenario"; suite_path: string; scenario_id: string }
  | { kind: "rerun"; run_id: string }
  | { kind: "release_contract"; agent_api_name: string }
  | {
      kind: "author";
      action: "new_suite" | "new_scenario" | "edit" | "diagnose";
      suite_path?: string;
      scenario_id?: string;
    }
  | { kind: "cancel_run"; run_id: string }
  | { kind: "report"; run_id: string }
  | { kind: "copy_summary"; run_id: string }
  | { kind: "open_artifacts"; run_dir: string };

type Depth = "agent" | "suite" | "scenario";
type AgentTab = "suites" | "recent" | "release";
type SuiteTab = "scenarios" | "evaluators" | "runs" | "source";
type ScenarioTab = "conversation" | "evaluators" | "evidence";

const AGENT_TABS: AgentTab[] = ["suites", "recent", "release"];
const SUITE_TABS: SuiteTab[] = ["scenarios", "evaluators", "runs", "source"];
const SCENARIO_TABS: ScenarioTab[] = ["conversation", "evaluators", "evidence"];

export class EvalStudioComponent implements Focusable {
  focused = false;
  private depth: Depth = "agent";
  private agentTab: AgentTab = "suites";
  private suiteTab: SuiteTab = "scenarios";
  private scenarioTab: ScenarioTab = "conversation";
  private agentIndex = 0;
  private suiteIndex = 0;
  private scenarioIndex = 0;
  private sourceViewIndex = 0;
  private readonly selectedRunBySuite = new Map<string, string>();
  private rowIndex = 0;
  private filter = "";
  private filterFocused = false;
  private readonly filterInput = new Input();
  private failuresOnly = false;
  private showHelp = false;
  private terminalRows = 30;

  constructor(
    private readonly theme: Theme,
    private inventory: StudioInventory,
    private readonly glyphs: UiGlyphs,
    private readonly done: (result: EvalStudioIntent) => void,
    private readonly terminalRowsProvider?: () => number | undefined,
    private readonly activeRunId?: string,
  ) {
    this.filterInput.onSubmit = (value) => {
      this.filter = value;
      this.filterFocused = false;
      this.rowIndex = 0;
    };
    this.filterInput.onEscape = () => {
      this.filterFocused = false;
    };
  }

  setTerminalRows(rows: number): void {
    this.terminalRows = Math.max(16, rows);
  }

  replaceInventory(inventory: StudioInventory): void {
    this.inventory = inventory;
    this.suiteIndex = Math.min(this.suiteIndex, Math.max(0, inventory.suites.length - 1));
    this.rowIndex = 0;
  }

  handleInput(data: string): void {
    if (this.filterFocused) {
      this.filterInput.focused = this.focused;
      this.filterInput.handleInput(data);
      this.filter = this.filterInput.getValue();
      return;
    }
    if (this.showHelp) {
      this.showHelp = false;
      return;
    }
    if (data === "?") return void (this.showHelp = true);
    if (data === "/") {
      this.filterInput.setValue(this.filter);
      this.filterInput.focused = this.focused;
      this.filterFocused = true;
      return;
    }
    if (matchesKey(data, "escape") || data === "q") {
      if (this.depth === "scenario") this.depth = "suite";
      else if (this.depth === "suite") this.depth = "agent";
      else this.done({ kind: "close" });
      this.rowIndex = 0;
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "backspace") || data === "h") {
      if (this.depth === "scenario") this.depth = "suite";
      else if (this.depth === "suite") this.depth = "agent";
      this.rowIndex = 0;
      return;
    }
    if (matchesKey(data, "tab")) return this.switchTab(1);
    if (matchesKey(data, "right") || data === "l") return this.drill();
    if (data === "[" || data === "]") {
      const agents = this.agents();
      if (agents.length > 0) {
        const delta = data === "]" ? 1 : -1;
        this.agentIndex = (this.agentIndex + delta + agents.length) % agents.length;
        this.suiteIndex = 0;
        this.rowIndex = 0;
      }
      return;
    }
    if (data >= "1" && data <= "4") return this.selectTab(Number(data) - 1);
    if (matchesKey(data, "up") || data === "k") return this.move(-1);
    if (matchesKey(data, "down") || data === "j") return this.move(1);
    if (data === "R") return this.done({ kind: "refresh" });
    if (data === "s" && this.depth === "suite" && this.suiteTab === "source") {
      this.sourceViewIndex = (this.sourceViewIndex + 1) % 3;
      return;
    }
    if (data === "f") {
      this.failuresOnly = !this.failuresOnly;
      this.rowIndex = 0;
      return;
    }
    if (data === "n") return this.author(this.depth === "agent" ? "new_suite" : "new_scenario");
    if (data === "e") return this.author("edit");
    if (data === "d") return this.author("diagnose");
    if (data === "r") return this.runSelected();
    if (data === "g" && this.depth === "agent" && this.agentTab === "release") {
      const agent = this.selectedSuite()?.agent_api_name;
      if (agent) this.done({ kind: "release_contract", agent_api_name: agent });
      return;
    }
    if (data === "c") {
      const run = this.selectedRun();
      if (run?.execution_state === "running") this.done({ kind: "cancel_run", run_id: run.run_id });
      else if (this.activeRunId) this.done({ kind: "cancel_run", run_id: this.activeRunId });
      return;
    }
    if (data === "m") {
      const run = this.selectedRun();
      if (run) this.done({ kind: "report", run_id: run.run_id });
      return;
    }
    if (data === "y") {
      const run = this.selectedRun();
      if (run) this.done({ kind: "copy_summary", run_id: run.run_id });
      return;
    }
    if (data === "o") {
      const run = this.selectedRun();
      if (run) this.done({ kind: "open_artifacts", run_dir: run.run_dir });
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) this.drill();
  }

  private tabs(): string[] {
    return this.depth === "agent"
      ? AGENT_TABS
      : this.depth === "suite"
        ? SUITE_TABS
        : SCENARIO_TABS;
  }

  private activeTab(): string {
    return this.depth === "agent"
      ? this.agentTab
      : this.depth === "suite"
        ? this.suiteTab
        : this.scenarioTab;
  }

  private switchTab(delta: number): void {
    const tabs = this.tabs();
    const next = (tabs.indexOf(this.activeTab()) + delta + tabs.length) % tabs.length;
    this.selectTab(next);
  }

  private selectTab(index: number): void {
    const tab = this.tabs()[index];
    if (!tab) return;
    if (this.depth === "agent") this.agentTab = tab as AgentTab;
    else if (this.depth === "suite") this.suiteTab = tab as SuiteTab;
    else this.scenarioTab = tab as ScenarioTab;
    this.rowIndex = 0;
  }

  private agents(): string[] {
    const values = this.inventory.suites.map((suite) => suite.agent_api_name ?? "Unassigned");
    return [...new Set(values)].sort();
  }

  private selectedAgent(): string {
    return this.agents()[this.agentIndex] ?? "Unassigned";
  }

  private selectedSuite(): StudioSuiteSummary | undefined {
    return this.filteredSuites()[this.suiteIndex] ?? this.filteredSuites()[0];
  }

  private filteredSuites(): StudioSuiteSummary[] {
    const query = this.filter.toLowerCase();
    const agent = this.selectedAgent();
    return this.inventory.suites.filter(
      (suite) =>
        (suite.agent_api_name ?? "Unassigned") === agent &&
        (!query ||
          `${suite.display_name} ${suite.agent_api_name ?? ""} ${suite.path}`
            .toLowerCase()
            .includes(query)),
    );
  }

  private allRuns(): StudioRunSummary[] {
    const agent = this.selectedAgent();
    return [
      ...this.inventory.suites
        .filter((suite) => (suite.agent_api_name ?? "Unassigned") === agent)
        .flatMap((suite) => suite.runs),
      ...(agent === "Unassigned" ? this.inventory.unassigned_runs : []),
    ].sort((a, b) => (b.started ?? "").localeCompare(a.started ?? ""));
  }

  private selectedRun(): StudioRunSummary | undefined {
    if (this.depth === "agent" && this.agentTab === "recent")
      return this.visibleRuns(this.allRuns())[this.rowIndex];
    if (this.depth === "suite" && this.suiteTab === "runs")
      return this.visibleRuns(this.selectedSuite()?.runs ?? [])[this.rowIndex];
    if (this.depth === "scenario" && this.scenarioTab === "evidence") {
      const id = this.selectedScenario()?.id;
      return this.visibleRuns(
        this.selectedSuite()?.runs.filter((run) => !run.scenario_id || run.scenario_id === id) ??
          [],
      )[this.rowIndex];
    }
    return undefined;
  }

  private visibleRuns(runs: StudioRunSummary[]): StudioRunSummary[] {
    return this.failuresOnly
      ? runs.filter((run) => (run.current_verdict ?? run.recorded_verdict) !== "passed")
      : runs;
  }

  private selectedScenario() {
    const index = this.depth === "scenario" ? this.scenarioIndex : this.rowIndex;
    return (
      this.selectedSuite()?.projection.scenarios[index] ??
      this.selectedSuite()?.projection.scenarios[0]
    );
  }

  private rowCount(): number {
    if (this.depth === "agent")
      return this.agentTab === "recent"
        ? this.visibleRuns(this.allRuns()).length
        : this.filteredSuites().length;
    const suite = this.selectedSuite();
    if (!suite) return 0;
    if (this.depth === "suite") {
      if (this.suiteTab === "runs") return this.visibleRuns(suite.runs).length;
      if (this.suiteTab === "evaluators")
        return suite.projection.scenarios.flatMap((s) => s.evaluators).length;
      return suite.projection.scenarios.length;
    }
    const scenario = this.selectedScenario();
    if (!scenario) return 0;
    if (this.scenarioTab === "conversation") return scenario.turns.length;
    if (this.scenarioTab === "evaluators") return scenario.evaluators.length;
    return this.visibleRuns(
      suite.runs.filter((run) => !run.scenario_id || run.scenario_id === scenario.id),
    ).length;
  }

  private move(delta: number): void {
    const count = this.rowCount();
    if (count === 0) return;
    this.rowIndex = Math.max(0, Math.min(count - 1, this.rowIndex + delta));
    if (this.depth === "agent" && this.agentTab === "suites") this.suiteIndex = this.rowIndex;
  }

  private drill(): void {
    if (this.depth === "agent" && this.agentTab === "suites" && this.selectedSuite()) {
      this.depth = "suite";
      this.rowIndex = 0;
      return;
    }
    if (this.depth === "agent" && this.agentTab === "recent") {
      const run = this.selectedRun();
      const owner = this.inventory.suites.find((suite) =>
        suite.runs.some((candidate) => candidate.run_id === run?.run_id),
      );
      if (run && owner) {
        const agentIndex = this.agents().indexOf(owner.agent_api_name ?? "Unassigned");
        if (agentIndex >= 0) this.agentIndex = agentIndex;
        const suiteIndex = this.filteredSuites().findIndex((suite) => suite.id === owner.id);
        if (suiteIndex >= 0) this.suiteIndex = suiteIndex;
        this.selectedRunBySuite.set(owner.id, run.run_id);
        this.depth = "suite";
        this.suiteTab = "source";
        this.sourceViewIndex = 1;
        this.rowIndex = 0;
      }
      return;
    }
    if (this.depth === "suite" && this.suiteTab === "runs") {
      const suite = this.selectedSuite();
      const run = this.selectedRun();
      if (suite && run) {
        this.selectedRunBySuite.set(suite.id, run.run_id);
        this.suiteTab = "source";
        this.sourceViewIndex = 1;
        this.rowIndex = 0;
      }
      return;
    }
    if (this.depth === "scenario" && this.scenarioTab === "evidence") {
      const suite = this.selectedSuite();
      const run = this.selectedRun();
      if (suite && run) this.selectedRunBySuite.set(suite.id, run.run_id);
      return;
    }
    if (this.depth === "suite" && this.suiteTab === "scenarios" && this.selectedScenario()) {
      this.scenarioIndex = this.rowIndex;
      this.depth = "scenario";
      this.rowIndex = 0;
    }
  }

  private runSelected(): void {
    const historical = this.selectedRun();
    if (historical) {
      this.done({ kind: "rerun", run_id: historical.run_id });
      return;
    }
    const suite = this.selectedSuite();
    if (!suite || suite.generated || suite.identity_conflict) return;
    if (this.depth === "scenario") {
      const scenario = this.selectedScenario();
      if (scenario?.projectable)
        this.done({ kind: "run_scenario", suite_path: suite.path, scenario_id: scenario.id });
      return;
    }
    if (suite.projection.projectable) this.done({ kind: "run_suite", suite_path: suite.path });
  }

  private author(action: "new_suite" | "new_scenario" | "edit" | "diagnose"): void {
    const suite = this.selectedSuite();
    const scenario = this.depth === "scenario" ? this.selectedScenario() : undefined;
    this.done({
      kind: "author",
      action,
      ...(suite && action !== "new_suite" ? { suite_path: suite.path } : {}),
      ...(scenario && action !== "new_suite" ? { scenario_id: scenario.id } : {}),
    });
  }

  render(width: number): string[] {
    const currentRows = this.terminalRowsProvider?.();
    if (typeof currentRows === "number") this.setTerminalRows(currentRows);
    const inner = Math.max(1, width - 2);
    const contentWidth = Math.max(1, inner - 2);
    const row = (content = "") => {
      const clipped = truncateToWidth(` ${content}`, inner, "");
      const padding = " ".repeat(Math.max(0, inner - visibleWidth(clipped)));
      return `${this.theme.fg("border", "│")}${clipped}${padding}${this.theme.fg("border", "│")}`;
    };
    const border = (
      left: string,
      fill: string,
      right: string,
      color: "border" | "accent" = "border",
    ) => this.theme.fg(color, `${left}${fill.repeat(inner)}${right}`);

    const scenarioCount = this.filteredSuites().reduce(
      (sum, suite) => sum + suite.projection.scenarios.length,
      0,
    );
    const runCount = this.allRuns().length;
    const issueCount = this.inventory.issues.length;
    const title = this.theme.fg(
      "toolTitle",
      this.theme.bold(`${this.glyphs.agent} Agent Script Eval Studio`),
    );
    const breadcrumb = this.theme.fg("accent", this.breadcrumb());
    const metrics = [
      this.theme.fg("accent", `${this.glyphs.data} ${this.filteredSuites().length} Suites`),
      this.theme.fg("accent", `${this.glyphs.automation} ${scenarioCount} Scenarios`),
      this.theme.fg("success", `${this.glyphs.evidence} ${runCount} Runs`),
      issueCount > 0
        ? this.theme.fg("warning", `${this.glyphs.warning} ${issueCount} Issues`)
        : this.theme.fg("muted", `${this.glyphs.success} Local-first`),
    ].join(this.theme.fg("dim", "  ·  "));
    const tabs = this.tabs()
      .map((tab, index) => {
        const label = `${index + 1} ${this.tabIcon(tab)} ${this.tabLabel(tab)}`;
        return tab === this.activeTab()
          ? this.theme.fg("accent", this.theme.bold(`▐ ${label} ▌`))
          : this.theme.fg("muted", label);
      })
      .join("   ");

    const lines = [border("╭", "─", "╮", "accent")];
    lines.push(row(`${title}  ${this.theme.fg("dim", "›")}  ${breadcrumb}`));
    lines.push(row(metrics));
    lines.push(row(tabs));
    lines.push(border("├", "─", "┤"));

    const body = this.showHelp ? this.helpLines() : this.bodyLines(contentWidth);
    const frameRows = Math.max(14, Math.floor(this.terminalRows * 0.9));
    const maxBody = Math.max(5, frameRows - 10);
    const visibleBody = this.viewportBody(body, maxBody);
    for (let index = 0; index < maxBody; index++) lines.push(row(visibleBody[index] ?? ""));

    lines.push(border("├", "─", "┤"));
    this.filterInput.focused = this.focused && this.filterFocused;
    lines.push(
      row(
        this.filterFocused
          ? `${this.theme.fg("accent", `${this.glyphs.discovery} Filter`)}  ${this.filterInput.render(Math.max(12, contentWidth - 12))[0] ?? ""}`
          : this.statusLine(),
      ),
    );
    lines.push(row(this.hintLine()));
    lines.push(border("╰", "─", "╯", "accent"));
    return lines;
  }

  invalidate(): void {
    this.filterInput.invalidate();
  }

  private viewportBody(body: string[], size: number): string[] {
    if (body.length <= size) return body;
    const cursor = this.bodyCursorLine();
    const offset = Math.max(0, Math.min(body.length - size, cursor - Math.floor(size / 2)));
    const visible = body.slice(offset, offset + size);
    if (offset > 0) {
      visible[0] = this.theme.fg("muted", `${this.glyphs.selected} ↑ ${offset} more above`);
    }
    const below = body.length - (offset + size);
    if (below > 0) {
      visible[visible.length - 1] = this.theme.fg(
        "muted",
        `${this.glyphs.selected} ↓ ${below} more below`,
      );
    }
    return visible;
  }

  private bodyCursorLine(): number {
    if (this.showHelp || this.suiteTab === "source" || this.agentTab === "release") return 0;
    if (this.depth === "scenario" && this.scenarioTab === "conversation") {
      return 2 + this.rowIndex * 5;
    }
    return 4 + this.rowIndex;
  }

  private breadcrumb(): string {
    const suite = this.selectedSuite();
    if (this.depth === "agent") return `Agent ${this.selectedAgent()}`;
    if (this.depth === "suite") return `Agents / ${suite?.display_name ?? "Suite"}`;
    return `Agents / ${suite?.display_name ?? "Suite"} / ${this.selectedScenario()?.name ?? "Scenario"}`;
  }

  private statusLine(): string {
    const selected = this.evidenceRun();
    return [
      this.theme.fg("muted", `${this.glyphs.status} Local evidence`),
      this.filter ? this.theme.fg("accent", `${this.glyphs.discovery} ${this.filter}`) : "",
      this.failuresOnly ? this.theme.fg("warning", `${this.glyphs.warning} Failures only`) : "",
      selected
        ? this.theme.fg(
            selected.current_verdict === "passed" ? "success" : "warning",
            `${this.glyphs.evidence} Run ${selected.run_id}`,
          )
        : "",
    ]
      .filter(Boolean)
      .join(this.theme.fg("dim", "  ·  "));
  }

  private tabLabel(tab: string): string {
    return tab
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  private tabIcon(tab: string): string {
    if (tab === "suites" || tab === "scenarios" || tab === "conversation") return this.glyphs.data;
    if (tab === "recent" || tab === "runs" || tab === "evidence") return this.glyphs.evidence;
    if (tab === "release") return this.glyphs.lifecycle;
    if (tab === "evaluators") return this.glyphs.codeAnalyzer;
    if (tab === "source") return this.glyphs.reference;
    return this.glyphs.status;
  }

  private hintLine(): string {
    const key = (value: string) => this.theme.fg("accent", value);
    const text = (value: string) => this.theme.fg("muted", value);
    return [
      `${key("↑↓")} ${text("move")}`,
      `${key("Enter/→")} ${text("open")}`,
      `${key("r")} ${text("run")}`,
      `${key("f")} ${text("failures")}`,
      `${key("R")} ${text("refresh")}`,
      `${key("?")} ${text("help")}`,
      `${key("q")} ${text("close")}`,
    ].join(text("   "));
  }

  private helpLines(): string[] {
    return [
      this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.controls} Navigation`)),
      this.theme.fg("muted", "  1-4 tabs · arrows or h/j/k/l · Enter drill · Esc/backspace return"),
      "",
      this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.automation} Execution`)),
      `  ${this.theme.fg("accent", "r")} Run Suite/Scenario · ${this.theme.fg("accent", "g")} Release Contract · ${this.theme.fg("accent", "m")} report · ${this.theme.fg("accent", "o")} artifacts`,
      "",
      this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.agent} Authoring`)),
      `  ${this.theme.fg("accent", "n")} new · ${this.theme.fg("accent", "e")} edit · ${this.theme.fg("accent", "d")} diagnose with Agent`,
      "",
      this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.evidence} Evidence`)),
      this.theme.fg(
        "muted",
        "  Passed requires every expected evaluator. Incomplete and Unverified never become release evidence.",
      ),
      "",
      "Press any key to close help.",
    ];
  }

  private bodyLines(width: number): string[] {
    if (this.depth === "agent") return this.agentBody(width);
    if (this.depth === "suite") return this.suiteBody(width);
    return this.scenarioBody(width);
  }

  private agentBody(width: number): string[] {
    if (this.agentTab === "recent") return this.runLines(this.allRuns(), width);
    if (this.agentTab === "release") {
      const agent = this.selectedAgent();
      return [
        this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.lifecycle} Release Contract`)),
        this.theme.fg("accent", `  ${agent}`),
        "",
        `${this.theme.fg("success", this.glyphs.success)}  Generated Baseline`,
        `${this.theme.fg("success", this.glyphs.success)}  Designated Suite`,
        `${this.theme.fg("accent", this.glyphs.actions)}  Press ${this.theme.fg("accent", "g")} to resolve and review the pending exact version`,
        ...(this.activeRunId
          ? [
              "",
              this.theme.fg(
                "warning",
                `${this.glyphs.loading} Active ${this.activeRunId} · c cancel`,
              ),
            ]
          : []),
        "",
        this.theme.fg(
          "muted",
          `${this.glyphs.safety} Salesforce is contacted only after explicit review.`,
        ),
      ];
    }

    const rows = this.filteredSuites().map((suite, index) => ({ suite, index }));
    const columns: StudioTableColumn<(typeof rows)[number]>[] = [
      {
        header: "",
        min: 2,
        max: 2,
        value: ({ index }) =>
          index === this.suiteIndex ? this.theme.fg("accent", this.glyphs.selectedRow) : " ",
      },
      {
        header: "State",
        min: 7,
        max: 9,
        value: ({ suite }) => {
          if (suite.identity_conflict)
            return this.theme.fg("error", `${this.glyphs.error} conflict`);
          if (!suite.projection.projectable)
            return this.theme.fg("warning", `${this.glyphs.warning} blocked`);
          return this.theme.fg("success", `${this.glyphs.success} ready`);
        },
      },
      {
        header: "Eval Suite",
        min: 22,
        max: 110,
        weight: 5,
        value: ({ suite, index }) => {
          const label = suite.generated
            ? `${this.glyphs.automation} ${suite.display_name}`
            : suite.display_name;
          return this.theme.fg(
            suite.generated ? "warning" : index === this.suiteIndex ? "accent" : "text",
            index === this.suiteIndex ? this.theme.bold(label) : label,
          );
        },
      },
      {
        header: "Agent API Name",
        min: 20,
        max: 70,
        weight: 3,
        showAt: 118,
        value: ({ suite }) => this.theme.fg("muted", suite.agent_api_name ?? "Unassigned"),
      },
      {
        header: "Scenarios",
        min: 9,
        max: 9,
        align: "right",
        showAt: 78,
        value: ({ suite }) => this.theme.fg("accent", String(suite.projection.scenarios.length)),
      },
      {
        header: "Runs",
        min: 5,
        max: 5,
        align: "right",
        showAt: 70,
        value: ({ suite }) => this.theme.fg("accent", String(suite.runs.length)),
      },
      {
        header: "Source",
        min: 12,
        max: 12,
        value: ({ suite }) =>
          this.theme.fg(
            suite.generated ? "warning" : suite.designated ? "success" : "muted",
            suite.generated ? "generated" : suite.designated ? "designated" : "additional",
          ),
      },
    ];
    const selected = this.selectedSuite();
    const latest = selected?.runs[0];
    return [
      `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.agent} ${this.selectedAgent()}`))}  ${this.theme.fg("muted", "[ / ] switch Agent")}`,
      "",
      ...renderStudioTable({
        width,
        columns,
        rows,
        styleHeader: (value) => this.theme.fg("muted", this.theme.bold(value)),
        styleDivider: (value) => this.theme.fg("dim", value),
      }),
      ...(selected && width >= 88
        ? [
            "",
            this.theme.fg("dim", "─".repeat(Math.max(1, width))),
            `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.selected} Selected Suite`))}  ${this.theme.fg("accent", selected.display_name)}`,
            `${this.theme.fg("muted", "Path")}       ${this.theme.fg("mdCode", selected.path)}`,
            `${this.theme.fg("muted", "Inventory")}  ${this.theme.fg("accent", `${selected.projection.scenarios.length} scenarios`)}  ${this.theme.fg("dim", "·")}  ${this.theme.fg("accent", `${selected.runs.length} runs`)}  ${this.theme.fg("dim", "·")}  ${selected.projection.projectable ? this.theme.fg("success", `${this.glyphs.success} projectable`) : this.theme.fg("error", `${this.glyphs.error} blocked`)}`,
            `${this.theme.fg("muted", "Latest")}     ${latest ? this.evidenceVerdict(latest) : this.theme.fg("muted", "Not run")}`,
          ]
        : []),
    ];
  }

  private suiteBody(width: number): string[] {
    const suite = this.selectedSuite();
    if (!suite)
      return [
        this.theme.fg(
          "warning",
          `${this.glyphs.warning} No Eval Suites found under tests/agentforce/.`,
        ),
      ];
    if (this.suiteTab === "runs") return this.runLines(suite.runs, width);
    if (this.suiteTab === "source") {
      const run = this.evidenceRun(suite);
      const views = ["Current", "Run Source", "Executed"] as const;
      const view = views[this.sourceViewIndex];
      const preview =
        view === "Current"
          ? suite.source_preview
          : view === "Run Source"
            ? run?.source_snapshot_preview
            : run?.executed_snapshot_preview;
      const sourcePath =
        view === "Current"
          ? suite.path
          : run
            ? pathLabel(
                run.run_dir,
                view === "Run Source" ? "spec.source.snapshot.json" : "spec.executed.snapshot.json",
              )
            : "Unavailable";
      const digest =
        view === "Current"
          ? suite.source_digest
          : view === "Run Source"
            ? run?.source_digest
            : run?.executed_digest;
      return [
        `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.reference} Source`))}  ${views
          .map((name) =>
            name === view
              ? this.theme.fg("accent", this.theme.bold(`▐ ${name} ▌`))
              : this.theme.fg("muted", name),
          )
          .join(this.theme.fg("dim", "  |  "))}  ${this.theme.fg("muted", "s next")}`,
        "",
        `${this.theme.fg("muted", "Selected Run")}  ${this.theme.fg("accent", run?.run_id ?? "Unavailable")}`,
        `${this.theme.fg("muted", "Path")}          ${this.theme.fg("mdCode", sourcePath)}`,
        `${this.theme.fg("muted", "Digest")}        ${this.theme.fg("mdCode", digest ?? "Unavailable")}`,
        this.theme.fg("dim", "─".repeat(Math.max(1, width))),
        ...(preview?.split("\n").map((line) => this.theme.fg("text", line)) ?? [
          this.theme.fg("warning", `${this.glyphs.warning} Unavailable`),
        ]),
        "",
        this.theme.fg("muted", `${this.glyphs.reference} Read-only · e Edit with Agent`),
      ];
    }
    if (this.suiteTab === "evaluators") {
      const rows = suite.projection.scenarios.flatMap((scenario) =>
        scenario.evaluators.map((evaluator) => ({ scenario, evaluator })),
      );
      return this.evaluatorLines(rows, width);
    }

    const rows = suite.projection.scenarios.map((scenario, index) => ({ scenario, index }));
    const columns: StudioTableColumn<(typeof rows)[number]>[] = [
      {
        header: "",
        min: 2,
        max: 2,
        value: ({ index }) =>
          index === this.rowIndex ? this.theme.fg("accent", this.glyphs.selectedRow) : " ",
      },
      {
        header: "State",
        min: 7,
        max: 9,
        value: ({ scenario }) =>
          scenario.projectable
            ? this.theme.fg("success", `${this.glyphs.success} ready`)
            : this.theme.fg("error", `${this.glyphs.error} blocked`),
      },
      {
        header: "Scenario",
        min: 24,
        max: 100,
        weight: 6,
        value: ({ scenario, index }) =>
          this.theme.fg(
            index === this.rowIndex ? "accent" : "text",
            index === this.rowIndex ? this.theme.bold(scenario.name) : scenario.name,
          ),
      },
      {
        header: "Turns",
        min: 5,
        max: 5,
        align: "right",
        value: ({ scenario }) => this.theme.fg("accent", String(scenario.turns.length)),
      },
      {
        header: "Evals",
        min: 5,
        max: 5,
        align: "right",
        value: ({ scenario }) => this.theme.fg("accent", String(scenario.evaluators.length)),
      },
      {
        header: "Topic",
        min: 10,
        max: 35,
        weight: 2,
        showAt: 105,
        value: () => this.theme.fg("muted", "—"),
      },
      {
        header: "Actions",
        min: 10,
        max: 35,
        weight: 2,
        showAt: 122,
        value: () => this.theme.fg("muted", "—"),
      },
      {
        header: "Checkpoints",
        min: 11,
        max: 11,
        align: "right",
        showAt: 88,
        value: ({ scenario }) => this.theme.fg("warning", String(scenario.checkpoints.length)),
      },
    ];
    const selected = this.selectedScenario();
    return [
      `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.automation} Scenarios`))}  ${this.theme.fg("muted", `${rows.length} source-ordered`)}`,
      "",
      ...renderStudioTable({
        width,
        columns,
        rows,
        styleHeader: (value) => this.theme.fg("muted", this.theme.bold(value)),
        styleDivider: (value) => this.theme.fg("dim", value),
      }),
      ...(selected && width >= 88
        ? [
            "",
            this.theme.fg("dim", "─".repeat(Math.max(1, width))),
            `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.selected} Selected Scenario`))}  ${this.theme.fg("accent", selected.name)}`,
            `${this.theme.fg("muted", "Proof")}       ${this.theme.fg("accent", `${selected.turns.length} turns`)}  ${this.theme.fg("dim", "·")}  ${this.theme.fg("accent", `${selected.evaluators.length} evaluators`)}  ${this.theme.fg("dim", "·")}  ${this.theme.fg("warning", `${selected.checkpoints.length} checkpoints`)}`,
            `${this.theme.fg("muted", "Readiness")}   ${selected.projectable ? this.theme.fg("success", `${this.glyphs.success} Studio-projectable`) : this.theme.fg("error", `${this.glyphs.error} ${selected.blocking_issues.join("; ")}`)}`,
          ]
        : []),
    ];
  }

  private scenarioBody(width: number): string[] {
    const scenario = this.selectedScenario();
    if (!scenario) return ["No Scenario selected."];
    if (this.scenarioTab === "evidence") {
      const runs =
        this.selectedSuite()?.runs.filter(
          (run) => !run.scenario_id || run.scenario_id === scenario.id,
        ) ?? [];
      return this.runLines(runs, width);
    }
    if (this.scenarioTab === "evaluators")
      return this.evaluatorLines(
        scenario.evaluators.map((evaluator) => ({ scenario, evaluator })),
        width,
      );
    const run = this.latestScenarioRun();
    const observedState = run?.turns?.at(-1)?.state_variables ?? {};
    return [
      `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.automation} Conversation`))}  ${this.theme.fg("muted", `${scenario.turns.length} turns · shared session`)}`,
      "",
      ...scenario.turns.flatMap((turn, index) => {
        const actual = run?.turns?.find((row) => row.turn_id === turn.id);
        const selected = index === this.rowIndex;
        return [
          `${selected ? this.theme.fg("accent", this.glyphs.selectedRow) : " "} ${this.theme.fg(selected ? "accent" : "toolTitle", this.theme.bold(`Turn ${index + 1}`))} ${this.theme.fg("muted", `· ${turn.id}`)}`,
          `   ${this.theme.fg("accent", "User")}      ${this.theme.fg("text", turn.utterance)}`,
          `   ${this.theme.fg("warning", "Expected")}  ${this.theme.fg("muted", turn.expected_behavior ?? this.expectedForTurn(turn.id))}`,
          `   ${this.theme.fg(actual?.agent_response ? "success" : "muted", "Agent")}     ${actual?.agent_response ?? "Not run"}`,
          ...(actual?.topic
            ? [`   ${this.theme.fg("accent", `${this.glyphs.scope} Topic`)}     ${actual.topic}`]
            : []),
          ...(actual?.invoked_actions?.length
            ? [
                `   ${this.theme.fg("accent", `${this.glyphs.actions} Actions`)}   ${actual.invoked_actions.join(", ")}`,
              ]
            : []),
          this.theme.fg("dim", "─".repeat(Math.max(1, Math.min(width, 72)))),
        ];
      }),
      ...(scenario.seeds.length || scenario.checkpoints.length
        ? [
            this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.scope} Context & State`)),
            ...scenario.seeds.map((seed) => {
              const actual = observedState[seed.name];
              const displayed = (
                redactStudioValue({ name: seed.name, value: seed.value }) as Record<string, unknown>
              ).value;
              const observed = (
                redactStudioValue({ name: seed.name, value: actual }) as Record<string, unknown>
              ).value;
              const delta =
                actual === undefined
                  ? "unobserved"
                  : Object.is(actual, seed.value)
                    ? "unchanged"
                    : `${String(displayed)} → ${String(observed)}`;
              return `  ${this.theme.fg("accent", this.glyphs.data)} ${this.theme.fg("text", seed.name)} = ${this.theme.fg("mdCode", String(displayed))}  ${this.theme.fg("muted", `(${seed.provenance}) · ${delta}`)}`;
            }),
            ...scenario.checkpoints.map((checkpoint) => {
              const actual = observedState[checkpoint.name];
              const values = redactStudioValue({
                [checkpoint.name]: checkpoint.expected,
                [`${checkpoint.name}_observed`]: actual,
              }) as Record<string, unknown>;
              const expected = values[checkpoint.name];
              const observed = values[`${checkpoint.name}_observed`];
              const delta =
                actual === undefined
                  ? "unobserved"
                  : checkpoint.expected === undefined
                    ? `actual=${String(observed)}`
                    : `${String(expected)} → ${String(observed)}`;
              return `  ${this.theme.fg("warning", this.glyphs.evidence)} ${this.theme.fg("text", checkpoint.name)}  ${this.theme.fg("muted", "expected")}=${this.theme.fg("mdCode", String(expected ?? "Unavailable"))}  ${this.theme.fg("muted", `· ${delta}`)}`;
            }),
          ]
        : []),
    ];
  }

  private evaluatorLines(
    rows: Array<{ scenario: StudioScenario; evaluator: StudioEvaluator }>,
    width: number,
  ): string[] {
    const tableRows = rows.map((row, index) => ({ ...row, index }));
    const columns: StudioTableColumn<(typeof tableRows)[number]>[] = [
      {
        header: "",
        min: 2,
        max: 2,
        value: ({ index }) =>
          index === this.rowIndex ? this.theme.fg("accent", this.glyphs.selectedRow) : " ",
      },
      {
        header: "State",
        min: 10,
        max: 12,
        value: ({ scenario, evaluator }) => {
          const actual = this.evaluatorActual(scenario.id, evaluator.id);
          if (actual.startsWith("pass"))
            return this.theme.fg("success", `${this.glyphs.success} passed`);
          if (actual.startsWith("fail") || actual.startsWith("error"))
            return this.theme.fg("error", `${this.glyphs.error} failed`);
          return this.theme.fg(
            evaluator.capability === "live_proven" ? "muted" : "warning",
            evaluator.capability === "live_proven"
              ? `${this.glyphs.info} not run`
              : `${this.glyphs.warning} unverified`,
          );
        },
      },
      {
        header: "Evaluator",
        min: 20,
        max: 60,
        weight: 4,
        value: ({ evaluator, index }) =>
          this.theme.fg(
            index === this.rowIndex ? "accent" : "text",
            index === this.rowIndex ? this.theme.bold(evaluator.label) : evaluator.label,
          ),
      },
      {
        header: "Scope",
        min: 8,
        max: 10,
        value: ({ evaluator }) =>
          this.theme.fg(
            "accent",
            evaluator.turn_id ? `Turn ${evaluator.turn_id}` : evaluator.scope,
          ),
      },
      {
        header: "Capability",
        min: 14,
        max: 18,
        showAt: 112,
        value: ({ evaluator }) =>
          this.theme.fg(
            evaluator.capability === "live_proven" ? "success" : "warning",
            evaluator.capability.replaceAll("_", " "),
          ),
      },
      {
        header: "Scenario",
        min: 16,
        max: 28,
        weight: 2,
        showAt: 132,
        value: ({ scenario }) => this.theme.fg("muted", scenario.id),
      },
      {
        header: "Expected",
        min: 18,
        max: 60,
        weight: 4,
        showAt: 82,
        value: ({ evaluator }) => this.theme.fg("muted", evaluator.expected ?? "Unavailable"),
      },
      {
        header: "Actual / Score",
        min: 18,
        max: 60,
        weight: 4,
        value: ({ scenario, evaluator }) => {
          const actual = this.evaluatorActual(scenario.id, evaluator.id);
          return this.theme.fg(
            actual.startsWith("pass")
              ? "success"
              : actual.startsWith("fail") || actual.startsWith("error")
                ? "error"
                : "warning",
            actual,
          );
        },
      },
    ];
    return [
      `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.codeAnalyzer} Evaluators`))}  ${this.theme.fg("muted", `${rows.length} proof contracts`)}`,
      "",
      ...renderStudioTable({
        width,
        columns,
        rows: tableRows,
        styleHeader: (value) => this.theme.fg("muted", this.theme.bold(value)),
        styleDivider: (value) => this.theme.fg("dim", value),
      }),
    ];
  }

  private evidenceRun(suite = this.selectedSuite()): StudioRunSummary | undefined {
    if (!suite) return undefined;
    const selected = this.selectedRunBySuite.get(suite.id);
    return suite.runs.find((run) => run.run_id === selected) ?? suite.runs[0];
  }

  private evaluatorActual(scenarioId: string, evaluatorId: string): string {
    const row = this.evidenceRun()?.evaluators?.find(
      (evaluator) => evaluator.scenario_id === scenarioId && evaluator.id === evaluatorId,
    );
    if (!row) return "—";
    if (row.error_message) return `error: ${row.error_message}`;
    const state = row.is_pass === true ? "pass" : row.is_pass === false ? "fail" : "unverified";
    const score = row.score === undefined || row.score === null ? "" : ` score=${row.score}`;
    const actual = row.actual_value ? ` ${row.actual_value}` : "";
    return `${state}${score}${actual}`;
  }

  private latestScenarioRun(): StudioRunSummary | undefined {
    const scenarioId = this.selectedScenario()?.id;
    const selected = this.evidenceRun();
    if (selected && (!selected.scenario_id || selected.scenario_id === scenarioId)) return selected;
    return this.selectedSuite()?.runs.find(
      (run) => !run.scenario_id || run.scenario_id === scenarioId,
    );
  }

  private expectedForTurn(turnId: string): string {
    const rows =
      this.selectedScenario()?.evaluators.filter(
        (evaluator) => evaluator.turn_id === turnId || evaluator.scope === "scenario",
      ) ?? [];
    return (
      rows
        .map((row) => row.expected)
        .filter(Boolean)
        .join("; ") || "Unavailable — inspect evaluator contract"
    );
  }

  private runLines(runs: StudioRunSummary[], width: number): string[] {
    const rows = this.visibleRuns(runs).map((run, index) => ({ run, index }));
    const columns: StudioTableColumn<(typeof rows)[number]>[] = [
      {
        header: "",
        min: 2,
        max: 2,
        value: ({ index }) =>
          index === this.rowIndex ? this.theme.fg("accent", this.glyphs.selectedRow) : " ",
      },
      {
        header: "Execution",
        min: 12,
        max: 14,
        value: ({ run }) => this.executionState(run),
      },
      {
        header: "Suite / Scenario",
        min: 18,
        max: 90,
        weight: 5,
        value: ({ run, index }) => {
          const label = run.scenario_id ?? run.agent_api_name ?? "Unassigned";
          return this.theme.fg(
            index === this.rowIndex ? "accent" : "text",
            index === this.rowIndex ? this.theme.bold(label) : label,
          );
        },
      },
      {
        header: "Results",
        min: 7,
        max: 8,
        align: "right",
        value: ({ run }) => this.theme.fg("accent", run.result_summary ?? "—"),
      },
      {
        header: "Verdict",
        min: 12,
        max: 14,
        value: ({ run }) => this.evidenceVerdict(run),
      },
      {
        header: "Scope",
        min: 9,
        max: 10,
        showAt: 86,
        value: ({ run }) => this.theme.fg("muted", run.scope),
      },
      {
        header: "Version",
        min: 7,
        max: 8,
        align: "right",
        showAt: 96,
        value: ({ run }) => this.theme.fg("accent", String(run.bot_version_number ?? "—")),
      },
      {
        header: "Started",
        min: 19,
        max: 19,
        showAt: 118,
        value: ({ run }) => this.theme.fg("muted", (run.started ?? "—").slice(0, 19)),
      },
      {
        header: "Errors",
        min: 6,
        max: 6,
        align: "right",
        showAt: 104,
        value: ({ run }) =>
          this.theme.fg((run.errors ?? 0) > 0 ? "error" : "muted", String(run.errors ?? 0)),
      },
      {
        header: "P95",
        min: 7,
        max: 8,
        align: "right",
        showAt: 146,
        value: ({ run }) => this.theme.fg("muted", run.p95_ms ? `${run.p95_ms}ms` : "—"),
      },
      {
        header: "Duration",
        min: 9,
        max: 10,
        align: "right",
        showAt: 158,
        value: ({ run }) => this.theme.fg("muted", run.duration_ms ? `${run.duration_ms}ms` : "—"),
      },
      {
        header: "Freshness",
        min: 9,
        max: 10,
        showAt: 132,
        value: ({ run }) =>
          run.stale_source
            ? this.theme.fg("warning", `${this.glyphs.warning} stale`)
            : this.theme.fg("success", `${this.glyphs.success} current`),
      },
    ];
    const selected = rows[this.rowIndex]?.run;
    return [
      `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.evidence} Eval Runs`))}  ${this.theme.fg("muted", `${rows.length} shown`)}`,
      "",
      ...renderStudioTable({
        width,
        columns,
        rows,
        styleHeader: (value) => this.theme.fg("muted", this.theme.bold(value)),
        styleDivider: (value) => this.theme.fg("dim", value),
      }),
      ...(selected && width >= 88
        ? [
            "",
            this.theme.fg("dim", "─".repeat(Math.max(1, width))),
            `${this.theme.fg("toolTitle", this.theme.bold(`${this.glyphs.selected} Selected Run`))}  ${this.theme.fg("accent", selected.run_id)}`,
            `${this.theme.fg("muted", "Target")}      ${this.theme.fg("text", selected.target_org ?? "unknown org")}  ${this.theme.fg("dim", "·")}  ${this.theme.fg("accent", selected.bot_version_number === undefined ? "version unknown" : `v${selected.bot_version_number}`)}`,
            `${this.theme.fg("muted", "Evidence")}    ${this.executionState(selected)}  ${this.theme.fg("dim", "·")}  ${this.evidenceVerdict(selected)}`,
            `${this.theme.fg("muted", "Artifacts")}   ${this.theme.fg("mdCode", selected.run_dir)}`,
          ]
        : []),
    ];
  }

  private executionState(run: StudioRunSummary): string {
    const state = run.execution_state ?? "unknown";
    if (state === "running") return this.theme.fg("accent", `${this.glyphs.loading} running`);
    if (state === "completed") return this.theme.fg("success", `${this.glyphs.success} completed`);
    if (state === "cancelled" || state === "interrupted")
      return this.theme.fg("warning", `${this.glyphs.warning} ${state}`);
    return this.theme.fg("error", `${this.glyphs.error} ${state.replaceAll("_", " ")}`);
  }

  private evidenceVerdict(run: StudioRunSummary): string {
    const verdict = run.current_verdict ?? run.recorded_verdict ?? "unverified";
    if (verdict === "passed") return this.theme.fg("success", `${this.glyphs.success} Passed`);
    if (verdict === "failed") return this.theme.fg("error", `${this.glyphs.error} Failed`);
    return this.theme.fg("warning", `${this.glyphs.warning} ${this.tabLabel(verdict)}`);
  }
}

function pathLabel(runDir: string, name: string): string {
  return `${runDir}/${name}`;
}
