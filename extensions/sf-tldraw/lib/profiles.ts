/* SPDX-License-Identifier: Apache-2.0 */
/** Compile validated Salesforce specs into a common deterministic canvas payload. */
import type {
  ArchitectureSpec,
  CanvasEdgePayload,
  CanvasNodePayload,
  CanvasProgramPayload,
  CanvasSequenceActivationPayload,
  CanvasSequenceInteractionPayload,
  DataModelSpec,
  RenderMode,
  SalesforceDiagramSpec,
  SequenceSpec,
  TldrawPreferences,
} from "./types.ts";
import { markerAssetKey, resolveVisualAssets, type MarkerTone } from "./assets.ts";
import { layoutArchitecture, layoutDataModel, layoutSequence } from "./layout.ts";

export function compileProfile(
  spec: SalesforceDiagramSpec,
  options: {
    renderMode: RenderMode;
    pageName?: string;
    preferences: TldrawPreferences;
    warnings?: string[];
  },
): CanvasProgramPayload {
  if (spec.family === "data_model") return compileDataModel(spec, options);
  if (spec.family === "architecture") return compileArchitecture(spec, options);
  return compileSequence(spec, options);
}

function compileDataModel(spec: DataModelSpec, options: CompileOptions): CanvasProgramPayload {
  const visuals = resolveVisualAssets(spec, options.preferences.cardinalityDetail);
  const layout = new Map(layoutDataModel(spec).map((node) => [node.id, node]));
  const threshold = Number(options.preferences.ldvThreshold.replace("M", "")) * 1_000_000;
  const nodes: CanvasNodePayload[] = spec.objects.map((object) => {
    const position = requiredMapValue(layout, object.id, "layout");
    const visual = requiredMapValue(visuals.nodeAssets, object.id, "visual asset");
    const observations: string[] = [];
    const count = object.observations?.row_count;
    if (count && count.value >= threshold)
      observations.push(formatRowCount(count.value, count.exact === true));
    if (object.observations?.owd) observations.push(`OWD ${object.observations.owd}`);
    const recordTypes = object.observations?.record_types ?? [];
    if (
      options.preferences.recordTypeMode === "always" ||
      (options.preferences.recordTypeMode === "auto" && recordTypes.length > 1)
    ) {
      observations.push(`RT ${recordTypes.slice(0, 5).join(" · ")}`);
    }
    return {
      ...position,
      label: object.label,
      apiName: object.api_name,
      family: object.family,
      entityKind: object.entity_kind,
      iconAssetId: visual.iconAssetId,
      iconTileAssetId: visual.tileAssetId,
      keyFields: object.key_fields?.slice(0, 4),
      observations,
    };
  });
  // Relationship kind is carried by connector color and dash (grey dotted lookup,
  // red solid master-detail) instead of a repeated LK/MD label box per connector.
  const edges: CanvasEdgePayload[] = spec.relationships.map((relationship) => {
    const tone: MarkerTone = relationship.type === "master_detail" ? "master_detail" : "neutral";
    return {
      id: relationship.id,
      from: relationship.from,
      to: relationship.to,
      label: "",
      relationshipType: relationship.type,
      fieldApiName: relationship.field_api_name,
      fromAnchor: relationship.from_anchor,
      toAnchor: relationship.to_anchor,
      fromLabel: relationship.from_label,
      toLabel: relationship.to_label,
      fromCardinality: relationship.from_cardinality,
      toCardinality: relationship.to_cardinality,
      fromMarkerAssetId: visuals.markerAssets.get(
        markerAssetKey(relationship.from_cardinality, tone),
      ),
      toMarkerAssetId: visuals.markerAssets.get(markerAssetKey(relationship.to_cardinality, tone)),
    };
  });
  return basePayload(spec, options, visuals.assets, nodes, edges, [
    ...(options.warnings ?? []),
    ...visuals.warnings,
  ]);
}

function compileArchitecture(
  spec: ArchitectureSpec,
  options: CompileOptions,
): CanvasProgramPayload {
  const visuals = resolveVisualAssets(spec, options.preferences.cardinalityDetail);
  const layout = new Map(layoutArchitecture(spec).map((node) => [node.id, node]));
  const nodes: CanvasNodePayload[] = spec.systems.map((system) => {
    const visual = requiredMapValue(visuals.nodeAssets, system.id, "visual asset");
    return {
      ...requiredMapValue(layout, system.id, "layout"),
      label: system.label,
      subtitle: system.responsibility,
      boundary: system.boundary,
      kind: system.kind,
      iconAssetId: visual.iconAssetId,
      iconTileAssetId: visual.tileAssetId,
    };
  });
  const edges: CanvasEdgePayload[] = spec.connections.map((connection) => ({
    id: connection.id,
    from: connection.from,
    to: connection.to,
    label: connection.label,
    meaning: connection.meaning,
  }));
  return basePayload(spec, options, visuals.assets, nodes, edges, [
    ...(options.warnings ?? []),
    ...visuals.warnings,
  ]);
}

const SEQUENCE_FIRST_MESSAGE_Y = 520;
const SEQUENCE_ROW_GAP = 118;
const SEQUENCE_PHASE_GAP = 52;
const SEQUENCE_ACTIVATION_PAD = 28;

function compileSequence(spec: SequenceSpec, options: CompileOptions): CanvasProgramPayload {
  const visuals = resolveVisualAssets(spec, options.preferences.cardinalityDetail);
  const layout = new Map(layoutSequence(spec).map((node) => [node.id, node]));
  const nodes: CanvasNodePayload[] = spec.participants.map((participant) => {
    const hasExplicitVisual = Boolean(participant.icon || participant.product_mark);
    const visual = hasExplicitVisual
      ? requiredMapValue(visuals.nodeAssets, participant.id, "visual asset")
      : undefined;
    return {
      ...requiredMapValue(layout, participant.id, "layout"),
      label: participant.label,
      kind: participant.kind,
      ...(visual ? { iconAssetId: visual.iconAssetId, iconTileAssetId: visual.tileAssetId } : {}),
    };
  });
  let y = SEQUENCE_FIRST_MESSAGE_Y;
  const ordered = [...spec.interactions].sort((left, right) => left.step - right.step);
  const interactions: CanvasSequenceInteractionPayload[] = ordered.map((interaction, index) => {
    if (index > 0) {
      y += SEQUENCE_ROW_GAP;
      const previous = ordered[index - 1];
      if (previous && startsNewSequencePhase(previous, interaction)) y += SEQUENCE_PHASE_GAP;
    }
    return {
      id: interaction.id,
      from: interaction.from,
      to: interaction.to,
      label: interaction.label,
      meaning: interaction.kind,
      step: interaction.step,
      y,
    };
  });
  const activations = deriveSequenceActivations(spec, interactions);
  const usedAssets = new Set(
    nodes.flatMap((node) => [node.iconAssetId, node.iconTileAssetId]).filter(Boolean),
  );
  const assets = visuals.assets.filter((asset) => usedAssets.has(asset.id));
  const warnings = [...(options.warnings ?? []), ...visuals.warnings];
  if (options.preferences.interactionMode === "step_through") {
    warnings.push(
      "Manual step-through requires a document script and is not installed over an existing script; this render remains static.",
    );
  }
  const payload = basePayload(spec, options, assets, nodes, interactions, warnings);
  payload.sequenceInteractions = interactions;
  payload.sequenceActivations = activations;
  return payload;
}

function startsNewSequencePhase(
  previous: SequenceSpec["interactions"][number],
  current: SequenceSpec["interactions"][number],
): boolean {
  const previousCompletes = previous.kind === "response" || previous.kind === "async";
  const currentStarts = current.kind === "request" || current.kind === "event";
  if (!previousCompletes || !currentStarts) return false;
  return participantPair(previous) !== participantPair(current);
}

function participantPair(interaction: { from: string; to: string }): string {
  return [interaction.from, interaction.to].sort().join("|");
}

function deriveSequenceActivations(
  spec: SequenceSpec,
  interactions: CanvasSequenceInteractionPayload[],
): CanvasSequenceActivationPayload[] {
  const rows = new Map(interactions.map((interaction) => [interaction.step, interaction.y]));
  const participantOrder = new Map(
    spec.participants.map((participant, index) => [participant.id, index]),
  );
  return [...(spec.activations ?? [])]
    .sort(
      (left, right) =>
        requiredMapValue(participantOrder, left.participant, "participant order") -
          requiredMapValue(participantOrder, right.participant, "participant order") ||
        left.start_step - right.start_step ||
        left.end_step - right.end_step ||
        left.id.localeCompare(right.id),
    )
    .map((activation) => {
      const startY = requiredMapValue(rows, activation.start_step, "activation start row");
      const endY = requiredMapValue(rows, activation.end_step, "activation end row");
      return {
        id: activation.id,
        participantId: activation.participant,
        y: startY - SEQUENCE_ACTIVATION_PAD,
        h: Math.max(52, endY - startY + SEQUENCE_ACTIVATION_PAD * 2),
      };
    });
}

interface CompileOptions {
  renderMode: RenderMode;
  pageName?: string;
  preferences: TldrawPreferences;
  warnings?: string[];
}

function basePayload(
  spec: SalesforceDiagramSpec,
  options: CompileOptions,
  assets: CanvasProgramPayload["assets"],
  nodes: CanvasNodePayload[],
  edges: CanvasEdgePayload[],
  warnings: string[],
): CanvasProgramPayload {
  return {
    schemaVersion: 1,
    family: spec.family,
    renderMode: options.renderMode,
    pageName: options.pageName?.trim() || spec.title,
    title: spec.title,
    scope: spec.scope,
    groundingText: formatGrounding(spec),
    preferences: options.preferences,
    assets,
    nodes,
    edges,
    warnings: unique(warnings),
  };
}

function formatGrounding(spec: SalesforceDiagramSpec): string {
  const grounding = spec.grounding;
  const sourceLabel = grounding.sources
    .map((source) => source.label)
    .slice(0, 3)
    .join(" · ");
  const mode = grounding.mode === "reference" ? "Reference" : grounding.display_label;
  return `${titleCase(spec.family.replace("_", " "))} · Grounding: ${mode} · ${sourceLabel} · As of ${grounding.as_of}`;
}

function formatRowCount(value: number, exact: boolean): string {
  const formatted =
    value >= 1_000_000
      ? `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`
      : value.toLocaleString("en-US");
  return `LDV ${exact ? "" : "~"}${formatted}`;
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (character) => character.toUpperCase());
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function requiredMapValue<K, T>(map: Map<K, T>, id: K, kind: string): T {
  const value = map.get(id);
  if (value === undefined) throw new Error(`Missing ${kind} for '${String(id)}'.`);
  return value;
}
