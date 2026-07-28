/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for SF Agent Script defaults and global quality rules. */
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  EVAL_CONCURRENCY_VALUES,
  EVAL_TRACE_MODES,
  PREVIEW_MOCK_MODES,
  readEffectiveAgentScriptSettings,
  writeScopedAgentScriptSettings,
  type AgentScriptSettings,
  type AgentScriptSettingsScope,
} from "./settings.ts";
import { AGENT_SCRIPT_QUALITY_RULES, type AgentScriptQualityRuleId } from "./quality/catalog.ts";
import {
  readEffectiveAgentScriptQualitySettings,
  setGlobalAgentScriptQualityAutoRun,
  setGlobalAgentScriptQualityRule,
} from "./quality/settings.ts";

type PanelPage =
  | { kind: "home" }
  | { kind: "rules"; filter: string; filtering: boolean }
  | { kind: "rule-detail"; ruleId: AgentScriptQualityRuleId };

class AgentScriptConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private ruleCursor = 0;
  private page: PanelPage = { kind: "home" };
  private draft: AgentScriptSettings;
  private saved: AgentScriptSettings;
  private qualityAutoRun: boolean;
  private savedQualityAutoRun: boolean;
  private qualityRules: Record<AgentScriptQualityRuleId, boolean>;
  private savedQualityRules: Record<AgentScriptQualityRuleId, boolean>;
  private source: string;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: AgentScriptSettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    const effective = readEffectiveAgentScriptSettings(cwd);
    this.draft = { ...effective };
    this.saved = { ...this.draft };
    this.source =
      effective.source === "default" ? "default" : `${effective.source} (${effective.path})`;
    const quality = readEffectiveAgentScriptQualitySettings();
    this.qualityAutoRun = quality.autoRun;
    this.savedQualityAutoRun = quality.autoRun;
    this.qualityRules = { ...quality.rules };
    this.savedQualityRules = { ...quality.rules };
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") {
      if (this.page.kind === "rule-detail") {
        this.page = { kind: "rules", filter: "", filtering: false };
        this.message = "";
        return;
      }
      if (this.page.kind === "rules") {
        if (this.page.filtering || this.page.filter) {
          this.page = { kind: "rules", filter: "", filtering: false };
          return;
        }
        this.page = { kind: "home" };
        this.message = "";
        return;
      }
      this.done(undefined);
      return;
    }

    if (this.page.kind === "rules" && this.page.filtering) {
      this.handleFilterInput(data);
      return;
    }

    if (this.page.kind === "rules") {
      this.handleRulesInput(data);
      return;
    }
    if (this.page.kind === "rule-detail") {
      this.handleRuleDetailInput(data);
      return;
    }
    this.handleHomeInput(data);
  }

  renderContent(width = 100): string[] {
    if (this.page.kind === "rules") return this.renderRules();
    if (this.page.kind === "rule-detail") return this.renderRuleDetail(width, this.page.ruleId);
    return this.renderHome();
  }

  render(width = 100): string[] {
    return this.renderContent(width);
  }
  invalidate(): void {}

  private handleHomeInput(data: string): void {
    const count = this.scope === "global" ? 5 : 3;
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      this.cursor = (this.cursor + (matchesKey(data, "up") ? count - 1 : 1)) % count;
      this.message = "";
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      if (this.scope === "global" && this.cursor === 4) {
        this.page = { kind: "rules", filter: "", filtering: false };
        this.ruleCursor = 0;
        this.message = "";
      } else {
        this.save();
      }
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      this.toggleHomeCurrent(matchesKey(data, "left") ? -1 : 1);
      return;
    }
    if (data === "s") this.save();
  }

  private handleRulesInput(data: string): void {
    const rows = this.filteredRules();
    if (matchesKey(data, "up") || matchesKey(data, "down")) {
      if (rows.length > 0) {
        this.ruleCursor =
          (this.ruleCursor + (matchesKey(data, "up") ? rows.length - 1 : 1)) % rows.length;
      }
      this.message = "";
      return;
    }
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      const rule = rows[this.ruleCursor];
      if (rule) this.qualityRules[rule.id] = !this.qualityRules[rule.id];
      this.message = "";
      return;
    }
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      const rule = rows[this.ruleCursor];
      if (rule) this.page = { kind: "rule-detail", ruleId: rule.id };
      return;
    }
    if (data === "/") {
      if (this.page.kind === "rules") this.page = { ...this.page, filtering: true };
      return;
    }
    if (data === "s") this.save();
  }

  private handleRuleDetailInput(data: string): void {
    if (matchesKey(data, "left") || matchesKey(data, "right") || matchesKey(data, "space")) {
      const rule = AGENT_SCRIPT_QUALITY_RULES.find((item) => item.id === this.pageRuleId());
      if (rule) this.qualityRules[rule.id] = !this.qualityRules[rule.id];
      this.message = "";
      return;
    }
    if (data === "s") this.save();
  }

  private handleFilterInput(data: string): void {
    if (this.page.kind !== "rules") return;
    if (matchesKey(data, "return") || matchesKey(data, "enter")) {
      this.page = { ...this.page, filtering: false };
      this.ruleCursor = 0;
      return;
    }
    if (matchesKey(data, "backspace")) {
      this.page = { ...this.page, filter: this.page.filter.slice(0, -1) };
      this.ruleCursor = 0;
      return;
    }
    if (isPrintable(data)) {
      this.page = { ...this.page, filter: this.page.filter + data };
      this.ruleCursor = 0;
    }
  }

  private renderHome(): string[] {
    const t = this.theme;
    const dirty = this.isDirty();
    const rows: string[] = [];
    rows.push(
      ...this.row(
        0,
        "Preview mock mode",
        this.draft.previewMockMode,
        "Default for agentscript_preview start when mock_mode is omitted.",
      ),
      ...this.row(
        1,
        "Eval trace mode",
        this.draft.evalTracesMode,
        "Default traces_mode for agentscript_eval run when omitted.",
      ),
      ...this.row(
        2,
        "Eval concurrency",
        String(this.draft.evalConcurrency),
        "Default concurrency for agentscript_eval run when omitted.",
      ),
    );
    if (this.scope === "global") {
      rows.push(
        ...this.row(
          3,
          "Quality auto-run",
          this.qualityAutoRun ? "on" : "off",
          "Run enabled High/Moderate quality rules after the agent settles.",
        ),
        ...this.row(
          4,
          "Quality rules",
          `${this.enabledRuleCount()}/18 enabled`,
          "Open the global per-rule On/Off controls.",
        ),
      );
    }
    return [
      ` ${t.fg("accent", t.bold("SF Agent Script Settings"))}`,
      ` ${t.fg("dim", "Defaults for Agent Script preview, eval, and native quality analysis.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      ` ${t.fg("muted", "Current source:")} ${t.fg("dim", this.source)}`,
      ` ${t.fg("muted", "Mode:")} ${t.fg("text", dirty ? "unsaved changes" : "saved")}`,
      "",
      ...rows,
      ...(this.scope === "project"
        ? ["", ` ${t.fg("dim", "Quality rule controls are global-only.")}`]
        : []),
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "↑/↓ move · ←/→ toggle · Enter open/save · S save · Esc back")}`,
    ];
  }

  private renderRules(): string[] {
    const t = this.theme;
    const rows = this.filteredRules();
    const dirty = this.isQualityDirty();
    const lines = [
      ` ${t.fg("accent", t.bold("Agent Script Quality Rules"))}`,
      ` ${t.fg("dim", `${this.enabledRuleCount()}/18 enabled · ${dirty ? "unsaved changes" : "saved"}`)}`,
      ...(this.page.kind === "rules" && this.page.filter
        ? [` ${t.fg("muted", "Filter:")} ${t.fg("accent", this.page.filter)}`]
        : []),
      "",
    ];
    for (let i = 0; i < rows.length; i++) {
      const rule = rows[i];
      if (!rule) continue;
      const selected = i === Math.min(this.ruleCursor, Math.max(0, rows.length - 1));
      const marker = selected ? t.fg("accent", "→") : " ";
      const state = this.qualityRules[rule.id] ? "On" : "Off";
      lines.push(` ${marker} ${rule.name.padEnd(43)} ${rule.severity.padEnd(9)} ${state}`);
      if (selected) lines.push(`    ${t.fg("dim", `${rule.id} · ${rule.description}`)}`);
    }
    if (rows.length === 0) lines.push(` ${t.fg("warning", "No matching rules.")}`);
    lines.push(
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "↑/↓ move · Space toggle · Enter details · / filter · S save · Esc back")}`,
    );
    return lines;
  }

  private renderRuleDetail(_width: number, ruleId: AgentScriptQualityRuleId): string[] {
    const rule = AGENT_SCRIPT_QUALITY_RULES.find((item) => item.id === ruleId);
    if (!rule) return [` ${this.theme.fg("warning", `Rule not found: ${ruleId}`)}`];
    const t = this.theme;
    return [
      ` ${t.fg("accent", t.bold(rule.name))}`,
      "",
      ` ${t.fg("muted", "Rule ID:")} ${rule.id}`,
      ` ${t.fg("muted", "Severity:")} ${rule.severity}`,
      ` ${t.fg("muted", "Category:")} ${rule.category}`,
      ` ${t.fg("muted", "State:")} ${this.qualityRules[rule.id] ? "On" : "Off"}`,
      ` ${t.fg("muted", "Default:")} ${rule.defaultEnabled ? "On" : "Off"}`,
      "",
      ` ${rule.description}`,
      ...(rule.severity === "high" && !this.qualityRules[rule.id]
        ? ["", ` ${t.fg("warning", "Disabling this rule removes it from the publication gate.")}`]
        : []),
      "",
      ...(this.message ? [` ${t.fg("success", this.message)}`] : []),
      ` ${t.fg("dim", "Space toggle · S save · Esc back")}`,
    ];
  }

  private row(index: number, label: string, value: string, detail: string): string[] {
    const t = this.theme;
    return [
      ` ${this.cursor === index ? t.fg("accent", "→") : " "} ${t.fg(this.cursor === index ? "accent" : "text", label.padEnd(24))} ${t.fg("muted", value)}`,
      `    ${t.fg("dim", detail)}`,
    ];
  }

  private toggleHomeCurrent(direction: -1 | 1): void {
    if (this.cursor === 0)
      this.draft.previewMockMode = cycle(PREVIEW_MOCK_MODES, this.draft.previewMockMode, direction);
    else if (this.cursor === 1)
      this.draft.evalTracesMode = cycle(EVAL_TRACE_MODES, this.draft.evalTracesMode, direction);
    else if (this.cursor === 2)
      this.draft.evalConcurrency = cycle(
        EVAL_CONCURRENCY_VALUES,
        this.draft.evalConcurrency,
        direction,
      );
    else if (this.scope === "global" && this.cursor === 3)
      this.qualityAutoRun = !this.qualityAutoRun;
    this.message = "";
  }

  private save(): void {
    const toolDirty = JSON.stringify(this.draft) !== JSON.stringify(this.saved);
    const qualityDirty = this.isQualityDirty();
    if (!toolDirty && !qualityDirty) {
      this.message = "No changes to save.";
      return;
    }
    if (toolDirty) {
      const saved = writeScopedAgentScriptSettings(this.cwd, this.scope, this.draft);
      this.saved = {
        previewMockMode: saved.previewMockMode,
        evalTracesMode: saved.evalTracesMode,
        evalConcurrency: saved.evalConcurrency,
      };
      this.source = `${saved.source} (${saved.path})`;
    }
    if (qualityDirty && this.scope === "global") {
      if (this.qualityAutoRun !== this.savedQualityAutoRun) {
        setGlobalAgentScriptQualityAutoRun(this.qualityAutoRun);
      }
      for (const rule of AGENT_SCRIPT_QUALITY_RULES) {
        if (this.qualityRules[rule.id] !== this.savedQualityRules[rule.id]) {
          setGlobalAgentScriptQualityRule(rule.id, this.qualityRules[rule.id]);
        }
      }
      this.savedQualityAutoRun = this.qualityAutoRun;
      this.savedQualityRules = { ...this.qualityRules };
    }
    this.message = qualityDirty
      ? `Saved Agent Script quality rules. ${this.disabledHighRuleCount()} High publication check(s) disabled.`
      : "Saved Agent Script settings.";
  }

  private filteredRules() {
    const filter = this.page.kind === "rules" ? this.page.filter.trim().toLowerCase() : "";
    if (!filter) return [...AGENT_SCRIPT_QUALITY_RULES];
    return AGENT_SCRIPT_QUALITY_RULES.filter((rule) =>
      `${rule.name} ${rule.id} ${rule.severity} ${rule.description}`.toLowerCase().includes(filter),
    );
  }

  private isDirty(): boolean {
    return JSON.stringify(this.draft) !== JSON.stringify(this.saved) || this.isQualityDirty();
  }

  private isQualityDirty(): boolean {
    return (
      this.qualityAutoRun !== this.savedQualityAutoRun ||
      AGENT_SCRIPT_QUALITY_RULES.some(
        (rule) => this.qualityRules[rule.id] !== this.savedQualityRules[rule.id],
      )
    );
  }

  private enabledRuleCount(): number {
    return AGENT_SCRIPT_QUALITY_RULES.filter((rule) => this.qualityRules[rule.id]).length;
  }

  private disabledHighRuleCount(): number {
    return AGENT_SCRIPT_QUALITY_RULES.filter(
      (rule) => rule.severity === "high" && !this.qualityRules[rule.id],
    ).length;
  }

  private pageRuleId(): AgentScriptQualityRuleId | undefined {
    return this.page.kind === "rule-detail" ? this.page.ruleId : undefined;
  }
}

function cycle<T>(values: readonly T[], current: T, direction: -1 | 1): T {
  const index = Math.max(0, values.indexOf(current));
  return values[(index + direction + values.length) % values.length] ?? current;
}

function isPrintable(data: string): boolean {
  return data.length === 1 && data >= " " && data !== "\x7f";
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) =>
  new AgentScriptConfigPanel(theme, cwd, scope, done);
