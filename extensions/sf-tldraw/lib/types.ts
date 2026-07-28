/* SPDX-License-Identifier: Apache-2.0 */
/** Shared contracts for the sf-tldraw family tool and deterministic renderers. */

import type {
  ArchitectureConnection,
  DataModelEntityKind,
  DataModelRelationship,
  DiagramFamily,
  EndpointCardinality,
  ObjectFamily,
  SalesforceDiagramSpec,
  SequenceInteraction,
} from "./spec-schema.ts";

export type TldrawAction =
  | "status"
  | "documents"
  | "create_document"
  | "cheatsheet"
  | "render_salesforce_data_model"
  | "render_salesforce_architecture"
  | "render_salesforce_sequence";

export type {
  ArchitectureConnection,
  ArchitectureSpec,
  ArchitectureSystem,
  DataModelEntityKind,
  DataModelObject,
  DataModelRelationship,
  DataModelSpec,
  DiagramFamily,
  DiagramGrounding,
  DiagramIcon,
  DiagramSource,
  EndpointCardinality,
  IconCategory,
  ObjectFamily,
  OrgGrounding,
  ReferenceGrounding,
  SalesforceDiagramSpec,
  SequenceActivation,
  SequenceInteraction,
  SequenceParticipant,
  SequenceSpec,
} from "./spec-schema.ts";

export type RenderMode = "preserve" | "relayout" | "replace";
export type OutputMode = "summary" | "inline" | "file_only";

export interface TldrawPreferences {
  cardinalityDetail: "simplified" | "full";
  /** Data-model card interior: white (default) or the object-family tint. */
  cardFill: "transparent" | "family";
  ldvThreshold: "1M" | "2M" | "5M" | "10M";
  recordTypeMode: "off" | "auto" | "always";
  legendRelationships: "show" | "hide";
}

export type TldrawPreferenceKey = keyof TldrawPreferences;
export type SettingsScope = "global" | "project";

export interface EffectiveTldrawPreferences extends TldrawPreferences {
  sources: Record<
    TldrawPreferenceKey,
    { scope: SettingsScope; path: string } | { scope: "default" }
  >;
}

export interface TldrawServerConfig {
  port: number;
  token: string;
  pid?: number;
  startedAt?: number;
}

export interface TldrawDocumentSummary {
  id: string;
  name?: string;
  shapeCount?: number;
  pageName?: string;
  focusOrder?: number;
}

export interface TldrawCreatedDocument {
  id: string;
  documentId: string;
  name: string;
  windowId: number;
}

export interface RuntimeCapabilities {
  apiContract: "canvas-api-v1.12";
  contractProof: "readme";
  nativeDocumentCreation: true;
  documents: true;
  search: true;
  execute: true;
  screenshot: true;
}

export type TldrawSkillReadinessKind = "ready" | "missing" | "unmanaged" | "stale" | "unknown";

export interface TldrawSkillReadiness {
  kind: TldrawSkillReadinessKind;
  managed: boolean;
  manifestVersion?: string;
  message: string;
}

export type TldrawStatusKind =
  | "hidden"
  | "available"
  | "ready"
  | "no-open-document"
  | "not-running"
  | "stale-config"
  | "auth-error"
  | "incompatible";

export interface TldrawRuntimeStatus {
  kind: TldrawStatusKind;
  port?: number;
  openDocuments?: number;
  focusedDocumentName?: string;
  capabilities?: RuntimeCapabilities;
  skillReadiness?: TldrawSkillReadiness;
  message?: string;
  updatedAt?: string;
}

export interface TldrawRuntimeObservation {
  status: TldrawRuntimeStatus;
  documents: TldrawDocumentSummary[];
}

export interface RuntimeScreenshot {
  filePath: string;
  width: number;
  height: number;
  pageName: string;
  viewport?: Record<string, number>;
  bounds?: { x: number; y: number; w: number; h: number };
  captureMode: "canvas" | "window";
  format?: "png" | "jpeg";
}

export interface ValidationFinding {
  code: string;
  message: string;
  path?: string;
}

export interface ValidationResult<T extends SalesforceDiagramSpec = SalesforceDiagramSpec> {
  ok: boolean;
  spec?: T;
  errors: ValidationFinding[];
  warnings: ValidationFinding[];
}

export interface PositionedNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanvasAssetPayload {
  id: string;
  name: string;
  src: string;
  mimeType: string;
  width: number;
  height: number;
  anchor?: { x: number; y: number };
  attribution?: {
    source: string;
    license: string;
    package?: string;
    version?: string;
  };
}

export interface CanvasNodePayload extends PositionedNode {
  label: string;
  apiName?: string;
  subtitle?: string;
  family?: ObjectFamily;
  entityKind?: DataModelEntityKind;
  iconAssetId?: string;
  iconTileAssetId?: string;
  keyFields?: string[];
  observations?: string[];
  boundary?: string;
  kind?: string;
}

export interface CanvasEdgePayload {
  id: string;
  from: string;
  to: string;
  label: string;
  meaning?: ArchitectureConnection["meaning"] | SequenceInteraction["kind"];
  /** Data-model only. Drives connector color and dash instead of an LK/MD label box. */
  relationshipType?: DataModelRelationship["type"];
  fromCardinality?: EndpointCardinality;
  toCardinality?: EndpointCardinality;
  fromMarkerAssetId?: string;
  toMarkerAssetId?: string;
}

export interface CanvasSequenceInteractionPayload extends CanvasEdgePayload {
  step: number;
  y: number;
}

export interface CanvasSequenceActivationPayload {
  id: string;
  participantId: string;
  y: number;
  h: number;
}

export interface CanvasProgramPayload {
  schemaVersion: 1;
  family: DiagramFamily;
  renderMode: RenderMode;
  pageName: string;
  title: string;
  scope: string;
  groundingText: string;
  preferences: TldrawPreferences;
  assets: CanvasAssetPayload[];
  nodes: CanvasNodePayload[];
  edges: CanvasEdgePayload[];
  sequenceInteractions?: CanvasSequenceInteractionPayload[];
  sequenceActivations?: CanvasSequenceActivationPayload[];
  warnings: string[];
}

export interface RenderReadiness {
  ready: boolean;
  blockers: Array<{ code: string; message: string }>;
  warnings: string[];
  lintCount: number;
  markerChecks: Array<{
    id: string;
    fromDelta: number;
    toDelta: number;
    fromOrientation: number;
    toOrientation: number;
  }>;
  bindingChecks: Array<{ id: string; valid: boolean }>;
  sequenceGeometryChecks: Array<{ id: string; delta: number }>;
  typographyChecks: Array<{ id: string; apiGap: number; formatValid: boolean }>;
  /** Data-model only: measured overflow of card text outside its card. */
  cardContentChecks?: Array<{ id: string; overflow: number }>;
  /** Data-model only: connectors whose orthogonal route passes behind an unrelated card. */
  routeChecks?: Array<{ id: string; obstructedBy: string[] }>;
  /** Data-model only: final routed segments that cross another relationship. */
  routeCrossingChecks?: Array<{ id: string; crosses: string[] }>;
  /** Data-model only: final routed segments that share a collinear corridor. */
  sharedCorridorChecks?: Array<{ id: string; sharesWith: string[] }>;
  /** Data-model only: cardinality marker pairs whose rendered bounds overlap. */
  markerOverlapChecks?: Array<{ first: string; second: string }>;
}

export interface CanvasExecutionResult {
  documentId: string;
  pageId: string;
  pageName: string;
  family: DiagramFamily;
  createdShapes: number;
  updatedShapes: number;
  deletedShapes: number;
  readiness: RenderReadiness;
}

export interface RenderArtifact {
  runId: string;
  directory: string;
  reportPath: string;
  screenshotPath: string;
  thumbnailPath: string;
}
