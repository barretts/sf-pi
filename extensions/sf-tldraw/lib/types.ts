/* SPDX-License-Identifier: Apache-2.0 */
/** Shared contracts for the sf-tldraw family tool and deterministic renderers. */

export type TldrawAction =
  | "status"
  | "documents"
  | "search"
  | "execute"
  | "screenshot"
  | "script_workspace"
  | "script_status"
  | "cheatsheet"
  | "render_salesforce_data_model"
  | "render_salesforce_architecture"
  | "render_salesforce_sequence";

export type DiagramFamily = "data_model" | "architecture" | "sequence";
export type RenderMode = "preserve" | "relayout" | "replace";
export type OutputMode = "summary" | "inline" | "file_only";
export type IconCategory = "standard" | "custom" | "utility" | "action" | "doctype";

export interface DiagramSource {
  id: string;
  label: string;
  url?: string;
  kind: "official_doc" | "org_describe" | "org_query" | "user_provided";
}

export interface ReferenceGrounding {
  mode: "reference";
  as_of: string;
  sources: DiagramSource[];
}

export interface OrgGrounding {
  mode: "org";
  as_of: string;
  /** Human-safe label rendered on the canvas. Do not put usernames or instance URLs here. */
  display_label: string;
  /** Execution alias retained in memory only and never rendered or persisted in evidence. */
  target_org?: string;
  sources: DiagramSource[];
}

export type DiagramGrounding = ReferenceGrounding | OrgGrounding;

export interface BaseDiagramSpec {
  spec_version: "1.0";
  family: DiagramFamily;
  title: string;
  scope: string;
  purpose?: string;
  grounding: DiagramGrounding;
}

export interface DiagramIcon {
  category: IconCategory;
  name: string;
  /** Optional explicit tile color. Presentation-only, not a Salesforce fact. */
  color?: string;
}

export type ObjectFamily = "standard" | "custom" | "external" | "special";
export type EndpointCardinality = "one" | "many" | "zero_or_one" | "zero_or_many";

export interface DataModelObject {
  id: string;
  label: string;
  api_name: string;
  family: ObjectFamily;
  icon?: DiagramIcon;
  key_fields?: string[];
  observations?: {
    row_count?: { value: number; exact?: boolean };
    owd?: string;
    record_types?: string[];
  };
  evidence: string[];
}

export interface DataModelRelationship {
  id: string;
  from: string;
  to: string;
  type: "lookup" | "master_detail";
  from_cardinality: EndpointCardinality;
  to_cardinality: EndpointCardinality;
  field_api_name?: string;
  evidence: string[];
}

export interface DataModelSpec extends BaseDiagramSpec {
  family: "data_model";
  objects: DataModelObject[];
  relationships: DataModelRelationship[];
}

export interface ArchitectureSystem {
  id: string;
  label: string;
  kind: "salesforce" | "external" | "user" | "data_store" | "integration";
  responsibility: string;
  boundary?: string;
  icon?: DiagramIcon;
  product_mark?: ProductMarkKey;
  evidence: string[];
}

export interface ArchitectureConnection {
  id: string;
  from: string;
  to: string;
  label: string;
  meaning: "directional" | "async_or_batch" | "dependency";
  evidence: string[];
}

export interface ArchitectureSpec extends BaseDiagramSpec {
  family: "architecture";
  systems: ArchitectureSystem[];
  connections: ArchitectureConnection[];
}

export interface SequenceParticipant {
  id: string;
  label: string;
  kind: "salesforce" | "external" | "user" | "data_store" | "integration";
  icon?: DiagramIcon;
  product_mark?: ProductMarkKey;
  evidence: string[];
}

export interface SequenceInteraction {
  id: string;
  step: number;
  from: string;
  to: string;
  label: string;
  kind: "request" | "response" | "async" | "event";
  evidence: string[];
}

export interface SequenceSpec extends BaseDiagramSpec {
  family: "sequence";
  participants: SequenceParticipant[];
  interactions: SequenceInteraction[];
}

export type SalesforceDiagramSpec = DataModelSpec | ArchitectureSpec | SequenceSpec;

export type ProductMarkKey =
  | "salesforce_platform"
  | "sales_cloud"
  | "service_cloud"
  | "experience_cloud"
  | "marketing_cloud"
  | "commerce_cloud"
  | "data_360"
  | "agentforce"
  | "mulesoft"
  | "tableau"
  | "slack";

export interface TldrawPreferences {
  cardinalityDetail: "simplified" | "full";
  ldvThreshold: "1M" | "2M" | "5M" | "10M";
  recordTypeMode: "off" | "auto" | "always";
  interactionMode: "static" | "step_through";
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

export interface RuntimeCapabilities {
  apiContract: "canvas-api-v1" | "unknown";
  capabilityEndpoint: boolean;
  nativeDocumentCreation: boolean;
  documents: boolean;
  search: boolean;
  execute: boolean;
  screenshot: boolean;
  scriptWorkspace: boolean;
  scriptStatus: boolean;
}

export type TldrawStatusKind =
  | "hidden"
  | "detected"
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
  message?: string;
  updatedAt?: string;
}

export interface RuntimeScreenshot {
  filePath: string;
  width: number;
  height: number;
  pageName: string;
  viewport?: Record<string, number>;
  bounds?: { x: number; y: number; w: number; h: number };
  captureMode: "canvas" | "window";
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
  fromCardinality?: EndpointCardinality;
  toCardinality?: EndpointCardinality;
  fromMarkerAssetId?: string;
  toMarkerAssetId?: string;
}

export interface CanvasSequenceInteractionPayload extends CanvasEdgePayload {
  step: number;
  y: number;
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
