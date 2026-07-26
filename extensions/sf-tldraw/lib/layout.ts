/* SPDX-License-Identifier: Apache-2.0 */
/** Deterministic Dagre graph layout and fixed sequence lanes. */
import dagre from "@dagrejs/dagre";
import type {
  ArchitectureSpec,
  DataModelObject,
  DataModelSourcePosition,
  DataModelSpec,
  PositionedNode,
  SequenceSpec,
} from "./types.ts";

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
  api_name?: string;
  key_fields?: string[];
}): { w: number; h: number } {
  const c = DATA_MODEL_CARD;
  const labelPx = object.label.length * c.labelCharWidth;
  const apiPx = object.api_name ? (object.api_name.length + 2) * c.smallCharWidth : 0;
  const keysText = object.key_fields?.slice(0, 4).join(" · ") ?? "";
  const keysPx = keysText.length * c.smallCharWidth;
  const contentWidth = Math.min(
    c.maxContentWidth,
    Math.max(c.minContentWidth, Math.ceil(labelPx / 2), apiPx, Math.min(keysPx, c.maxContentWidth)),
  );
  const lines = (px: number) => Math.max(1, Math.ceil(px / contentWidth));
  let bottom = c.labelY + lines(labelPx) * c.labelLineHeight;
  if (apiPx) bottom += c.apiGap + lines(apiPx) * c.smallLineHeight;
  if (keysText) bottom += c.keysGap + lines(keysPx) * c.smallLineHeight;
  return {
    w: Math.round(c.textX + contentWidth + c.padRight),
    h: Math.round(Math.max(c.iconBottom, bottom) + c.padBottom),
  };
}

/**
 * Connector anchors are spread across the middle 68% of a card side, so a side carrying
 * n connectors needs enough length for n terminals at this pitch. High-degree hub
 * objects are therefore elongated along the side they connect on, the way the published
 * Salesforce ERD posters stretch Account and Opportunity into bars and columns.
 */
const ANCHOR_PITCH = 46;
const ANCHOR_SPREAD = 0.68;
// Supports up to 36 terminals on one side at the declared pitch. Validation rejects
// higher per-node degree before layout rather than creating an unreadable unbounded bar.
const MAX_CARD_EXTENT = 2_400;
const SIDE_GAP = 20;
const COMPONENT_GAP = 220;
const HUB_GROWTH_PASSES = 3;

type CardSide = "left" | "right" | "top" | "bottom";

function sideLength(connectorCount: number): number {
  if (connectorCount <= 1) return 0;
  return Math.ceil(((connectorCount - 1) * ANCHOR_PITCH) / ANCHOR_SPREAD);
}

/** Facing sides for a relationship, matching the canvas program's binding rule. */
function facingSides(
  from: PositionedNode,
  to: PositionedNode,
): { from: CardSide; to: CardSide } | null {
  if (to.x >= from.x + from.w + SIDE_GAP) return { from: "right", to: "left" };
  if (from.x >= to.x + to.w + SIDE_GAP) return { from: "left", to: "right" };
  if (to.y >= from.y + from.h + SIDE_GAP) return { from: "bottom", to: "top" };
  if (from.y >= to.y + to.h + SIDE_GAP) return { from: "top", to: "bottom" };
  return null;
}

type DataModelCandidate = GraphCandidate & { rankSep: number; nodeSep: number };

type SourcePositionedObject = DataModelObject & { source_position: DataModelSourcePosition };
type LayoutQuality = readonly [number, number, number, number, number, number];

const DATA_MODEL_CANDIDATES: DataModelCandidate[] = [
  { rankdir: "LR", ranker: "network-simplex", rankSep: 240, nodeSep: 90 },
  { rankdir: "TB", ranker: "network-simplex", rankSep: 240, nodeSep: 90 },
  { rankdir: "LR", ranker: "tight-tree", rankSep: 240, nodeSep: 90 },
  { rankdir: "TB", ranker: "tight-tree", rankSep: 240, nodeSep: 90 },
  { rankdir: "LR", ranker: "network-simplex", rankSep: 320, nodeSep: 120 },
  { rankdir: "TB", ranker: "network-simplex", rankSep: 320, nodeSep: 120 },
  { rankdir: "LR", ranker: "tight-tree", rankSep: 320, nodeSep: 120 },
  { rankdir: "TB", ranker: "tight-tree", rankSep: 320, nodeSep: 120 },
  { rankdir: "LR", ranker: "network-simplex", rankSep: 400, nodeSep: 150 },
  { rankdir: "TB", ranker: "network-simplex", rankSep: 400, nodeSep: 150 },
  { rankdir: "LR", ranker: "tight-tree", rankSep: 400, nodeSep: 150 },
  { rankdir: "TB", ranker: "tight-tree", rankSep: 400, nodeSep: 150 },
];

export function layoutDataModel(spec: DataModelSpec): PositionedNode[] {
  const content = dataModelContentSizes(spec);
  if (spec.layout_mode === "source") return layoutDataModelFromSource(spec, content);

  // Each orientation and spacing strategy gets its own bounded convergence loop.
  // Recounting after every relayout prevents a hub from growing for left/right traffic
  // and then finishing with crowded top/bottom terminals after Dagre moves its peers.
  let best: { nodes: PositionedNode[]; score: LayoutQuality } | undefined;
  for (const candidate of DATA_MODEL_CANDIDATES) {
    let sizes = content;
    let nodes = layoutDataModelGraph(spec, sizes, candidate);
    for (let pass = 0; pass < HUB_GROWTH_PASSES; pass++) {
      const grown = growHubCards(spec, nodes, sizes);
      if (!grown) break;
      sizes = grown;
      nodes = layoutDataModelGraph(spec, sizes, candidate);
    }
    const score = layoutQualityScore(spec, nodes);
    if (!best || qualityIsBetter(score, best.score)) best = { nodes, score };
  }
  if (!best) throw new Error("No data-model layout candidate produced a result.");
  return best.nodes;
}

function dataModelContentSizes(spec: DataModelSpec): Map<string, { w: number; h: number }> {
  return new Map(
    spec.objects.map((object) => {
      const size = dataModelCardSize(object);
      const extra =
        (object.observations?.owd ?? object.observations?.record_types)
          ? DATA_MODEL_CARD.observationAllowance
          : 0;
      return [object.id, { w: size.w, h: size.h + extra }];
    }),
  );
}

/** Preserve the relative geometry of an evidenced reference poster on first render. */
function layoutDataModelFromSource(
  spec: DataModelSpec,
  content: Map<string, { w: number; h: number }>,
): PositionedNode[] {
  const positioned = spec.objects.filter(
    (object): object is SourcePositionedObject => object.source_position !== undefined,
  );
  if (positioned.length !== spec.objects.length) {
    throw new Error("Source layout requires source_position for every data-model object.");
  }
  const minCenterX = Math.min(
    ...positioned.map((object) => object.source_position.x + object.source_position.w / 2),
  );
  const minCenterY = Math.min(
    ...positioned.map((object) => object.source_position.y + object.source_position.h / 2),
  );
  let scale = 1.12;
  for (const object of positioned) {
    const source = object.source_position;
    const needed = requiredMapValue(content, object.id, "data-model content size");
    scale = Math.max(scale, needed.w / source.w, needed.h / source.h);
  }
  const baseSizes = new Map(
    positioned.map((object) => {
      const source = object.source_position;
      const needed = requiredMapValue(content, object.id, "data-model content size");
      return [
        object.id,
        {
          w: Math.round(Math.max(needed.w, source.w * scale)),
          h: Math.round(Math.max(needed.h, source.h * scale)),
        },
      ];
    }),
  );
  const create = (spread: number, sizes: Map<string, { w: number; h: number }>): PositionedNode[] =>
    positioned.map((object) => {
      const source = object.source_position;
      const size = requiredMapValue(sizes, object.id, "source-layout card size");
      // Gallery markers are visually smaller than our editable vector terminals. Expand
      // centre spacing independently from card dimensions so hubs can grow without
      // inflating every unrelated card on the poster.
      const positionScale = scale * 1.28 * spread;
      return {
        id: object.id,
        x: Math.round(
          (source.x + source.w / 2 - minCenterX) * positionScale - size.w / 2 + GRAPH_LEFT,
        ),
        y: Math.round(
          (source.y + source.h / 2 - minCenterY) * positionScale - size.h / 2 + GRAPH_TOP,
        ),
        ...size,
      };
    });
  let nodes = create(1, baseSizes);
  const finalSizes = growHubCards(spec, nodes, baseSizes) ?? baseSizes;
  let spread = 1;
  nodes = create(spread, finalSizes);
  for (let pass = 0; pass < 16 && nodesOverlap(nodes, 20); pass++) {
    spread *= 1.15;
    nodes = create(spread, finalSizes);
  }
  if (nodesOverlap(nodes, 1)) {
    throw new Error("Source layout could not separate expanded data-model cards.");
  }
  normalizeToMargin(nodes);
  return nodes;
}

/**
 * Second pass: measure how many connectors each card side will carry at the first-pass
 * positions, then grow the card so every terminal gets its own anchor slot.
 */
function growHubCards(
  spec: DataModelSpec,
  positions: PositionedNode[],
  content: Map<string, { w: number; h: number }>,
): Map<string, { w: number; h: number }> | undefined {
  const boxes = new Map(positions.map((node) => [node.id, node]));
  const counts = new Map<string, Record<CardSide, number>>();
  for (const id of content.keys()) counts.set(id, { left: 0, right: 0, top: 0, bottom: 0 });
  for (const relationship of spec.relationships) {
    const fromCounts = counts.get(relationship.from);
    const toCounts = counts.get(relationship.to);
    const from = boxes.get(relationship.from);
    const to = boxes.get(relationship.to);
    if (!from || !to) continue;
    const automatic = relationship.from === relationship.to ? null : facingSides(from, to);
    const fromSide = relationship.from_anchor?.side ?? automatic?.from ?? "right";
    const toSide = relationship.to_anchor?.side ?? automatic?.to ?? "right";
    if (fromCounts) fromCounts[fromSide] += 1;
    if (toCounts) toCounts[toSide] += 1;
  }
  const grown = new Map<string, { w: number; h: number }>();
  let changed = false;
  for (const [id, size] of content) {
    const side = counts.get(id) ?? { left: 0, right: 0, top: 0, bottom: 0 };
    const h = Math.min(
      MAX_CARD_EXTENT,
      Math.max(size.h, sideLength(Math.max(side.left, side.right))),
    );
    const w = Math.min(
      MAX_CARD_EXTENT,
      Math.max(size.w, sideLength(Math.max(side.top, side.bottom))),
    );
    if (h !== size.h || w !== size.w) changed = true;
    grown.set(id, { w, h });
  }
  return changed ? grown : undefined;
}

function layoutDataModelGraph(
  spec: DataModelSpec,
  sizes: Map<string, { w: number; h: number }>,
  candidate: DataModelCandidate,
): PositionedNode[] {
  const nodeIds = spec.objects.map((object) => object.id);
  const edges = spec.relationships.map((relationship) => ({
    id: relationship.id,
    from: relationship.from,
    to: relationship.to,
  }));
  const options = {
    width: 340,
    height: 160,
    rankSep: candidate.rankSep,
    nodeSep: candidate.nodeSep,
    sizes,
  };
  const components = weakComponents(nodeIds, edges);
  if (components.length <= 1) return layoutGraphWith(nodeIds, edges, options, candidate);

  const laidOut = components.map((component) => {
    const ids = new Set(component);
    const componentEdges = edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to));
    const nodes = layoutGraphWith(component, componentEdges, options, candidate);
    const bounds = nodeBounds(nodes);
    return {
      key: [...component].sort()[0] ?? "",
      nodes,
      w: bounds.w,
      h: bounds.h,
      minX: bounds.minX,
      minY: bounds.minY,
    };
  });
  laidOut.sort(
    (left, right) => right.h * right.w - left.h * left.w || left.key.localeCompare(right.key),
  );
  const totalArea = laidOut.reduce(
    (sum, component) => sum + (component.w + COMPONENT_GAP) * (component.h + COMPONENT_GAP),
    0,
  );
  const targetWidth = Math.max(1_400, Math.sqrt(totalArea * TARGET_ASPECT));
  let cursorX = GRAPH_LEFT;
  let cursorY = GRAPH_TOP;
  let rowHeight = 0;
  const packed: PositionedNode[] = [];
  for (const component of laidOut) {
    if (cursorX > GRAPH_LEFT && cursorX + component.w > GRAPH_LEFT + targetWidth) {
      cursorX = GRAPH_LEFT;
      cursorY += rowHeight + COMPONENT_GAP;
      rowHeight = 0;
    }
    const dx = cursorX - component.minX;
    const dy = cursorY - component.minY;
    for (const node of component.nodes) packed.push({ ...node, x: node.x + dx, y: node.y + dy });
    cursorX += component.w + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, component.h);
  }
  normalizeToMargin(packed);
  return packed.sort((left, right) => left.id.localeCompare(right.id));
}

function weakComponents(nodeIds: string[], edges: Array<{ from: string; to: string }>): string[][] {
  const adjacency = new Map(nodeIds.map((id) => [id, new Set<string>()]));
  for (const edge of edges) {
    if (edge.from === edge.to) continue;
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const start of [...nodeIds].sort()) {
    if (seen.has(start)) continue;
    const queue = [start];
    const component: string[] = [];
    seen.add(start);
    while (queue.length) {
      const current = queue.shift();
      if (current === undefined) break;
      component.push(current);
      for (const neighbor of [...(adjacency.get(current) ?? [])].sort()) {
        if (seen.has(neighbor)) continue;
        seen.add(neighbor);
        queue.push(neighbor);
      }
    }
    components.push(component.sort());
  }
  return components;
}

function nodesOverlap(nodes: PositionedNode[], gap: number): boolean {
  for (let left = 0; left < nodes.length; left++) {
    const a = nodes[left];
    if (!a) continue;
    for (let right = left + 1; right < nodes.length; right++) {
      const b = nodes[right];
      if (!b) continue;
      const overlapX = Math.min(a.x + a.w + gap, b.x + b.w + gap) - Math.max(a.x, b.x);
      const overlapY = Math.min(a.y + a.h + gap, b.y + b.h + gap) - Math.max(a.y, b.y);
      if (overlapX > 0 && overlapY > 0) return true;
    }
  }
  return false;
}

function nodeBounds(nodes: PositionedNode[]): {
  minX: number;
  minY: number;
  w: number;
  h: number;
} {
  const minX = Math.min(...nodes.map((node) => node.x));
  const minY = Math.min(...nodes.map((node) => node.y));
  const maxX = Math.max(...nodes.map((node) => node.x + node.w));
  const maxY = Math.max(...nodes.map((node) => node.y + node.h));
  return { minX, minY, w: maxX - minX, h: maxY - minY };
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

type Point = { x: number; y: number };
type Segment = { a: Point; b: Point };

/** Edge-aware deterministic score: protect cards and routes before optimizing page shape. */
function layoutQualityScore(spec: DataModelSpec, nodes: PositionedNode[]): LayoutQuality {
  const boxes = new Map(nodes.map((node) => [node.id, node]));
  const routes = spec.relationships.flatMap((edge) => {
    if (edge.from === edge.to) return [];
    const from = boxes.get(edge.from);
    const to = boxes.get(edge.to);
    return from && to ? [{ edge, segments: estimatedSegments(from, to) }] : [];
  });
  const obstructionPairs = new Set<string>();
  let crossings = 0;
  let shared = 0;
  let span = 0;
  for (const route of routes) {
    for (const segment of route.segments) {
      span += Math.abs(segment.a.x - segment.b.x) + Math.abs(segment.a.y - segment.b.y);
      for (const node of nodes) {
        if (node.id === route.edge.from || node.id === route.edge.to) continue;
        if (segmentHitsNode(segment, node)) obstructionPairs.add(`${route.edge.id}|${node.id}`);
      }
    }
  }
  for (let i = 0; i < routes.length; i++) {
    const left = routes[i];
    if (!left) continue;
    for (let j = i + 1; j < routes.length; j++) {
      const right = routes[j];
      if (!right) continue;
      if (
        left.edge.from === right.edge.from ||
        left.edge.from === right.edge.to ||
        left.edge.to === right.edge.from ||
        left.edge.to === right.edge.to
      )
        continue;
      for (const a of left.segments) {
        for (const b of right.segments) {
          if (segmentsCross(a, b)) crossings += 1;
          shared += collinearOverlap(a, b);
        }
      }
    }
  }
  const bounds = nodeBounds(nodes);
  const areaPenalty = (bounds.w * bounds.h) / 1_000_000;
  return [obstructionPairs.size, crossings, shared, span, areaPenalty, layoutAspectScore(nodes)];
}

function qualityIsBetter(left: LayoutQuality, right: LayoutQuality): boolean {
  for (let index = 0; index < left.length; index++) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) continue;
    if (leftValue < rightValue) return true;
    if (leftValue > rightValue) return false;
  }
  return false;
}

function estimatedSegments(from: PositionedNode, to: PositionedNode): Segment[] {
  const sides = facingSides(from, to);
  const center = (node: PositionedNode): Point => ({
    x: node.x + node.w / 2,
    y: node.y + node.h / 2,
  });
  if (!sides) {
    const a = center(from);
    const b = center(to);
    return [
      { a, b: { x: b.x, y: a.y } },
      { a: { x: b.x, y: a.y }, b },
    ];
  }
  const anchor = (node: PositionedNode, side: CardSide): Point =>
    side === "left"
      ? { x: node.x, y: node.y + node.h / 2 }
      : side === "right"
        ? { x: node.x + node.w, y: node.y + node.h / 2 }
        : side === "top"
          ? { x: node.x + node.w / 2, y: node.y }
          : { x: node.x + node.w / 2, y: node.y + node.h };
  const a = anchor(from, sides.from);
  const b = anchor(to, sides.to);
  if (sides.from === "left" || sides.from === "right") {
    const x = (a.x + b.x) / 2;
    return [
      { a, b: { x, y: a.y } },
      { a: { x, y: a.y }, b: { x, y: b.y } },
      { a: { x, y: b.y }, b },
    ];
  }
  const y = (a.y + b.y) / 2;
  return [
    { a, b: { x: a.x, y } },
    { a: { x: a.x, y }, b: { x: b.x, y } },
    { a: { x: b.x, y }, b },
  ];
}

function segmentHitsNode(segment: Segment, node: PositionedNode): boolean {
  const inset = 8;
  const minX = node.x + inset;
  const maxX = node.x + node.w - inset;
  const minY = node.y + inset;
  const maxY = node.y + node.h - inset;
  if (Math.abs(segment.a.y - segment.b.y) < 0.5) {
    if (segment.a.y <= minY || segment.a.y >= maxY) return false;
    return overlapLength(segment.a.x, segment.b.x, minX, maxX) > 16;
  }
  if (Math.abs(segment.a.x - segment.b.x) < 0.5) {
    if (segment.a.x <= minX || segment.a.x >= maxX) return false;
    return overlapLength(segment.a.y, segment.b.y, minY, maxY) > 16;
  }
  return false;
}

function segmentsCross(left: Segment, right: Segment): boolean {
  const leftHorizontal = Math.abs(left.a.y - left.b.y) < 0.5;
  const rightHorizontal = Math.abs(right.a.y - right.b.y) < 0.5;
  if (leftHorizontal === rightHorizontal) return false;
  const horizontal = leftHorizontal ? left : right;
  const vertical = leftHorizontal ? right : left;
  const x = vertical.a.x;
  const y = horizontal.a.y;
  return (
    x > Math.min(horizontal.a.x, horizontal.b.x) + 1 &&
    x < Math.max(horizontal.a.x, horizontal.b.x) - 1 &&
    y > Math.min(vertical.a.y, vertical.b.y) + 1 &&
    y < Math.max(vertical.a.y, vertical.b.y) - 1
  );
}

function collinearOverlap(left: Segment, right: Segment): number {
  const leftHorizontal = Math.abs(left.a.y - left.b.y) < 0.5;
  const rightHorizontal = Math.abs(right.a.y - right.b.y) < 0.5;
  if (leftHorizontal !== rightHorizontal) return 0;
  if (leftHorizontal) {
    if (Math.abs(left.a.y - right.a.y) >= 1) return 0;
    return overlapLength(left.a.x, left.b.x, right.a.x, right.b.x);
  }
  if (Math.abs(left.a.x - right.a.x) >= 1) return 0;
  return overlapLength(left.a.y, left.b.y, right.a.y, right.b.y);
}

function overlapLength(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(
    0,
    Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2)),
  );
}

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
    candidates?: GraphCandidate[];
  },
): PositionedNode[] {
  const candidates = options.candidates ?? [
    { rankdir: "LR" as const, ranker: "network-simplex" as const },
  ];
  let best: { nodes: PositionedNode[]; score: number } | undefined;
  for (const candidate of candidates) {
    const nodes = layoutGraphWith(nodeIds, edges, options, candidate);
    const score = layoutAspectScore(nodes);
    if (!best || score < best.score - 1e-9) best = { nodes, score };
  }
  if (!best) throw new Error("No graph layout candidate produced a result.");
  return best.nodes;
}

export type GraphCandidate = {
  rankdir: "LR" | "TB";
  ranker: "network-simplex" | "tight-tree";
};

function layoutAspectScore(nodes: PositionedNode[]): number {
  const width = Math.max(...nodes.map((node) => node.x + node.w)) - GRAPH_LEFT;
  const height = Math.max(...nodes.map((node) => node.y + node.h)) - GRAPH_TOP;
  return Math.abs(Math.log(width / Math.max(1, height) / TARGET_ASPECT));
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
  candidate: GraphCandidate,
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

function requiredMapValue<K, V>(map: Map<K, V>, key: K, label: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Missing ${label} for '${String(key)}'.`);
  return value;
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
