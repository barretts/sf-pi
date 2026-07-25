/* SPDX-License-Identifier: Apache-2.0 */
/** Manager Settings panel for the four sf-tldraw presentation preferences. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey, visibleWidth } from "@earendil-works/pi-tui";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import {
  clearTldrawPreference,
  preferenceSourceLabel,
  readEffectiveTldrawPreferences,
  readScopedTldrawPreferences,
  writeTldrawPreference,
} from "./settings.ts";
import type { SettingsScope, TldrawPreferenceKey, TldrawPreferences } from "./types.ts";

const INHERIT = "__inherit__";
const DEFAULT = "__default__";
type DraftValue = TldrawPreferences[TldrawPreferenceKey] | typeof INHERIT | typeof DEFAULT;

interface Row {
  key: TldrawPreferenceKey;
  label: string;
  description: string;
  values: Array<TldrawPreferences[TldrawPreferenceKey]>;
}

const ROWS: Row[] = [
  {
    key: "cardinalityDetail",
    label: "Cardinality detail",
    description: "Simplified bar/crow-foot or full physical optionality.",
    values: ["simplified", "full"],
  },
  {
    key: "ldvThreshold",
    label: "LDV threshold",
    description: "Minimum observed row count that receives an LDV pill.",
    values: ["1M", "2M", "5M", "10M"],
  },
  {
    key: "recordTypeMode",
    label: "Record types",
    description:
      "Off by default; auto shows meaningful multiplicity; always shows supplied values.",
    values: ["off", "auto", "always"],
  },
  {
    key: "interactionMode",
    label: "Sequence interaction",
    description: "Static is deterministic; step-through is source-gated and never autoplays.",
    values: ["static", "step_through"],
  },
];

class SfTldrawConfigPanel implements Focusable {
  focused = false;
  private cursor = 0;
  private draft: Record<TldrawPreferenceKey, DraftValue>;
  private saved: Record<TldrawPreferenceKey, DraftValue>;
  private message = "";

  constructor(
    private readonly theme: Theme,
    private readonly cwd: string,
    private readonly scope: SettingsScope,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    this.draft = this.readDraft();
    this.saved = { ...this.draft };
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || data === "q") return this.done(undefined);
    if (matchesKey(data, "up")) return this.move(-1);
    if (matchesKey(data, "down")) return this.move(1);
    if (matchesKey(data, "left")) return this.cycle(-1);
    if (matchesKey(data, "right") || matchesKey(data, "space")) return this.cycle(1);
    if (matchesKey(data, "enter") || matchesKey(data, "return") || data === "s") this.save();
  }

  render(width: number): string[] {
    const t = this.theme;
    const effective = readEffectiveTldrawPreferences(this.cwd);
    const lines = [
      ` ${t.fg("accent", t.bold("🎨 SF tldraw Settings"))}`,
      ` ${t.fg("dim", "Four scalar presentation choices only. Diagram grammar, icons, palette, and fonts stay deterministic.")}`,
      "",
      ` ${t.fg("muted", "Scope:")} ${t.fg("text", this.scope)}`,
      "",
    ];
    for (let index = 0; index < ROWS.length; index++) {
      const row = ROWS[index];
      if (!row) continue;
      const selected = index === this.cursor;
      const cursor = selected ? t.fg("accent", "→") : " ";
      const label = selected ? t.fg("accent", row.label) : t.fg("text", row.label);
      const draft = displayDraft(this.draft[row.key]);
      const effectiveValue = effective[row.key];
      const source = preferenceSourceLabel(effective, row.key);
      lines.push(` ${cursor} ${label.padEnd(25)} ${t.fg("muted", draft)}`);
      if (selected) {
        lines.push(`    ${t.fg("dim", row.description)}`);
        lines.push(`    ${t.fg("dim", `Effective: ${effectiveValue} · source: ${source}`)}`);
      }
    }
    lines.push("");
    if (this.message) lines.push(` ${t.fg("success", this.message)}`);
    lines.push(` ${t.fg("dim", "↑/↓ move · ←/→ change · S/Enter save · Esc back")}`);
    return lines.map((line) => pad(line, width));
  }

  invalidate(): void {}

  private readDraft(): Record<TldrawPreferenceKey, DraftValue> {
    const scoped = readScopedTldrawPreferences(this.cwd, this.scope);
    const sentinel = this.scope === "project" ? INHERIT : DEFAULT;
    return {
      cardinalityDetail: scoped.cardinalityDetail ?? sentinel,
      ldvThreshold: scoped.ldvThreshold ?? sentinel,
      recordTypeMode: scoped.recordTypeMode ?? sentinel,
      interactionMode: scoped.interactionMode ?? sentinel,
    };
  }

  private move(delta: -1 | 1): void {
    this.cursor = (this.cursor + delta + ROWS.length) % ROWS.length;
    this.message = "";
  }

  private cycle(delta: -1 | 1): void {
    const row = ROWS[this.cursor];
    if (!row) return;
    const sentinel = this.scope === "project" ? INHERIT : DEFAULT;
    const values: DraftValue[] = [sentinel, ...row.values];
    const index = Math.max(0, values.indexOf(this.draft[row.key]));
    const next = values[(index + delta + values.length) % values.length];
    if (next !== undefined) this.draft[row.key] = next;
    this.message = "";
  }

  private save(): void {
    let changed = false;
    for (const row of ROWS) {
      const value = this.draft[row.key];
      if (value === this.saved[row.key]) continue;
      changed = true;
      if (value === INHERIT || value === DEFAULT)
        clearTldrawPreference(this.cwd, this.scope, row.key);
      else writeTldrawPreference(this.cwd, this.scope, row.key, value as never);
    }
    this.saved = { ...this.draft };
    this.message = changed ? "Saved SF tldraw settings." : "No changes to save.";
  }
}

export const createConfigPanel: ConfigPanelFactory = (theme, cwd, scope, done) => {
  return new SfTldrawConfigPanel(theme, cwd, scope, done);
};

function displayDraft(value: DraftValue): string {
  if (value === INHERIT) return "Inherit global";
  if (value === DEFAULT) return "Use default";
  return String(value);
}

function pad(value: string, width: number): string {
  return `${value}${" ".repeat(Math.max(0, width - visibleWidth(value)))}`;
}
