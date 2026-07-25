/* SPDX-License-Identifier: Apache-2.0 */
/** Compile validated Salesforce specs into a common deterministic canvas payload. */
import type {
  ArchitectureSpec,
  CanvasEdgePayload,
  CanvasNodePayload,
  CanvasProgramPayload,
  CanvasSequenceInteractionPayload,
  DataModelSpec,
  RenderMode,
  SalesforceDiagramSpec,
  SequenceSpec,
  TldrawPreferences,
} from "./types.ts";
import { resolveVisualAssets } from "./assets.ts";
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
      iconAssetId: visual.iconAssetId,
      iconTileAssetId: visual.tileAssetId,
      keyFields: object.key_fields?.slice(0, 4),
      observations,
    };
  });
  const edges: CanvasEdgePayload[] = spec.relationships.map((relationship) => ({
    id: relationship.id,
    from: relationship.from,
    to: relationship.to,
    label: relationship.type === "master_detail" ? "MD" : "LK",
    fromCardinality: relationship.from_cardinality,
    toCardinality: relationship.to_cardinality,
    fromMarkerAssetId: visuals.markerAssets.get(relationship.from_cardinality),
    toMarkerAssetId: visuals.markerAssets.get(relationship.to_cardinality),
  }));
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

function compileSequence(spec: SequenceSpec, options: CompileOptions): CanvasProgramPayload {
  const visuals = resolveVisualAssets(spec, options.preferences.cardinalityDetail);
  const layout = new Map(layoutSequence(spec).map((node) => [node.id, node]));
  const nodes: CanvasNodePayload[] = spec.participants.map((participant) => {
    const visual = requiredMapValue(visuals.nodeAssets, participant.id, "visual asset");
    return {
      ...requiredMapValue(layout, participant.id, "layout"),
      label: participant.label,
      kind: participant.kind,
      iconAssetId: visual.iconAssetId,
      iconTileAssetId: visual.tileAssetId,
    };
  });
  const interactions: CanvasSequenceInteractionPayload[] = [...spec.interactions]
    .sort((left, right) => left.step - right.step)
    .map((interaction, index) => ({
      id: interaction.id,
      from: interaction.from,
      to: interaction.to,
      label: `${interaction.step}. ${interaction.label}`,
      meaning: interaction.kind,
      step: interaction.step,
      y: 560 + index * 130,
    }));
  const warnings = [...(options.warnings ?? []), ...visuals.warnings];
  if (options.preferences.interactionMode === "step_through") {
    warnings.push(
      "Manual step-through requires a document script and is not installed over an existing script; this render remains static.",
    );
  }
  const payload = basePayload(spec, options, visuals.assets, nodes, interactions, warnings);
  payload.sequenceInteractions = interactions;
  return payload;
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

function requiredMapValue<T>(map: Map<string, T>, id: string, kind: string): T {
  const value = map.get(id);
  if (!value) throw new Error(`Missing ${kind} for '${id}'.`);
  return value;
}
