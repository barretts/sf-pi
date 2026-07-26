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

/**
 * Data-model card geometry. The canvas program lays child text out against these
 * same constants, so estimated card size and rendered content stay in step.
 */
export const DATA_MODEL_CARD = {
  textX: 116,
  padRight: 22,
  padBottom: 26,
  labelY: 34,
  iconBottom: 106,
  minContentWidth: 190,
  maxContentWidth: 340,
  labelCharWidth: 13.6,
  labelLineHeight: 33,
  smallCharWidth: 11.4,
  smallLineHeight: 25,
  apiGap: 8,
  keysGap: 10,
  observationAllowance: 14,
} as const;

/** Deterministic card size from declared label/API/key-field text. */
export function dataModelCardSize(object: {
  label: string;
  api_name: string;
  key_fields?: string[];
}): { w: number; h: number } {
  const c = DATA_MODEL_CARD;
  const labelPx = object.label.length * c.labelCharWidth;
  const apiPx = (object.api_name.length + 2) * c.smallCharWidth;
  const keysText = object.key_fields?.slice(0, 4).join(" · ") ?? "";
  const keysPx = keysText.length * c.smallCharWidth;
  const contentWidth = Math.min(
    c.maxContentWidth,
    Math.max(c.minContentWidth, Math.ceil(labelPx / 2), apiPx, Math.min(keysPx, c.maxContentWidth)),
  );
  const lines = (px: number) => Math.max(1, Math.ceil(px / contentWidth));
  let bottom = c.labelY + lines(labelPx) * c.labelLineHeight;
  bottom += c.apiGap + lines(apiPx) * c.smallLineHeight;
  if (keysText) bottom += c.keysGap + lines(keysPx) * c.smallLineHeight;
  return {
    w: Math.round(c.textX + contentWidth + c.padRight),
    h: Math.round(Math.max(c.iconBottom, bottom) + c.padBottom),
  };
}

export function layoutDataModel(spec: DataModelSpec): PositionedNode[] {
  const sizes = new Map(
    spec.objects.map((object) => {
      const size = dataModelCardSize(object);
      const extra =
        (object.observations?.owd ?? object.observations?.record_types)
          ? DATA_MODEL_CARD.observationAllowance
          : 0;
      return [object.id, { w: size.w, h: size.h + extra }];
    }),
  );
  return layoutGraph(
    spec.objects.map((object) => object.id),
    spec.relationships.map((relationship) => ({
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
    })),
    {
      width: 340,
      height: 160,
      rankSep: 240,
      nodeSep: 90,
      sizes,
      candidates: [
        { rankdir: "LR", ranker: "network-simplex" },
        { rankdir: "TB", ranker: "network-simplex" },
        { rankdir: "LR", ranker: "tight-tree" },
        { rankdir: "TB", ranker: "tight-tree" },
      ],
    },
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

/** Landscape target used to pick between candidate graph orientations. */
const TARGET_ASPECT = 1.6;

/**
 * Salesforce reference models are mostly hub-and-spoke, so a single fixed rank
 * direction produces either a very tall ladder or a very wide strip depending on the
 * model. Lay the graph out with every candidate direction/ranker, then keep the one
 * whose bounding box is closest to a landscape page. Candidate order is fixed, so the
 * choice stays deterministic for a given spec.
 */
function layoutGraph(
  nodeIds: string[],
  edges: Array<{ id: string; from: string; to: string }>,
  options: {
    width: number;
    height: number;
    rankSep: number;
    nodeSep: number;
    sizes?: Map<string, { w: number; h: number }>;
    candidates?: Array<{ rankdir: "LR" | "TB"; ranker: "network-simplex" | "tight-tree" }>;
  },
): PositionedNode[] {
  const candidates = options.candidates ?? [
    { rankdir: "LR" as const, ranker: "network-simplex" as const },
  ];
  let best: { nodes: PositionedNode[]; score: number } | undefined;
  for (const candidate of candidates) {
    const nodes = layoutGraphWith(nodeIds, edges, options, candidate);
    const width = Math.max(...nodes.map((node) => node.x + node.w)) - GRAPH_LEFT;
    const height = Math.max(...nodes.map((node) => node.y + node.h)) - GRAPH_TOP;
    const score = Math.abs(Math.log(width / Math.max(1, height) / TARGET_ASPECT));
    if (!best || score < best.score - 1e-9) best = { nodes, score };
  }
  if (!best) throw new Error("No graph layout candidate produced a result.");
  return best.nodes;
}

function layoutGraphWith(
  nodeIds: string[],
  edges: Array<{ id: string; from: string; to: string }>,
  options: {
    width: number;
    height: number;
    rankSep: number;
    nodeSep: number;
    sizes?: Map<string, { w: number; h: number }>;
  },
  candidate: { rankdir: "LR" | "TB"; ranker: "network-simplex" | "tight-tree" },
): PositionedNode[] {
  const graph = new dagre.graphlib.Graph({ multigraph: true });
  graph.setGraph({
    rankdir: candidate.rankdir,
    ranker: candidate.ranker,
    ranksep: options.rankSep,
    nodesep: options.nodeSep,
    edgesep: 70,
    marginx: 0,
    marginy: 0,
  });
  graph.setDefaultEdgeLabel(() => ({}));
  for (const id of [...nodeIds].sort()) {
    const size = options.sizes?.get(id);
    graph.setNode(id, {
      width: size?.w ?? options.width,
      height: size?.h ?? options.height,
    });
  }
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
