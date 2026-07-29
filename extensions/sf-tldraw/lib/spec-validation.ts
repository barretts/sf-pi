/* SPDX-License-Identifier: Apache-2.0 */
/** Structural TypeBox validation plus Salesforce-specific semantic refinements. */
import { Check, Errors } from "typebox/value";
import {
  ArchitectureSpecSchema,
  DataModelSpecSchema,
  OrgGroundingSchema,
  ReferenceGroundingSchema,
  SequenceSpecSchema,
} from "./spec-schema.ts";
import type {
  ArchitectureSpec,
  DataModelSpec,
  DiagramFamily,
  SalesforceDiagramSpec,
  SequenceSpec,
  ValidationFinding,
  ValidationResult,
} from "./types.ts";

const OFFICIAL_SALESFORCE_HOSTS = new Set([
  "developer.salesforce.com",
  "help.salesforce.com",
  "architect.salesforce.com",
  "admin.salesforce.com",
  "lightningdesignsystem.com",
]);
const PRIVATE_KEY_RE =
  /(?:access.?token|refresh.?token|authorization|password|secret|instance.?url|org.?id|user.?name|sfdx.?auth.?url)/i;
const BEARER_MATERIAL_RE = /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/;
const BASIC_MATERIAL_RE = /\bBasic\s+([A-Za-z0-9+/=]{12,})\b/;
const PRIVATE_RENDERED_VALUE_RE =
  /(?:\b00D[A-Za-z0-9]{12,15}\b|\b(?:access|refresh)[ _-]?token\s*[:=]\s*\S+|\b(?:password|secret|username|client[_ -]?secret)\s*[:=]\s*\S+|\bAuthorization\s*:\s*(?:Basic|Bearer)\s+\S+|\S+@\S+|(?:https?:\/\/)?(?:login|test|[A-Za-z0-9-]+)\.(?:salesforce\.com|force\.com)\b)/i;
const MAX_DATA_MODEL_NODE_DEGREE = 36;

const LIMITS: Record<DiagramFamily, { nodes: number; edges: number }> = {
  data_model: { nodes: 160, edges: 260 },
  architecture: { nodes: 16, edges: 24 },
  sequence: { nodes: 8, edges: 18 },
};
const READABILITY_BUDGET: Partial<Record<DiagramFamily, { nodes: number; edges: number }>> = {
  data_model: { nodes: 34, edges: 56 },
};

export function validateDiagramSpec(
  value: unknown,
  expectedFamily?: DiagramFamily,
): ValidationResult {
  const errors: ValidationFinding[] = [];
  const warnings: ValidationFinding[] = [];
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

  if (
    isRecord(candidate.grounding) &&
    candidate.grounding.mode !== "reference" &&
    candidate.grounding.mode !== "org"
  ) {
    errors.push({
      code: "invalid_grounding_mode",
      message: "grounding.mode must be reference or org.",
      path: "grounding.mode",
    });
    return { ok: false, errors: uniqueFindings(errors), warnings };
  }

  const family = candidate.family;
  if (family !== "data_model" && family !== "architecture" && family !== "sequence") {
    errors.push({
      code: "invalid_family",
      message: "family must be data_model, architecture, or sequence.",
      path: "family",
    });
    return { ok: false, errors, warnings };
  }
  if (expectedFamily && family !== expectedFamily) {
    errors.push({
      code: "family_action_mismatch",
      message: `Action requires family '${expectedFamily}', received '${family}'.`,
      path: "family",
    });
  }

  const schema =
    family === "data_model"
      ? DataModelSpecSchema
      : family === "architecture"
        ? ArchitectureSpecSchema
        : SequenceSpecSchema;
  if (!Check(schema, candidate)) {
    errors.push(...structuralFindings(schema, candidate));
    if (isRecord(candidate.grounding) && candidate.grounding.mode === "org") {
      if (
        typeof candidate.grounding.target_org !== "string" ||
        !candidate.grounding.target_org.trim()
      ) {
        errors.push({
          code: "explicit_org_required",
          message: "Org grounding requires target_org as a short authenticated org alias.",
          path: "grounding.target_org",
        });
      }
      const sources = Array.isArray(candidate.grounding.sources) ? candidate.grounding.sources : [];
      if (
        !sources.some(
          (source) =>
            isRecord(source) && (source.kind === "org_describe" || source.kind === "org_query"),
        )
      ) {
        errors.push({
          code: "org_evidence_required",
          message: "Org grounding requires at least one org_describe or org_query source.",
          path: "grounding.sources",
        });
      }
    }
    return { ok: false, errors: uniqueFindings(errors), warnings };
  }

  const spec = structuredClone(candidate) as SalesforceDiagramSpec;
  validateRenderedPrivacy(spec, errors);
  const sourceIds = validateGrounding(spec, errors);
  if (spec.family === "data_model") validateDataModel(spec, sourceIds, errors, warnings);
  if (spec.family === "architecture") validateArchitecture(spec, sourceIds, errors, warnings);
  if (spec.family === "sequence") validateSequence(spec, sourceIds, errors, warnings);

  return {
    ok: errors.length === 0,
    spec: errors.length === 0 ? spec : undefined,
    errors: uniqueFindings(errors),
    warnings: uniqueFindings(warnings),
  };
}

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

function structuralFindings(schema: object, value: Record<string, unknown>): ValidationFinding[] {
  let findings = schemaFindings(schema, value);
  if (
    isRecord(value.grounding) &&
    (value.grounding.mode === "reference" || value.grounding.mode === "org")
  ) {
    findings = findings.filter(
      (finding) => finding.path !== "grounding" && !finding.path?.startsWith("grounding."),
    );
    const groundingSchema =
      value.grounding.mode === "reference" ? ReferenceGroundingSchema : OrgGroundingSchema;
    findings.push(
      ...schemaFindings(groundingSchema, value.grounding).map((finding) => ({
        ...finding,
        path: finding.path ? `grounding.${finding.path}` : "grounding",
      })),
    );
  }
  return findings.map((finding) => normalizeStructuralFinding(finding, value));
}

function normalizeStructuralFinding(
  finding: ValidationFinding,
  value: Record<string, unknown>,
): ValidationFinding {
  const path = finding.path ?? "";
  const groundingMode = isRecord(value.grounding) ? value.grounding.mode : undefined;
  if (/^grounding\.sources\[\d+\]$/.test(path)) {
    return { ...finding, code: "invalid_source" };
  }
  if (/^grounding\.sources\[\d+\]\.kind$/.test(path)) {
    return {
      ...finding,
      code:
        groundingMode === "reference" ? "reference_requires_official_source" : "invalid_org_source",
    };
  }
  for (const [pattern, code] of [
    [/^objects\[\d+\]$/, "invalid_object"],
    [/^relationships\[\d+\]$/, "invalid_relationship"],
    [/^systems\[\d+\]$/, "invalid_system"],
    [/^connections\[\d+\]$/, "invalid_connection"],
    [/^participants\[\d+\]$/, "invalid_participant"],
    [/^interactions\[\d+\]$/, "invalid_interaction"],
    [/^activations\[\d+\]$/, "invalid_activation"],
  ] as const) {
    if (pattern.test(path)) return { ...finding, code };
  }
  if (/\.observations\.row_count(?:\.value|\.exact)?$/.test(path)) {
    return {
      ...finding,
      code: "invalid_row_count",
      path: path.replace(/\.(?:value|exact)$/, ""),
    };
  }
  return finding;
}

function schemaFindings(schema: object, value: unknown): ValidationFinding[] {
  const findings: ValidationFinding[] = [];
  for (const error of Errors(schema as never, value)) {
    const basePath = pointerToPath(error.instancePath);
    if (error.keyword === "additionalProperties") {
      const extras = Array.isArray(error.params.additionalProperties)
        ? error.params.additionalProperties
        : [];
      for (const extra of extras) {
        const path = joinPath(basePath, String(extra));
        findings.push({
          code: "unknown_field",
          message: `Unknown field '${String(extra)}' is not allowed in Salesforce Diagram Spec v2.`,
          path,
        });
      }
      continue;
    }
    if (error.keyword === "required") {
      const required = Array.isArray(error.params.requiredProperties)
        ? error.params.requiredProperties
        : [];
      for (const field of required) {
        findings.push({
          code: `missing_${String(field)}`,
          message: `${String(field)} is required.`,
          path: joinPath(basePath, String(field)),
        });
      }
      continue;
    }
    const field = lastPathSegment(basePath) ?? "spec";
    const code = structuralDiagnosticCode(basePath, field);
    findings.push({
      code,
      message: `${basePath || "spec"} ${error.message}.`,
      path: basePath || undefined,
    });
  }
  return findings;
}

function structuralDiagnosticCode(path: string, field: string): string {
  if (field === "target_org") return "explicit_org_required";
  if (field === "key_fields" || field === "record_types") return "invalid_string_array";
  if (/^systems\[\d+\]\.kind$/.test(path)) return "invalid_system_kind";
  if (/^participants\[\d+\]\.kind$/.test(path)) return "invalid_participant_kind";
  if (/^objects\[\d+\]\.family$/.test(path)) return "invalid_object_family";
  if (/^objects\[\d+\]\.entity_kind$/.test(path)) return "invalid_entity_kind";
  if (/^relationships\[\d+\]\.type$/.test(path)) return "invalid_relationship_type";
  if (/^relationships\[\d+\]\.(?:from_cardinality|to_cardinality)$/.test(path))
    return "invalid_cardinality";
  if (/^relationships\[\d+\]\.field_api_name$/.test(path)) return "invalid_relationship_field";
  if (/\.icon\.category$/.test(path)) return "invalid_icon_category";
  if (/\.icon\.name$/.test(path)) return "invalid_icon_name";
  if (/\.icon\.color$/.test(path)) return "invalid_icon_color";
  if (/\.observations\.row_count(?:\.|$)/.test(path)) return "invalid_row_count";
  if (/\.observations\.owd$/.test(path)) return "invalid_owd";
  if (/^connections\[\d+\]\.meaning$/.test(path)) return "invalid_connection_meaning";
  if (/^interactions\[\d+\]\.kind$/.test(path)) return "invalid_interaction_kind";
  if (/^interactions\[\d+\]\.step$/.test(path)) return "invalid_step";
  if (/^activations\[\d+\]\.start_step$/.test(path)) return "invalid_activation_start";
  if (/^activations\[\d+\]\.end_step$/.test(path)) return "invalid_activation_end";
  return `invalid_${field}`;
}

function validateGrounding(spec: SalesforceDiagramSpec, errors: ValidationFinding[]): Set<string> {
  const sourceIds = new Set<string>();
  let hasOrgEvidence = false;
  const asOf = spec.grounding.as_of;
  if (Number.isNaN(Date.parse(asOf))) {
    errors.push({
      code: "invalid_as_of",
      message: "grounding.as_of must be an ISO date or date-time.",
      path: "grounding.as_of",
    });
  }
  for (let index = 0; index < spec.grounding.sources.length; index++) {
    const source = spec.grounding.sources[index];
    if (!source) continue;
    const path = `grounding.sources[${index}]`;
    if (sourceIds.has(source.id)) {
      errors.push({
        code: "duplicate_source_id",
        message: `Duplicate source id '${source.id}'.`,
        path: `${path}.id`,
      });
    }
    sourceIds.add(source.id);
    if (spec.grounding.mode === "reference") {
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
    } else if (source.kind === "org_describe" || source.kind === "org_query") {
      hasOrgEvidence = true;
    }
  }
  if (spec.grounding.mode === "org" && !hasOrgEvidence) {
    errors.push({
      code: "org_evidence_required",
      message: "Org grounding requires at least one org_describe or org_query source.",
      path: "grounding.sources",
    });
  }
  return sourceIds;
}

function validateDataModel(
  spec: DataModelSpec,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  enforceBudget("data_model", spec.objects.length, spec.relationships.length, errors, warnings);
  const ids = uniqueIds(spec.objects, "objects", errors);
  spec.objects.forEach((object, index) => {
    validateEvidence(object.evidence, sourceIds, `objects[${index}].evidence`, errors);
    if ((object.observations?.record_types?.length ?? 0) > 5) {
      warnings.push({
        code: "record_types_truncated",
        message: "Only the first five record types can fit on an overview card.",
        path: `objects[${index}].observations.record_types`,
      });
    }
  });

  const relationshipIds = new Set<string>();
  const degrees = new Map([...ids].map((id) => [id, 0]));
  spec.relationships.forEach((relationship, index) => {
    const path = `relationships[${index}]`;
    validateUniqueId(relationship.id, relationshipIds, `${path}.id`, errors);
    validateEndpoint(relationship.from, ids, `${path}.from`, errors);
    validateEndpoint(relationship.to, ids, `${path}.to`, errors);
    if (degrees.has(relationship.from)) {
      degrees.set(relationship.from, (degrees.get(relationship.from) ?? 0) + 1);
    }
    if (degrees.has(relationship.to)) {
      degrees.set(relationship.to, (degrees.get(relationship.to) ?? 0) + 1);
    }
    validateEvidence(relationship.evidence, sourceIds, `${path}.evidence`, errors);
  });
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
  spec: ArchitectureSpec,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  enforceBudget("architecture", spec.systems.length, spec.connections.length, errors, warnings);
  const ids = uniqueIds(spec.systems, "systems", errors);
  spec.systems.forEach((system, index) =>
    validateEvidence(system.evidence, sourceIds, `systems[${index}].evidence`, errors),
  );
  const edgeIds = new Set<string>();
  spec.connections.forEach((connection, index) => {
    const path = `connections[${index}]`;
    validateUniqueId(connection.id, edgeIds, `${path}.id`, errors);
    validateEndpoint(connection.from, ids, `${path}.from`, errors);
    validateEndpoint(connection.to, ids, `${path}.to`, errors);
    validateEvidence(connection.evidence, sourceIds, `${path}.evidence`, errors);
  });
}

function validateSequence(
  spec: SequenceSpec,
  sourceIds: Set<string>,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
): void {
  enforceBudget("sequence", spec.participants.length, spec.interactions.length, errors, warnings);
  const ids = uniqueIds(spec.participants, "participants", errors);
  spec.participants.forEach((participant, index) =>
    validateEvidence(participant.evidence, sourceIds, `participants[${index}].evidence`, errors),
  );
  const edgeIds = new Set<string>();
  const steps = new Set<number>();
  spec.interactions.forEach((interaction, index) => {
    const path = `interactions[${index}]`;
    validateUniqueId(interaction.id, edgeIds, `${path}.id`, errors);
    validateEndpoint(interaction.from, ids, `${path}.from`, errors);
    validateEndpoint(interaction.to, ids, `${path}.to`, errors);
    if (interaction.from === interaction.to) {
      errors.push({
        code: "unsupported_self_interaction",
        message:
          "Self-interactions require loop routing and are not supported by the sequence renderer.",
        path,
      });
    }
    if (steps.has(interaction.step)) {
      errors.push({
        code: "duplicate_step",
        message: `Duplicate sequence step '${interaction.step}'.`,
        path: `${path}.step`,
      });
    }
    steps.add(interaction.step);
    validateEvidence(interaction.evidence, sourceIds, `${path}.evidence`, errors);
  });
  const ordered = [...steps].sort((left, right) => left - right);
  if (ordered.some((step, index) => step !== index + 1)) {
    errors.push({
      code: "non_contiguous_steps",
      message: "Sequence steps must be contiguous starting at 1.",
      path: "interactions",
    });
  }

  const activationIds = new Set<string>();
  const ranges: Array<{ participant: string; start: number; end: number; path: string }> = [];
  (spec.activations ?? []).forEach((activation, index) => {
    const path = `activations[${index}]`;
    validateUniqueId(activation.id, activationIds, `${path}.id`, errors);
    validateEndpoint(activation.participant, ids, `${path}.participant`, errors);
    if (!steps.has(activation.start_step)) {
      errors.push({
        code: "invalid_activation_start",
        message: "start_step must reference a declared sequence step.",
        path: `${path}.start_step`,
      });
    }
    if (!steps.has(activation.end_step)) {
      errors.push({
        code: "invalid_activation_end",
        message: "end_step must reference a declared sequence step.",
        path: `${path}.end_step`,
      });
    }
    if (activation.start_step > activation.end_step) {
      errors.push({
        code: "reversed_activation",
        message: "start_step must be less than or equal to end_step.",
        path,
      });
    }
    if (
      ids.has(activation.participant) &&
      steps.has(activation.start_step) &&
      steps.has(activation.end_step) &&
      activation.start_step <= activation.end_step
    ) {
      ranges.push({
        participant: activation.participant,
        start: activation.start_step,
        end: activation.end_step,
        path,
      });
    }
    validateEvidence(activation.evidence, sourceIds, `${path}.evidence`, errors);
  });
  ranges.sort(
    (left, right) =>
      left.participant.localeCompare(right.participant) ||
      left.start - right.start ||
      left.end - right.end,
  );
  for (let index = 1; index < ranges.length; index++) {
    const previous = ranges[index - 1];
    const current = ranges[index];
    if (!previous || !current) continue;
    if (current.participant === previous.participant && current.start <= previous.end) {
      errors.push({
        code: "overlapping_activation",
        message:
          "Activation intervals for one participant must not overlap until nested-bar routing is supported.",
        path: current.path,
      });
    }
  }
  if (spec.participants.length > 6) {
    warnings.push({
      code: "wide_sequence",
      message:
        "Sequences with more than six participants are easier to review when split by responsibility.",
    });
  }
  if (spec.interactions.length > 12) {
    warnings.push({
      code: "long_sequence",
      message:
        "Sequences with more than twelve interactions are easier to review when split into phases.",
    });
  }
}

export function validateRenderedText(value: string | undefined, path: string): ValidationFinding[] {
  if (!value || !containsPrivateRenderedValue(value)) return [];
  return [
    {
      code: "private_rendered_value",
      message:
        "Rendered diagram text must not contain authentication material, org ids, usernames or email addresses, instance URLs, or authentication URLs.",
      path,
    },
  ];
}

function containsPrivateRenderedValue(value: string): boolean {
  if (PRIVATE_RENDERED_VALUE_RE.test(value) || BEARER_MATERIAL_RE.test(value)) return true;
  const basic = value.match(BASIC_MATERIAL_RE)?.[1];
  return Boolean(basic && basic.length % 4 === 0 && /[A-Z0-9+/=]/.test(basic));
}

function validateRenderedPrivacy(spec: SalesforceDiagramSpec, errors: ValidationFinding[]): void {
  const rendered: Array<{ path: string; value: string | undefined }> = [
    { path: "title", value: spec.title },
    { path: "scope", value: spec.scope },
    { path: "purpose", value: spec.purpose },
    ...(spec.grounding.mode === "org"
      ? [{ path: "grounding.display_label", value: spec.grounding.display_label }]
      : []),
    ...spec.grounding.sources.map((source, index) => ({
      path: `grounding.sources[${index}].label`,
      value: source.label,
    })),
  ];
  if (spec.family === "data_model") {
    spec.objects.forEach((object, index) => {
      rendered.push(
        { path: `objects[${index}].label`, value: object.label },
        { path: `objects[${index}].api_name`, value: object.api_name },
        { path: `objects[${index}].observations.owd`, value: object.observations?.owd },
      );
      object.key_fields?.forEach((value, field) =>
        rendered.push({ path: `objects[${index}].key_fields[${field}]`, value }),
      );
      object.observations?.record_types?.forEach((value, recordType) =>
        rendered.push({
          path: `objects[${index}].observations.record_types[${recordType}]`,
          value,
        }),
      );
    });
    spec.relationships.forEach((relationship, index) =>
      rendered.push(
        { path: `relationships[${index}].field_api_name`, value: relationship.field_api_name },
        { path: `relationships[${index}].from_label`, value: relationship.from_label },
        { path: `relationships[${index}].to_label`, value: relationship.to_label },
      ),
    );
  } else if (spec.family === "architecture") {
    spec.systems.forEach((system, index) =>
      rendered.push(
        { path: `systems[${index}].label`, value: system.label },
        { path: `systems[${index}].responsibility`, value: system.responsibility },
        { path: `systems[${index}].boundary`, value: system.boundary },
      ),
    );
    spec.connections.forEach((connection, index) =>
      rendered.push({ path: `connections[${index}].label`, value: connection.label }),
    );
  } else {
    spec.participants.forEach((participant, index) =>
      rendered.push({ path: `participants[${index}].label`, value: participant.label }),
    );
    spec.interactions.forEach((interaction, index) =>
      rendered.push({ path: `interactions[${index}].label`, value: interaction.label }),
    );
  }
  for (const item of rendered) errors.push(...validateRenderedText(item.value, item.path));
}

function uniqueIds(
  items: Array<{ id: string }>,
  collection: string,
  errors: ValidationFinding[],
): Set<string> {
  const ids = new Set<string>();
  items.forEach((item, index) =>
    validateUniqueId(item.id, ids, `${collection}[${index}].id`, errors),
  );
  return ids;
}

function validateUniqueId(
  id: string,
  ids: Set<string>,
  path: string,
  errors: ValidationFinding[],
): void {
  if (ids.has(id)) errors.push({ code: "duplicate_id", message: `Duplicate id '${id}'.`, path });
  ids.add(id);
}

function validateEndpoint(
  value: string,
  ids: Set<string>,
  path: string,
  errors: ValidationFinding[],
): void {
  if (!ids.has(value)) {
    errors.push({
      code: "dangling_endpoint",
      message: `Endpoint '${value}' does not reference a declared node.`,
      path,
    });
  }
}

function validateEvidence(
  evidence: string[],
  sourceIds: Set<string>,
  path: string,
  errors: ValidationFinding[],
): void {
  for (const sourceId of evidence) {
    if (!sourceIds.has(sourceId)) {
      errors.push({
        code: "unknown_evidence_source",
        message: `Unknown evidence source '${sourceId}'.`,
        path,
      });
    }
  }
}

function enforceBudget(
  family: DiagramFamily,
  nodes: number,
  edges: number,
  errors: ValidationFinding[],
  warnings: ValidationFinding[],
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
  if (budget && (nodes > budget.nodes || edges > budget.edges)) {
    warnings.push({
      code: "single_page_density_warning",
      message: `${nodes} nodes and ${edges} connections exceed the comfortable ${family} reading budget of ${budget.nodes} nodes and ${budget.edges} connections; the page still renders deterministically.`,
    });
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

function pointerToPath(pointer: string): string {
  if (!pointer) return "";
  const parts = pointer
    .split("/")
    .slice(1)
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let result = "";
  for (const part of parts) {
    result += /^\d+$/.test(part) ? `[${part}]` : `${result ? "." : ""}${part}`;
  }
  return result;
}

function joinPath(base: string, field: string): string {
  return base ? `${base}.${field}` : field;
}

function lastPathSegment(path: string): string | undefined {
  return path.match(/(?:^|\.)([^.[\]]+)(?:\[\d+\])?$/)?.[1];
}

function uniqueFindings(findings: ValidationFinding[]): ValidationFinding[] {
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.code}|${finding.path ?? ""}|${finding.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
