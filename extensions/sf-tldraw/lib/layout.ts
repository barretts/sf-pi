/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic Dagre graph layout and fixed sequence lanes. */
import dagre from "@dagrejs/dagre";
import type { ArchitectureSpec, DataModelSpec, PositionedNode, SequenceSpec } from "./types.ts";

const GRAPH_TOP = 330;
const GRAPH_LEFT = 100;
const SEQUENCE_TOP = 290;
const SEQUENCE_CARD_HEIGHT = 96;
const SEQUENCE_MIN_CARD_WIDTH = 260;
const SEQUENCE_MAX_CARD_WIDTH = 360;
const SEQUENCE_LANE_GAPS = { compact: 110, medium: 120, roomy: 140 } as const;

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
  const laneGap =
    spec.participants.length <= 4
      ? SEQUENCE_LANE_GAPS.roomy
      : spec.participants.length <= 6
        ? SEQUENCE_LANE_GAPS.medium
        : SEQUENCE_LANE_GAPS.compact;
  let x = GRAPH_LEFT;
  return spec.participants.map((participant) => {
    const visualAllowance = participant.icon || participant.product_mark ? 90 : 0;
    const width = Math.max(
      SEQUENCE_MIN_CARD_WIDTH,
      Math.min(SEQUENCE_MAX_CARD_WIDTH, 88 + participant.label.length * 8 + visualAllowance),
    );
    const node = {
      id: participant.id,
      x,
      y: SEQUENCE_TOP,
      w: width,
      h: SEQUENCE_CARD_HEIGHT,
    };
    x += width + laneGap;
    return node;
  });
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
