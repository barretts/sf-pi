/* SPDX-License-Identifier: Apache-2.0 */
/** Strict semantic validation for grounded Salesforce Diagram Specs. */
import type {
  DiagramFamily,
  DiagramSource,
  SalesforceDiagramSpec,
  ValidationFinding,
  ValidationResult,
} from "./types.ts";

const ID_RE = /^[A-Za-z][A-Za-z0-9._-]{0,79}$/;
const API_NAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,127}$/;
const ICON_NAME_RE = /^[a-z0-9][a-z0-9_]{0,79}$/;
const ORG_ALIAS_RE = /^[A-Za-z0-9._-]{1,80}$/;
const SENSITIVE_RENDERED_VALUE_RE =
  /(?:https?:\/\/|\b00D[A-Za-z0-9]{12,15}\b|\bBearer\s+|\S+@\S+|\.salesforce\.com\b)/i;
const PRIVATE_KEY_RE =
  /(?:access.?token|refresh.?token|authorization|password|secret|instance.?url|org.?id|user.?name|sfdx.?auth.?url)/i;
const OFFICIAL_SALESFORCE_HOSTS = new Set([
  "developer.salesforce.com",
  "help.salesforce.com",
  "architect.salesforce.com",
  "admin.salesforce.com",
  "lightningdesignsystem.com",
]);

const PRODUCT_MARK_KEYS = new Set([
  "salesforce_platform",
  "sales_cloud",
  "service_cloud",
  "experience_cloud",
  "marketing_cloud",
  "commerce_cloud",
  "data_360",
  "agentforce",
  "mulesoft",
  "tableau",
  "slack",
]);

const NODE_KINDS = new Set(["salesforce", "external", "user", "data_store", "integration"]);
const MAX_DATA_MODEL_NODE_DEGREE = 36;

const LIMITS: Record<DiagramFamily, { nodes: number; edges: number }> = {
  // The official Gallery currently reaches 127 entities / 188 relationships. Keep a
  // bounded margin above that corpus while still refusing accidental unbounded pages.
  data_model: { nodes: 160, edges: 260 },
  architecture: { nodes: 16, edges: 24 },
  sequence: { nodes: 8, edges: 18 },
};

/** Above these counts the page is poster-scale rather than comfortably screen-readable. */
const READABILITY_BUDGET: Partial<Record<DiagramFamily, { nodes: number; edges: number }>> = {
  data_model: { nodes: 34, edges: 56 },
};

export function validateDiagramSpec(
  value: unknown,
  expectedFamily?: DiagramFamily,
): ValidationResult {
  const errors: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];
  // Several tool-call transports hand object params over as JSON text. Parse that
  // shape instead of failing a well-formed spec on a transport detail.
  const candidate = coerceSpecInput(value);
  if (!isRecord(candidate)) {
    return {
      ok: false,
      errors: [
        {
          code: "invalid_spec",
          message:
            typeof value === "string"
              ? "spec was a string that is not valid JSON. Pass a Salesforce Diagram Spec object or its exact JSON text."
              : "spec must be an object.",
        },
      ],
      warnings,
    };
  }

  rejectPrivateKeys(candidate, "$", errors);
  requiredLiteral(candidate, "spec_version", "1.0", errors);
  requiredString(candidate, "title", errors, 1, 100);
  requiredString(candidate, "scope", errors, 1, 180);

  const family = candidate.family;
  if (family !== "data_model" && family !== "architecture" && family !== "sequence") {
    errors.push({
      code: "invalid_family",
      message: "family must be data_model, architecture, or sequence.",
      path: "family",
    });
  } else if (expectedFamily && family !== expectedFamily) {
    errors.push({
      code: "family_action_mismatch",
      message: `Action requires family '${expectedFamily}', received '${family}'.`,
      path: "family",
    });
  }

  const sourceIds = validateGrounding(candidate.grounding, errors);
  if (family === "data_model") validateDataModel(candidate, sourceIds, errors, warnings);
  if (family === "architecture") validateArchitecture(candidate, sourceIds, errors, warnings);
  if (family === "sequence") validateSequence(candidate, sourceIds, errors, warnings);

  return {
    ok: errors.length === 0,
    spec:
      errors.length === 0
        ? (structuredClone(candidate) as unknown as SalesforceDiagramSpec)
        : undefined,
    errors,
    warnings,
  };
}

/** Accept either a spec object or the exact JSON text of one. */
function coerceSpecInput(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function validateGrounding(value: unknown, errors: ValidationFinding[]): Set<string> {
  const sourceIds = new Set<string>();
  if (!isRecord(value)) {
    errors.push({
      code: "missing_grounding",
      message: "grounding is required.",
      path: "grounding",
    });
    return sourceIds;
  }
  if (value.mode !== "reference" && value.mode !== "org") {
    errors.push({
      code: "invalid_grounding_mode",
      message: "grounding.mode must be reference or org.",
      path: "grounding.mode",
    });
  }
  const asOf = requiredString(value, "as_of", errors, 4, 40, "grounding.as_of");
  if (asOf && Number.isNaN(Date.parse(asOf))) {
    errors.push({
      code: "invalid_as_of",
      message: "grounding.as_of must be an ISO date or date-time.",
      path: "grounding.as_of",
    });
  }
  if (value.mode === "org") {
    const displayLabel = requiredString(
      value,
      "display_label",
      errors,
      1,
      80,
      "grounding.display_label",
    );
    if (displayLabel && SENSITIVE_RENDERED_VALUE_RE.test(displayLabel)) {
      errors.push({
        code: "private_display_label",
        message:
          "grounding.display_label must not contain a username, org id, instance URL, or auth material.",
        path: "grounding.display_label",
      });
    }
    if (typeof value.target_org !== "string" || !ORG_ALIAS_RE.test(value.target_org)) {
      errors.push({
        code: "explicit_org_required",
        message: "Org grounding requires target_org as a short authenticated org alias.",
        path: "grounding.target_org",
      });
    }
  }
  if (!Array.isArray(value.sources) || value.sources.length === 0) {
    errors.push({
      code: "missing_sources",
      message: "grounding.sources must contain at least one evidence source.",
      path: "grounding.sources",
    });
    return sourceIds;
  }
  let hasOrgEvidence = false;
  for (let i = 0; i < value.sources.length; i++) {
    const source = value.sources[i];
    const path = `grounding.sources[${i}]`;
    if (!isRecord(source)) {
      errors.push({ code: "invalid_source", message: "Each source must be an object.", path });
      continue;
    }
    const id = validateId(source.id, `${path}.id`, errors);
    requiredString(source, "label", errors, 1, 120, `${path}.label`);
    if (id) {
      if (sourceIds.has(id))
        errors.push({
          code: "duplicate_source_id",
          message: `Duplicate source id '${id}'.`,
          path: `${path}.id`,
        });
      sourceIds.add(id);
    }
    if (value.mode === "reference") {
      if (source.kind !== "official_doc") {
        errors.push({
          code: "reference_requires_official_source",
          message: "Reference-grounded sources must use kind='official_doc'.",
          path: `${path}.kind`,
        });
      }
      if (!isOfficialSalesforceUrl(source.url)) {
        errors.push({
          code: "reference_requires_salesforce_url",
          message: "Reference-grounded sources require an official Salesforce documentation URL.",
          path: `${path}.url`,
        });
      }
    } else if (!isOrgSourceKind(source.kind)) {
      errors.push({
        code: "invalid_org_source",
        message:
          "Org-grounded sources must be org_describe, org_query, official_doc, or user_provided.",
        path: `${path}.kind`,
      });
    } else if (source.kind === "org_describe" || source.kind === "org_query") {
      hasOrgEvidence = true;
    }
  }
  if (value.mode === "org" && !hasOrgEvidence) {
    errors.push({
      code: "org_evidence_required",
      message: "Org grounding requires at least one org_describe or org_query source.",
      path: "grounding.sources",
    });
  }
  return sourceIds;
}

function validateDataModel(
  value: Record<string, unknown>,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  const objects = arrayField(value, "objects", errors);
  const relationships = arrayFieldAllowEmpty(value, "relationships", errors);
  enforceBudget("data_model", objects.length, relationships.length, errors, warnings);
  if (
    value.layout_mode !== undefined &&
    value.layout_mode !== "auto" &&
    value.layout_mode !== "source"
  ) {
    errors.push({
      code: "invalid_layout_mode",
      message: "layout_mode must be auto or source when provided.",
      path: "layout_mode",
    });
  }
  const ids = new Set<string>();
  for (let i = 0; i < objects.length; i++) {
    const item = objects[i];
    const path = `objects[${i}]`;
    if (!isRecord(item)) {
      errors.push({ code: "invalid_object", message: "Each object must be an object.", path });
      continue;
    }
    const id = validateUniqueId(item.id, path, ids, errors);
    requiredString(item, "label", errors, 1, 80, `${path}.label`);
    const apiName = optionalString(item, "api_name", errors, 1, 128, `${path}.api_name`);
    if (apiName && !API_NAME_RE.test(apiName))
      errors.push({
        code: "invalid_api_name",
        message: `Invalid API name '${apiName}'.`,
        path: `${path}.api_name`,
      });
    if (!["standard", "custom", "external", "special"].includes(String(item.family))) {
      errors.push({
        code: "invalid_object_family",
        message: "family must be standard, custom, external, or special.",
        path: `${path}.family`,
      });
    }
    if (
      item.entity_kind !== undefined &&
      !["object", "record_type", "conceptual", "external"].includes(String(item.entity_kind))
    ) {
      errors.push({
        code: "invalid_entity_kind",
        message: "entity_kind must be object, record_type, conceptual, or external.",
        path: `${path}.entity_kind`,
      });
    }
    validateSourcePosition(item.source_position, `${path}.source_position`, errors);
    if (value.layout_mode === "source" && !isRecord(item.source_position)) {
      errors.push({
        code: "source_position_required",
        message: "Every object requires source_position when layout_mode='source'.",
        path: `${path}.source_position`,
      });
    }
    validateIcon(item.icon, `${path}.icon`, errors);
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
    validateOptionalStringArray(item.key_fields, `${path}.key_fields`, 4, errors);
    if (isRecord(item.observations))
      validateObservations(item.observations, path, errors, warnings);
    if (!id) continue;
  }
  const relationshipIds = new Set<string>();
  const degrees = new Map([...ids].map((id) => [id, 0]));
  for (let i = 0; i < relationships.length; i++) {
    const item = relationships[i];
    const path = `relationships[${i}]`;
    if (!isRecord(item)) {
      errors.push({
        code: "invalid_relationship",
        message: "Each relationship must be an object.",
        path,
      });
      continue;
    }
    validateUniqueId(item.id, path, relationshipIds, errors);
    validateEndpoint(item.from, ids, `${path}.from`, errors);
    validateEndpoint(item.to, ids, `${path}.to`, errors);
    if (typeof item.from === "string" && degrees.has(item.from)) {
      degrees.set(item.from, (degrees.get(item.from) ?? 0) + 1);
    }
    if (typeof item.to === "string" && degrees.has(item.to)) {
      degrees.set(item.to, (degrees.get(item.to) ?? 0) + 1);
    }
    if (item.type !== "lookup" && item.type !== "master_detail")
      errors.push({
        code: "invalid_relationship_type",
        message: "type must be lookup or master_detail.",
        path: `${path}.type`,
      });
    validateCardinality(item.from_cardinality, `${path}.from_cardinality`, errors);
    validateCardinality(item.to_cardinality, `${path}.to_cardinality`, errors);
    if (
      item.field_api_name !== undefined &&
      (typeof item.field_api_name !== "string" || !API_NAME_RE.test(item.field_api_name))
    ) {
      errors.push({
        code: "invalid_relationship_field",
        message: "field_api_name must be a valid API name when provided.",
        path: `${path}.field_api_name`,
      });
    }
    validateRelationshipAnchor(item.from_anchor, `${path}.from_anchor`, errors);
    validateRelationshipAnchor(item.to_anchor, `${path}.to_anchor`, errors);
    if ((item.from_anchor === undefined) !== (item.to_anchor === undefined)) {
      errors.push({
        code: "relationship_anchor_pair_required",
        message: "from_anchor and to_anchor must be provided together.",
        path,
      });
    }
    optionalString(item, "from_label", errors, 1, 80, `${path}.from_label`);
    optionalString(item, "to_label", errors, 1, 80, `${path}.to_label`);
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
  }
  for (const [id, degree] of degrees) {
    if (degree <= MAX_DATA_MODEL_NODE_DEGREE) continue;
    errors.push({
      code: "node_degree_exceeded",
      message: `Object '${id}' has ${degree} relationship terminals; the single-card limit is ${MAX_DATA_MODEL_NODE_DEGREE}. Split the scope or introduce an evidenced continuation view.`,
      path: "relationships",
    });
  }
}

function validateArchitecture(
  value: Record<string, unknown>,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  const systems = arrayField(value, "systems", errors);
  const connections = arrayField(value, "connections", errors);
  enforceBudget("architecture", systems.length, connections.length, errors, warnings);
  const ids = new Set<string>();
  for (let i = 0; i < systems.length; i++) {
    const item = systems[i];
    const path = `systems[${i}]`;
    if (!isRecord(item)) {
      errors.push({ code: "invalid_system", message: "Each system must be an object.", path });
      continue;
    }
    validateUniqueId(item.id, path, ids, errors);
    requiredString(item, "label", errors, 1, 80, `${path}.label`);
    requiredString(item, "responsibility", errors, 1, 140, `${path}.responsibility`);
    if (!NODE_KINDS.has(String(item.kind))) {
      errors.push({
        code: "invalid_system_kind",
        message: "kind must be salesforce, external, user, data_store, or integration.",
        path: `${path}.kind`,
      });
    }
    if (
      item.boundary !== undefined &&
      (typeof item.boundary !== "string" || !item.boundary.trim() || item.boundary.length > 80)
    ) {
      errors.push({
        code: "invalid_boundary",
        message: "boundary must be a non-empty string up to 80 characters.",
        path: `${path}.boundary`,
      });
    }
    validateProductMark(item.product_mark, `${path}.product_mark`, errors);
    validateIcon(item.icon, `${path}.icon`, errors);
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
    if (item.product_mark)
      warnings.push({
        code: "product_mark_fallback",
        message: `Product mark '${item.product_mark}' is source-gated and uses a semantic icon unless an approved asset is bundled.`,
        path: `${path}.product_mark`,
      });
  }
  const edgeIds = new Set<string>();
  for (let i = 0; i < connections.length; i++) {
    const item = connections[i];
    const path = `connections[${i}]`;
    if (!isRecord(item)) {
      errors.push({
        code: "invalid_connection",
        message: "Each connection must be an object.",
        path,
      });
      continue;
    }
    validateUniqueId(item.id, path, edgeIds, errors);
    validateEndpoint(item.from, ids, `${path}.from`, errors);
    validateEndpoint(item.to, ids, `${path}.to`, errors);
    requiredString(item, "label", errors, 1, 100, `${path}.label`);
    if (!["directional", "async_or_batch", "dependency"].includes(String(item.meaning)))
      errors.push({
        code: "invalid_connection_meaning",
        message: "meaning must be directional, async_or_batch, or dependency.",
        path: `${path}.meaning`,
      });
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
  }
}

function validateSequence(
  value: Record<string, unknown>,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  const participants = arrayField(value, "participants", errors);
  const interactions = arrayField(value, "interactions", errors);
  const activations = optionalArrayField(value, "activations", errors);
  enforceBudget("sequence", participants.length, interactions.length, errors, warnings);
  const ids = new Set<string>();
  for (let i = 0; i < participants.length; i++) {
    const item = participants[i];
    const path = `participants[${i}]`;
    if (!isRecord(item)) {
      errors.push({
        code: "invalid_participant",
        message: "Each participant must be an object.",
        path,
      });
      continue;
    }
    validateUniqueId(item.id, path, ids, errors);
    requiredString(item, "label", errors, 1, 80, `${path}.label`);
    if (!NODE_KINDS.has(String(item.kind))) {
      errors.push({
        code: "invalid_participant_kind",
        message: "kind must be salesforce, external, user, data_store, or integration.",
        path: `${path}.kind`,
      });
    }
    validateProductMark(item.product_mark, `${path}.product_mark`, errors);
    validateIcon(item.icon, `${path}.icon`, errors);
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
    if (item.product_mark)
      warnings.push({
        code: "product_mark_fallback",
        message: `Product mark '${item.product_mark}' is source-gated and uses a semantic icon unless an approved asset is bundled.`,
        path: `${path}.product_mark`,
      });
  }
  const edgeIds = new Set<string>();
  const steps = new Set<number>();
  for (let i = 0; i < interactions.length; i++) {
    const item = interactions[i];
    const path = `interactions[${i}]`;
    if (!isRecord(item)) {
      errors.push({
        code: "invalid_interaction",
        message: "Each interaction must be an object.",
        path,
      });
      continue;
    }
    validateUniqueId(item.id, path, edgeIds, errors);
    validateEndpoint(item.from, ids, `${path}.from`, errors);
    validateEndpoint(item.to, ids, `${path}.to`, errors);
    if (typeof item.from === "string" && item.from === item.to)
      errors.push({
        code: "unsupported_self_interaction",
        message:
          "Self-interactions require loop routing and are not supported by the sequence renderer.",
        path,
      });
    requiredString(item, "label", errors, 1, 100, `${path}.label`);
    if (!Number.isInteger(item.step) || Number(item.step) < 1)
      errors.push({
        code: "invalid_step",
        message: "step must be a positive integer.",
        path: `${path}.step`,
      });
    else if (steps.has(Number(item.step)))
      errors.push({
        code: "duplicate_step",
        message: `Duplicate sequence step '${item.step}'.`,
        path: `${path}.step`,
      });
    else steps.add(Number(item.step));
    if (!["request", "response", "async", "event"].includes(String(item.kind)))
      errors.push({
        code: "invalid_interaction_kind",
        message: "kind must be request, response, async, or event.",
        path: `${path}.kind`,
      });
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
  }
  const ordered = [...steps].sort((a, b) => a - b);
  if (ordered.some((step, index) => step !== index + 1))
    errors.push({
      code: "non_contiguous_steps",
      message: "Sequence steps must be contiguous starting at 1.",
      path: "interactions",
    });
  const activationIds = new Set<string>();
  const activationRanges: Array<{
    participant: string;
    start: number;
    end: number;
    path: string;
  }> = [];
  for (let i = 0; i < activations.length; i++) {
    const item = activations[i];
    const path = `activations[${i}]`;
    if (!isRecord(item)) {
      errors.push({
        code: "invalid_activation",
        message: "Each activation must be an object.",
        path,
      });
      continue;
    }
    validateUniqueId(item.id, path, activationIds, errors);
    validateEndpoint(item.participant, ids, `${path}.participant`, errors);
    const start = item.start_step;
    const end = item.end_step;
    if (!Number.isInteger(start) || Number(start) < 1 || !steps.has(Number(start)))
      errors.push({
        code: "invalid_activation_start",
        message: "start_step must reference a declared sequence step.",
        path: `${path}.start_step`,
      });
    if (!Number.isInteger(end) || Number(end) < 1 || !steps.has(Number(end)))
      errors.push({
        code: "invalid_activation_end",
        message: "end_step must reference a declared sequence step.",
        path: `${path}.end_step`,
      });
    if (Number.isInteger(start) && Number.isInteger(end) && Number(start) > Number(end))
      errors.push({
        code: "reversed_activation",
        message: "start_step must be less than or equal to end_step.",
        path,
      });
    if (
      typeof item.participant === "string" &&
      ids.has(item.participant) &&
      Number.isInteger(start) &&
      Number.isInteger(end) &&
      steps.has(Number(start)) &&
      steps.has(Number(end)) &&
      Number(start) <= Number(end)
    ) {
      activationRanges.push({
        participant: item.participant,
        start: Number(start),
        end: Number(end),
        path,
      });
    }
    validateEvidence(item.evidence, sourceIds, `${path}.evidence`, errors);
  }
  activationRanges.sort(
    (left, right) =>
      left.participant.localeCompare(right.participant) ||
      left.start - right.start ||
      left.end - right.end,
  );
  for (let i = 1; i < activationRanges.length; i++) {
    const previous = activationRanges[i - 1];
    const current = activationRanges[i];
    if (!previous || !current) continue;
    if (current.participant === previous.participant && current.start <= previous.end)
      errors.push({
        code: "overlapping_activation",
        message:
          "Activation intervals for one participant must not overlap until nested-bar routing is supported.",
        path: current.path,
      });
  }
  if (participants.length > 6)
    warnings.push({
      code: "wide_sequence",
      message:
        "Sequences with more than six participants are easier to review when split by responsibility.",
    });
  if (interactions.length > 12)
    warnings.push({
      code: "long_sequence",
      message:
        "Sequences with more than twelve interactions are easier to review when split into phases.",
    });
}

function validateObservations(
  value: Record<string, unknown>,
  path: string,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  if (value.row_count !== undefined) {
    if (
      !isRecord(value.row_count) ||
      typeof value.row_count.value !== "number" ||
      !Number.isFinite(value.row_count.value) ||
      value.row_count.value < 0 ||
      (value.row_count.exact !== undefined && typeof value.row_count.exact !== "boolean")
    )
      errors.push({
        code: "invalid_row_count",
        message: "row_count requires a finite non-negative value and optional boolean exact flag.",
        path: `${path}.observations.row_count`,
      });
  }
  if (
    value.owd !== undefined &&
    (typeof value.owd !== "string" || !value.owd.trim() || value.owd.length > 80)
  ) {
    errors.push({
      code: "invalid_owd",
      message: "owd must be a non-empty string up to 80 characters.",
      path: `${path}.observations.owd`,
    });
  }
  validateOptionalStringArray(value.record_types, `${path}.observations.record_types`, 20, errors);
  if (Array.isArray(value.record_types) && value.record_types.length > 5)
    warnings.push({
      code: "record_types_truncated",
      message: "Only the first five record types can fit on an overview card.",
      path: `${path}.observations.record_types`,
    });
}

function validateProductMark(value: unknown, path: string, errors: ValidationFinding[]): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !PRODUCT_MARK_KEYS.has(value)) {
    errors.push({
      code: "invalid_product_mark",
      message: "product_mark is not in the approved registry.",
      path,
    });
  }
}

function validateOptionalStringArray(
  value: unknown,
  path: string,
  maxItems: number,
  errors: ValidationFinding[],
): void {
  if (value === undefined) return;
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some((item) => typeof item !== "string" || !item.trim() || item.length > 100)
  ) {
    errors.push({
      code: "invalid_string_array",
      message: `${path} must contain at most ${maxItems} non-empty strings up to 100 characters.`,
      path,
    });
  }
}

function validateIcon(value: unknown, path: string, errors: ValidationFinding[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push({ code: "invalid_icon", message: "icon must be an object.", path });
    return;
  }
  if (!["standard", "custom", "utility", "action", "doctype"].includes(String(value.category)))
    errors.push({
      code: "invalid_icon_category",
      message: "Unsupported SLDS icon category.",
      path: `${path}.category`,
    });
  if (typeof value.name !== "string" || !ICON_NAME_RE.test(value.name))
    errors.push({
      code: "invalid_icon_name",
      message: "Icon name must be a lowercase SLDS asset name.",
      path: `${path}.name`,
    });
  if (
    value.color !== undefined &&
    (typeof value.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.color))
  )
    errors.push({
      code: "invalid_icon_color",
      message: "Icon color must be a six-digit hex color.",
      path: `${path}.color`,
    });
}

function validateEvidence(
  value: unknown,
  sourceIds: Set<string>,
  path: string,
  errors: ValidationFinding[],
): void {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push({
      code: "missing_evidence",
      message: "Every semantic element requires at least one source id.",
      path,
    });
    return;
  }
  for (const sourceId of value) {
    if (typeof sourceId !== "string" || !sourceIds.has(sourceId))
      errors.push({
        code: "unknown_evidence_source",
        message: `Unknown evidence source '${String(sourceId)}'.`,
        path,
      });
  }
}

function validateCardinality(value: unknown, path: string, errors: ValidationFinding[]): void {
  if (!["one", "many", "zero_or_one", "zero_or_many"].includes(String(value)))
    errors.push({
      code: "invalid_cardinality",
      message: "Cardinality must be one, many, zero_or_one, or zero_or_many.",
      path,
    });
}

function validateEndpoint(
  value: unknown,
  ids: Set<string>,
  path: string,
  errors: ValidationFinding[],
): void {
  if (typeof value !== "string" || !ids.has(value))
    errors.push({
      code: "dangling_endpoint",
      message: `Endpoint '${String(value)}' does not reference a declared node.`,
      path,
    });
}

function validateUniqueId(
  value: unknown,
  path: string,
  ids: Set<string>,
  errors: ValidationFinding[],
): string | null {
  const id = validateId(value, `${path}.id`, errors);
  if (!id) return null;
  if (ids.has(id))
    errors.push({ code: "duplicate_id", message: `Duplicate id '${id}'.`, path: `${path}.id` });
  ids.add(id);
  return id;
}

function validateId(value: unknown, path: string, errors: ValidationFinding[]): string | null {
  if (typeof value !== "string" || !ID_RE.test(value)) {
    errors.push({
      code: "invalid_id",
      message:
        "IDs must start with a letter and contain only letters, numbers, dot, underscore, or hyphen.",
      path,
    });
    return null;
  }
  return value;
}

function enforceBudget(
  family: DiagramFamily,
  nodes: number,
  edges: number,
  errors: ValidationFinding[],
  warnings?: ValidationFinding[],
): void {
  const limit = LIMITS[family];
  if (nodes > limit.nodes || edges > limit.edges) {
    errors.push({
      code: "single_page_density_exceeded",
      message: `${family} single-page limit is ${limit.nodes} nodes and ${limit.edges} connections; split the scope into multiple render calls.`,
    });
    return;
  }
  const budget = READABILITY_BUDGET[family];
  if (warnings && budget && (nodes > budget.nodes || edges > budget.edges)) {
    warnings.push({
      code: "single_page_density_warning",
      message: `${nodes} nodes and ${edges} connections exceed the comfortable ${family} reading budget of ${budget.nodes} nodes and ${budget.edges} connections; the page still renders deterministically.`,
    });
  }
}

function optionalArrayField(
  value: Record<string, unknown>,
  key: string,
  errors: ValidationFinding[],
): unknown[] {
  if (value[key] === undefined) return [];
  if (!Array.isArray(value[key])) {
    errors.push({
      code: `invalid_${key}`,
      message: `${key} must be an array when provided.`,
      path: key,
    });
    return [];
  }
  return value[key] as unknown[];
}

function arrayFieldAllowEmpty(
  value: Record<string, unknown>,
  key: string,
  errors: ValidationFinding[],
): unknown[] {
  if (!Array.isArray(value[key])) {
    errors.push({
      code: `missing_${key}`,
      message: `${key} must be an array.`,
      path: key,
    });
    return [];
  }
  return value[key] as unknown[];
}

function arrayField(
  value: Record<string, unknown>,
  key: string,
  errors: ValidationFinding[],
): unknown[] {
  if (!Array.isArray(value[key]) || value[key].length === 0) {
    errors.push({
      code: `missing_${key}`,
      message: `${key} must be a non-empty array.`,
      path: key,
    });
    return [];
  }
  return value[key] as unknown[];
}

function requiredLiteral(
  value: Record<string, unknown>,
  key: string,
  expected: string,
  errors: ValidationFinding[],
): void {
  if (value[key] !== expected)
    errors.push({ code: `invalid_${key}`, message: `${key} must be '${expected}'.`, path: key });
}

function requiredString(
  value: Record<string, unknown>,
  key: string,
  errors: ValidationFinding[],
  min: number,
  max: number,
  path = key,
): string | null {
  const field = value[key];
  if (typeof field !== "string" || field.trim().length < min || field.trim().length > max) {
    errors.push({
      code: `invalid_${key}`,
      message: `${path} must be a string between ${min} and ${max} characters.`,
      path,
    });
    return null;
  }
  return field.trim();
}

function optionalString(
  value: Record<string, unknown>,
  key: string,
  errors: ValidationFinding[],
  min: number,
  max: number,
  path = key,
): string | null {
  if (value[key] === undefined) return null;
  return requiredString(value, key, errors, min, max, path);
}

function validateRelationshipAnchor(
  value: unknown,
  path: string,
  errors: ValidationFinding[],
): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_relationship_anchor",
      message: "Relationship anchor must be an object.",
      path,
    });
    return;
  }
  if (!["left", "right", "top", "bottom"].includes(String(value.side))) {
    errors.push({
      code: "invalid_relationship_anchor",
      message: "Relationship anchor side must be left, right, top, or bottom.",
      path: `${path}.side`,
    });
  }
  if (
    typeof value.fraction !== "number" ||
    !Number.isFinite(value.fraction) ||
    value.fraction < 0.05 ||
    value.fraction > 0.95
  ) {
    errors.push({
      code: "invalid_relationship_anchor",
      message: "Relationship anchor fraction must be between 0.05 and 0.95.",
      path: `${path}.fraction`,
    });
  }
}

function validateSourcePosition(value: unknown, path: string, errors: ValidationFinding[]): void {
  if (value === undefined) return;
  if (!isRecord(value)) {
    errors.push({
      code: "invalid_source_position",
      message: "source_position must be an object.",
      path,
    });
    return;
  }
  for (const key of ["x", "y", "w", "h"] as const) {
    const coordinate = value[key];
    if (
      typeof coordinate !== "number" ||
      !Number.isFinite(coordinate) ||
      Math.abs(coordinate) > 1_000_000 ||
      ((key === "w" || key === "h") && coordinate <= 0)
    ) {
      errors.push({
        code: "invalid_source_position",
        message: `source_position.${key} must be a finite ${key === "w" || key === "h" ? "positive " : ""}number within the supported canvas range.`,
        path: `${path}.${key}`,
      });
    }
  }
}

function rejectPrivateKeys(value: unknown, path: string, errors: ValidationFinding[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectPrivateKeys(item, `${path}[${index}]`, errors));
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (PRIVATE_KEY_RE.test(key) && !(path === "$.grounding" && key === "target_org")) {
      errors.push({
        code: "private_identity_field",
        message: `Private identity/auth field '${key}' is not allowed in a diagram spec.`,
        path: childPath,
      });
      continue;
    }
    rejectPrivateKeys(child, childPath, errors);
  }
}

function isOfficialSalesforceUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && OFFICIAL_SALESFORCE_HOSTS.has(url.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function isOrgSourceKind(value: unknown): value is DiagramSource["kind"] {
  return (
    value === "org_describe" ||
    value === "org_query" ||
    value === "official_doc" ||
    value === "user_provided"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
