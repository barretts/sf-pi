/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic Dagre graph layout and fixed sequence lanes. */
import dagre from "@dagrejs/dagre";
import type { ArchitectureSpec, DataModelSpec, PositionedNode, SequenceSpec } from "./types.ts";

const GRAPH_TOP = 330;
const GRAPH_LEFT = 100;

export function layoutDataModel(spec: DataModelSpec): PositionedNode[] {
  return layoutGraph(
    spec.objects.map((object) => object.id),
    spec.relationships.map((relationship) => ({
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
    })),
    { width: 330, height: 230, rankSep: 190, nodeSep: 140 },
  );
}

export function layoutArchitecture(spec: ArchitectureSpec): PositionedNode[] {
  return layoutGraph(
    spec.systems.map((system) => system.id),
    spec.connections.map((connection) => ({
      id: connection.id,
      from: connection.from,
      to: connection.to,
    })),
    { width: 360, height: 200, rankSep: 210, nodeSep: 150 },
  );
}

export function layoutSequence(spec: SequenceSpec): PositionedNode[] {
  const laneGap = 390;
  return spec.participants.map((participant, index) => ({
    id: participant.id,
    x: GRAPH_LEFT + index * laneGap,
    y: GRAPH_TOP,
    w: 270,
    h: 120,
  }));
}

function layoutGraph(
  nodeIds: string[],
  edges: Array<{ id: string; from: string; to: string }>,
  options: { width: number; height: number; rankSep: number; nodeSep: number },
): PositionedNode[] {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: "LR",
    ranker: "network-simplex",
    align: "UL",
    ranksep: options.rankSep,
    nodesep: options.nodeSep,
    edgesep: 70,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const id of [...nodeIds].sort())
    graph.setNode(id, { width: options.width, height: options.height });
  for (const edge of [...edges].sort((a, b) => a.id.localeCompare(b.id))) {
    graph.setEdge(edge.from, edge.to, { minlen: 1, weight: 2 }, edge.id);
  }
  dagre.layout(graph);
  const positions = [...nodeIds].sort().map((id) => {
    const node = graph.node(id) as { x: number; y: number; width: number; height: number };
    return {
      id,
      x: Math.round(node.x - node.width / 2 + GRAPH_LEFT),
      y: Math.round(node.y - node.height / 2 + GRAPH_TOP),
      w: node.width,
      h: node.height,
    };
  });
  normalizeToMargin(positions);
  return positions;
}

function normalizeToMargin(nodes: PositionedNode[]): void {
  if (nodes.length === 0) return;
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const dx = GRAPH_LEFT - minX;
  const dy = GRAPH_TOP - minY;
  for (const node of nodes) {
    node.x += dx;
    node.y += dy;
  }
}
