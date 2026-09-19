/* SPDX-License-Identifier: Apache-2.0 */
/** Mermaid source projection and terminal rendering for Flow graphs. */

import { render } from "grok-mermaid";
import type { FlowModel, FlowTopologyDigest } from "./types.ts";

export function buildMermaidTopology(
  model: FlowModel,
  maxNodes = 24,
): FlowTopologyDigest & { source: string } {
  const selected = model.elements.slice(0, Math.max(1, maxNodes));
  const selectedIds = new Set(selected.map((element) => element.id));
  const nodeIds = new Map(selected.map((element, index) => [element.id, `n${index}`]));
  const lines = ["flowchart TD"];
  for (const element of selected) {
    const id = nodeIds.get(element.id);
    if (!id) continue;
    const label = mermaidLabel(
      element.kind === "start" ? startLabel(model) : (element.label ?? element.name),
    );
    lines.push(`    ${id}${shape(element.kind, label)}`);
  }
  let missingIndex = 0;
  const missing = new Map<string, string>();
  const edges = model.connectors.filter((connector) => selectedIds.has(connector.from));
  for (const connector of edges) {
    if (!connector.to) continue;
    let target = nodeIds.get(connector.to);
    if (!target) {
      if (model.elements.some((element) => element.id === connector.to)) continue;
      target = missing.get(connector.to);
      if (!target) {
        target = `missing${missingIndex++}`;
        missing.set(connector.to, target);
        lines.push(`    ${target}["Missing: ${mermaidLabel(connector.to)}"]`);
      }
    }
    const from = nodeIds.get(connector.from);
    if (!from) continue;
    const label = mermaidLabel(
      connector.fault ? "Fault" : (connector.label ?? connectorLabel(connector.kind)),
    );
    lines.push(
      connector.fault
        ? `    ${from} -.->|${label}| ${target}`
        : `    ${from} -->|${label}| ${target}`,
    );
  }
  const source = lines.join("\n");
  return {
    source,
    mermaid: source,
    nodes: selected.length + missing.size,
    edges: edges.filter((edge) => edge.to).length,
    truncated: model.elements.length > selected.length,
  };
}

export function renderMermaidTopology(
  source: string,
  width: number,
): { lines: string[]; fallback: boolean; warnings: string[] } {
  const art = render(source);
  if (!art || art.width > width || art.warnings.length > 0) {
    return {
      lines: [
        `Topology available as Mermaid (${source.split("\n").length - 1} statements); expand artifacts for source.`,
      ],
      fallback: true,
      warnings: art?.warnings ?? ["Mermaid could not render this topology"],
    };
  }
  return { lines: art.plain, fallback: false, warnings: [] };
}

function shape(kind: string, label: string): string {
  if (kind === "start") return `(["${label}"])`;
  if (kind === "decisions") return `{"${label}"}`;
  if (kind === "loops") return `{{"${label}"}}`;
  if (kind === "screens") return `[["${label}"]]`;
  return `["${label}"]`;
}

function startLabel(model: FlowModel): string {
  return ["Start", model.trigger_type ?? model.family].filter(Boolean).join(": ");
}

function connectorLabel(kind: string): string {
  if (kind === "nextValueConnector") return "Next";
  if (kind === "noMoreValuesConnector") return "Done";
  if (kind === "defaultConnector") return "Default";
  return "Next";
}

function mermaidLabel(value: string): string {
  return value
    .replace(/["“”]/g, "'")
    .replace(/[|\n\r]/g, " ")
    .slice(0, 48);
}
