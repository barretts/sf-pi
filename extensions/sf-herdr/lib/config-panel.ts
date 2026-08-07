/* SPDX-License-Identifier: Apache-2.0 */
/** Global-only SF Herdr settings panel. */
import type { Theme } from "@earendil-works/pi-coding-agent";
import { type Focusable, matchesKey } from "@earendil-works/pi-tui";
import type { ConfigPanelFactory, ConfigPanelResult } from "../../../catalog/registry.ts";
import { HERDR_PLAN_INTENTS, type HerdrPlanIntent } from "../../../lib/common/herdr.ts";
import {
  readSfHerdrSettings,
  writeSfHerdrSettings,
  type HerdrLifecycle,
  type HerdrSplitDirection,
  type SfHerdrSettings,
} from "./settings.ts";

const DIRECTIONS: readonly HerdrSplitDirection[] = ["auto", "right", "down"];
const LIFECYCLES: readonly HerdrLifecycle[] = ["ephemeral", "sticky", "manual"];
const ROW_COUNT = 3;

class SfHerdrConfigPanel implements Focusable {
  focused = false;
  private settings: SfHerdrSettings;
  private savedSnapshot: string;
  private cursor = 0;
  private intentIndex = 0;
  private savedMessage = "";

  constructor(
    private readonly theme: Theme,
    private readonly done: (result: ConfigPanelResult | undefined) => void,
  ) {
    this.settings = readSfHerdrSettings();
    this.savedSnapshot = snapshot(this.settings);
  }

  handleInput(data: string): void {
    if (matchesKey(data, "escape") || matchesKey(data, "q")) {
      this.done(undefined);
      return;
    }
    if (matchesKey(data, "up")) return this.moveCursor(-1);
    if (matchesKey(data, "down")) return this.moveCursor(1);
    if (matchesKey(data, "left")) return this.changeCurrent(-1);
    if (matchesKey(data, "right") || matchesKey(data, "space")) return this.changeCurrent(1);
    if (data === "s" || data === "S" || matchesKey(data, "enter") || matchesKey(data, "return")) {
      this.save();
    }
  }

  renderContent(): string[] {
    const t = this.theme;
    const dirty = this.isDirty();
    const saved = JSON.parse(this.savedSnapshot) as SfHerdrSettings;
    const intent = this.selectedIntent();
    const row = (index: number, label: string, value: string, changed: boolean) => {
      const selected = index === this.cursor;
      return ` ${selected ? t.fg("accent", "›") : " "} ${changed ? t.fg("warning", "•") : " "} ${t.fg("muted", label.padEnd(18))} ${selected ? t.fg("accent", value) : t.fg("text", value)}`;
    };
    const lines = [
      ` ${t.fg("accent", t.bold("SF Herdr settings"))}  ${dirty ? t.fg("warning", "Unsaved changes") : t.fg("success", "Saved")}`,
      ` ${t.fg("dim", "Global-only planner defaults for the current split Herdr tools.")}`,
      "",
      row(
        0,
        "Split direction",
        this.settings.splitDirection,
        this.settings.splitDirection !== saved.splitDirection,
      ),
      row(1, "Intent", intent, false),
      row(
        2,
        "Lifecycle",
        this.settings.lifecycleByIntent[intent],
        this.settings.lifecycleByIntent[intent] !== saved.lifecycleByIntent[intent],
      ),
      "",
    ];
    if (this.savedMessage) lines.push(` ${t.fg("success", this.savedMessage)}`);
    lines.push(
      ` ${t.fg("dim", "↑/↓ select · ←/→/Space change · S/Enter save · Esc discard/back")}`,
    );
    return lines;
  }

  render(): string[] {
    return this.renderContent();
  }

  invalidate(): void {}

  private moveCursor(delta: -1 | 1): void {
    this.cursor = cycleIndex(this.cursor, ROW_COUNT, delta);
    this.savedMessage = "";
  }

  private changeCurrent(delta: -1 | 1): void {
    if (this.cursor === 0) {
      this.settings.splitDirection = cycleValue(DIRECTIONS, this.settings.splitDirection, delta);
    } else if (this.cursor === 1) {
      this.intentIndex = cycleIndex(this.intentIndex, HERDR_PLAN_INTENTS.length, delta);
    } else {
      const intent = this.selectedIntent();
      this.settings.lifecycleByIntent[intent] = cycleValue(
        LIFECYCLES,
        this.settings.lifecycleByIntent[intent],
        delta,
      );
    }
    this.savedMessage = "";
  }

  private selectedIntent(): HerdrPlanIntent {
    return HERDR_PLAN_INTENTS[this.intentIndex] ?? "run-tests";
  }

  private isDirty(): boolean {
    return snapshot(this.settings) !== this.savedSnapshot;
  }

  private save(): void {
    if (!this.isDirty()) {
      this.savedMessage = "No changes to save.";
      return;
    }
    writeSfHerdrSettings(this.settings);
    this.settings = readSfHerdrSettings();
    this.savedSnapshot = snapshot(this.settings);
    this.savedMessage = "Saved SF Herdr settings.";
  }
}

function snapshot(settings: SfHerdrSettings): string {
  return JSON.stringify(settings);
}

function cycleIndex(index: number, length: number, delta: -1 | 1): number {
  return (index + delta + length) % length;
}

function cycleValue<T extends string>(values: readonly T[], current: T, delta: -1 | 1): T {
  const index = Math.max(0, values.indexOf(current));
  return values[cycleIndex(index, values.length, delta)] ?? current;
}

export const createConfigPanel: ConfigPanelFactory = (theme, _cwd, _scope, done) =>
  new SfHerdrConfigPanel(theme, done);
