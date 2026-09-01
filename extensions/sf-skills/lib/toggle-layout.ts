/* SPDX-License-Identifier: Apache-2.0 */
/** Fixed split-pane geometry and preview model for the skills toggle. */
import { truncateToWidth } from "@earendil-works/pi-tui";

export const TOGGLE_BODY_LINES = 20;
export const TOGGLE_PREVIEW_WHY_LINES = 8;
export const TOGGLE_CHROME = 4;
export const TOGGLE_ORIGIN_HEADER = "Origin";
export const TOGGLE_ORIGIN_MIN = 11;
export const TOGGLE_INVOCATION_HEADER = "Invocation";
export const TOGGLE_INVOCATION_MIN = 20;

export interface TogglePreviewSelection {
  kind: "pack" | "skill";
  id: string;
  packLabel: string;
  origin: "Salesforce" | "Community";
  mode: "agent-invocable" | "manual-only" | "mixed";
  locked: boolean;
  description?: string;
  filePath?: string;
}

export interface TogglePreviewMember {
  name: string;
  on: boolean;
  locked: boolean;
}

export function splitTogglePane(innerWidth: number): {
  left: number;
  right: number;
  gutter: number;
} {
  const gutter = 3;
  const usable = Math.max(64, innerWidth);
  const left = Math.max(40, Math.floor((usable - gutter) * 0.5));
  const right = Math.max(26, usable - gutter - left);
  return { left, right, gutter };
}

export function wrapPlain(text: string, width: number): string[] {
  const max = Math.max(8, width);
  const words = text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const chunks =
      word.length <= max ? [word] : (word.match(new RegExp(`.{1,${max}}`, "g")) ?? [word]);
    for (const chunk of chunks) {
      const next = current ? `${current} ${chunk}` : chunk;
      if (next.length > max && current) {
        lines.push(current);
        current = chunk;
        continue;
      }
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function padLines(lines: string[], count: number): string[] {
  const next = lines.slice(0, count);
  while (next.length < count) next.push("");
  return next;
}

export function buildPreviewLines(input: {
  row?: TogglePreviewSelection;
  members?: readonly TogglePreviewMember[];
  width: number;
}): string[] {
  const width = Math.max(16, input.width);
  const row = input.row;
  if (!row) return padLines(["No selection"], TOGGLE_BODY_LINES);

  const lines: string[] = [
    truncateToWidth(row.kind === "pack" ? row.packLabel : row.id, width, "…"),
  ];
  lines.push(truncateToWidth(`${row.origin} · ${row.packLabel}`, width, "…"));
  lines.push(stateLabel(row));
  lines.push("");

  if (row.kind === "pack") {
    const members = input.members ?? [];
    const on = members.filter((member) => member.on).length;
    const locked = members.filter((member) => member.locked).length;
    lines.push("Pack");
    lines.push(
      truncateToWidth(`${members.length} skills · ${on} on · ${locked} locked`, width, "…"),
    );
    lines.push("");
    lines.push("Members");
    const names = members
      .slice(0, 6)
      .map((member) => truncateToWidth(`· ${member.name}`, width, "…"));
    if (members.length > 6)
      names[5] = truncateToWidth(`· … +${members.length - 6} more`, width, "…");
    lines.push(...padLines(names, 6));
  } else {
    lines.push("When to load");
    const why = wrapPlain(row.description ?? "", width).slice(0, TOGGLE_PREVIEW_WHY_LINES);
    lines.push(...padLines(why.length > 0 ? why : ["No description."], TOGGLE_PREVIEW_WHY_LINES));
    lines.push("");
    lines.push("Path");
    lines.push(truncateToWidth(row.filePath || "—", width, "…"));
  }

  lines.push("");
  lines.push(row.locked ? "Locked — author or read-only" : "[space] toggle   [ctrl+s] apply");
  return padLines(lines, TOGGLE_BODY_LINES);
}

function stateLabel(row: TogglePreviewSelection): string {
  if (row.locked) return "Locked — /skill:name only";
  if (row.mode === "agent-invocable") return "On — in the system prompt";
  if (row.mode === "mixed") return "Mixed — some skills on";
  return "Off — /skill:name only";
}
