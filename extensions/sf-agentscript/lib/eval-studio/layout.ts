/* SPDX-License-Identifier: Apache-2.0 */
/** ANSI-safe responsive table layout for Eval Studio. */

import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

export interface StudioTableColumn<Row> {
  header: string;
  min: number;
  max?: number;
  weight?: number;
  align?: "left" | "right";
  /** Hide this column when content width is below this breakpoint. */
  showAt?: number;
  value: (row: Row) => string;
}

function padCell(value: string, width: number, align: "left" | "right"): string {
  const clipped = truncateToWidth(value, width, "…");
  const padding = " ".repeat(Math.max(0, width - visibleWidth(clipped)));
  return align === "right" ? padding + clipped : clipped + padding;
}

function columnWidths<Row>(width: number, columns: StudioTableColumn<Row>[]): number[] {
  const gapWidth = Math.max(0, columns.length - 1) * 2;
  const available = Math.max(columns.length, width - gapWidth);
  const widths = columns.map((column) => column.min);
  let remaining = available - widths.reduce((sum, value) => sum + value, 0);
  if (remaining < 0) {
    let overflow = -remaining;
    const shrinkable = columns
      .map((column, index) => ({ index, weight: column.weight ?? 0 }))
      .sort((a, b) => b.weight - a.weight);
    while (overflow > 0) {
      let changed = false;
      for (const column of shrinkable) {
        if (overflow === 0) break;
        const floor = column.weight > 0 ? 4 : 1;
        if (widths[column.index] <= floor) continue;
        widths[column.index]--;
        overflow--;
        changed = true;
      }
      if (!changed) break;
    }
    return widths;
  }
  if (remaining === 0) return widths;

  const weighted = columns
    .map((column, index) => ({ index, weight: column.weight ?? 0, max: column.max ?? Infinity }))
    .filter((column) => column.weight > 0);
  while (remaining > 0 && weighted.length > 0) {
    let changed = false;
    for (const column of weighted) {
      if (remaining === 0) break;
      if (widths[column.index] >= column.max) continue;
      const share = Math.max(1, Math.floor(column.weight));
      const delta = Math.min(share, remaining, column.max - widths[column.index]);
      widths[column.index] += delta;
      remaining -= delta;
      changed = true;
    }
    if (!changed) break;
  }
  return widths;
}

export function renderStudioTable<Row>(input: {
  width: number;
  columns: StudioTableColumn<Row>[];
  rows: Row[];
  styleHeader?: (value: string) => string;
  styleDivider?: (value: string) => string;
}): string[] {
  const columns = input.columns.filter((column) => input.width >= (column.showAt ?? 0));
  if (columns.length === 0) return [];
  const widths = columnWidths(input.width, columns);
  const render = (values: string[]): string =>
    values
      .map((value, index) => padCell(value, widths[index], columns[index].align ?? "left"))
      .join("  ");
  const header = render(columns.map((column) => column.header));
  const divider = widths.map((width) => "─".repeat(width)).join("  ");
  return [
    input.styleHeader ? input.styleHeader(header) : header,
    input.styleDivider ? input.styleDivider(divider) : divider,
    ...input.rows.map((row) => render(columns.map((column) => column.value(row)))),
  ];
}
