/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { validateDiagramSpec } from "../lib/spec-validation.ts";
import type {
  ArchitectureSpec,
  DataModelSpec,
  SalesforceDiagramSpec,
  SequenceSpec,
} from "../lib/types.ts";

function fixture(name: string): SalesforceDiagramSpec {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"),
  ) as unknown as SalesforceDiagramSpec;
}

function dataModelFixture(): DataModelSpec {
  const spec = fixture("data-model");
  if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
  return spec;
}

function architectureFixture(): ArchitectureSpec {
  const spec = fixture("architecture");
  if (spec.family !== "architecture") throw new Error("Expected architecture fixture.");
  return spec;
}

function sequenceFixture(): SequenceSpec {
  const spec = fixture("sequence");
  if (spec.family !== "sequence") throw new Error("Expected sequence fixture.");
  return spec;
}

function mutable(value: object): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

describe("Salesforce Diagram Spec validation", () => {
  it.each(["data-model", "architecture", "sequence"])("accepts the grounded %s fixture", (name) => {
    const spec = fixture(name);
    const result = validateDiagramSpec(spec, spec.family);
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects family/action mismatches", () => {
    const result = validateDiagramSpec(fixture("data-model"), "architecture");
    expect(result.errors.map((error) => error.code)).toContain("family_action_mismatch");
  });

  it("rejects dangling endpoints and duplicate semantic ids", () => {
    const spec = dataModelFixture();
    const first = spec.objects[0];
    const second = spec.objects[1];
    if (!first || !second) throw new Error("Expected at least two data-model objects.");
    second.id = first.id;
    spec.relationships[0].to = "missing";
    const result = validateDiagramSpec(spec, "data_model");
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["duplicate_id", "dangling_endpoint"]),
    );
  });

  it("requires official Salesforce URLs for reference grounding", () => {
    const spec = architectureFixture();
    const source = spec.grounding.sources[0];
    if (!source) throw new Error("Expected an architecture source.");
    source.url = "https://example.test/private-note";
    const result = validateDiagramSpec(spec, "architecture");
    expect(result.errors.map((error) => error.code)).toContain("reference_requires_salesforce_url");
  });

  it("rejects private identity/auth fields while allowing target_org execution provenance", () => {
    const spec = sequenceFixture();
    spec.grounding = {
      mode: "org",
      as_of: "2026-07-25T12:00:00Z",
      display_label: "Authenticated sandbox",
      target_org: "local-alias",
      sources: [{ id: "schema", label: "Describe", kind: "org_describe" }],
    };
    spec.participants.forEach((item) => (item.evidence = ["schema"]));
    spec.interactions.forEach((item) => (item.evidence = ["schema"]));
    expect(validateDiagramSpec(spec, "sequence").ok).toBe(true);
    mutable(spec.grounding).username = "person@example.test";
    const rejected = validateDiagramSpec(spec, "sequence");
    expect(rejected.errors.map((error) => error.code)).toContain("private_identity_field");
  });

  it("requires an explicit org alias and live org evidence for org grounding", () => {
    const spec = sequenceFixture();
    spec.grounding = {
      mode: "org",
      as_of: "2026-07-25T12:00:00Z",
      display_label: "Authenticated sandbox",
      sources: [{ id: "docs", label: "Docs", kind: "official_doc" }],
    };
    spec.participants.forEach((item) => (item.evidence = ["docs"]));
    spec.interactions.forEach((item) => (item.evidence = ["docs"]));
    const result = validateDiagramSpec(spec, "sequence");
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["explicit_org_required", "org_evidence_required"]),
    );
  });

  it("validates optional structures and architecture discriminants", () => {
    const spec = architectureFixture();
    const firstSystem = spec.systems[0];
    if (!firstSystem) throw new Error("Expected at least one architecture system.");
    mutable(firstSystem).kind = "mystery";
    mutable(firstSystem).product_mark = "unapproved_mark";
    const result = validateDiagramSpec(spec, "architecture");
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["invalid_system_kind", "invalid_product_mark"]),
    );

    const data = dataModelFixture();
    const firstObject = data.objects[0];
    if (!firstObject) throw new Error("Expected at least one data-model object.");
    mutable(firstObject).key_fields = "Name";
    mutable(firstObject).observations = { owd: 42, record_types: ["Valid", 7] };
    const dataResult = validateDiagramSpec(data, "data_model");
    expect(dataResult.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining(["invalid_string_array", "invalid_owd"]),
    );
  });

  it("requires a valid ISO observation time", () => {
    const spec = dataModelFixture();
    spec.grounding.as_of = "not-a-date";
    expect(validateDiagramSpec(spec, "data_model").errors.map((error) => error.code)).toContain(
      "invalid_as_of",
    );
  });

  it("allows standard objects to use deterministic verified icon inference", () => {
    const spec = dataModelFixture();
    const firstObject = spec.objects[0];
    if (!firstObject) throw new Error("Expected at least one data-model object.");
    delete firstObject.icon;
    expect(validateDiagramSpec(spec, "data_model").ok).toBe(true);
  });

  it("rejects models beyond the bounded official-gallery envelope", () => {
    const spec = dataModelFixture();
    const template = spec.objects[0];
    if (!template) throw new Error("Expected at least one data-model object.");
    spec.objects = Array.from({ length: 161 }, (_, index) => ({
      ...template,
      id: `object-${index}`,
      api_name: `Object${index}`,
    }));
    const result = validateDiagramSpec(spec, "data_model");
    expect(result.errors.map((error) => error.code)).toContain("single_page_density_exceeded");
  });

  it("rejects a hub whose terminal demand exceeds one readable card side", () => {
    const spec = dataModelFixture();
    const hub = spec.objects[0];
    if (!hub) throw new Error("Expected at least one data-model object.");
    const leaves = Array.from({ length: 37 }, (_, index) => ({
      ...structuredClone(hub),
      id: `degree-leaf-${index}`,
      api_name: `DegreeLeaf${index}`,
    }));
    spec.objects = [hub, ...leaves];
    spec.relationships = leaves.map((leaf, index) => ({
      id: `degree-edge-${index}`,
      from: hub.id,
      to: leaf.id,
      type: "lookup" as const,
      from_cardinality: "one" as const,
      to_cardinality: "many" as const,
      evidence: [...hub.evidence],
    }));
    expect(validateDiagramSpec(spec, "data_model").errors.map((error) => error.code)).toContain(
      "node_degree_exceeded",
    );
  });

  it("warns but still renders poster-scale data models above the reading budget", () => {
    const spec = dataModelFixture();
    const template = spec.objects[0];
    if (!template) throw new Error("Expected at least one data-model object.");
    spec.objects = [
      ...spec.objects,
      ...Array.from({ length: 35 }, (_, index) => ({
        ...template,
        id: `object-${index}`,
        api_name: `Object${index}`,
      })),
    ];
    const result = validateDiagramSpec(spec, "data_model");
    expect(result.ok).toBe(true);
    expect(result.warnings.map((warning) => warning.code)).toContain("single_page_density_warning");
  });

  it("accepts conceptual entities without API names and empty relationship arrays", () => {
    const spec = dataModelFixture();
    const firstObject = spec.objects[0];
    if (!firstObject) throw new Error("Expected at least one data-model object.");
    delete firstObject.api_name;
    firstObject.entity_kind = "conceptual";
    firstObject.family = "special";
    spec.objects = [firstObject];
    spec.relationships = [];
    expect(validateDiagramSpec(spec, "data_model").ok).toBe(true);
  });

  it("validates complete source layouts and precise relationship anchors", () => {
    const spec = dataModelFixture();
    spec.layout_mode = "source";
    for (const [index, object] of spec.objects.entries()) {
      object.source_position = { x: index * 400, y: index * 200, w: 320, h: 180 };
    }
    const relationship = spec.relationships[0];
    if (!relationship) throw new Error("Expected a relationship fixture.");
    relationship.from_anchor = { side: "right", fraction: 0.25 };
    relationship.to_anchor = { side: "left", fraction: 0.75 };
    expect(validateDiagramSpec(spec, "data_model").ok).toBe(true);

    delete spec.objects[0]!.source_position;
    relationship.from_anchor.fraction = 1.5;
    delete relationship.to_anchor;
    const invalid = validateDiagramSpec(spec, "data_model");
    expect(invalid.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "source_position_required",
        "invalid_relationship_anchor",
        "relationship_anchor_pair_required",
      ]),
    );
  });

  it("accepts a spec passed as exact JSON text", () => {
    const spec = dataModelFixture();
    const result = validateDiagramSpec(JSON.stringify(spec), "data_model");
    expect(result.ok).toBe(true);
    expect(result.spec?.title).toBe(spec.title);
  });

  it("rejects a string that is not a JSON spec with actionable guidance", () => {
    const result = validateDiagramSpec("draw me an ERD", "data_model");
    expect(result.ok).toBe(false);
    expect(result.errors[0]?.message).toMatch(/not valid JSON/);
  });

  it("validates explicit sequence activations without inferring processing duration", () => {
    const spec = sequenceFixture();
    spec.activations = [];
    expect(validateDiagramSpec(spec, "sequence").ok).toBe(true);
    spec.activations = [
      {
        id: "service-work",
        participant: "service",
        start_step: 1,
        end_step: 3,
        evidence: ["service-overview"],
      },
    ];
    expect(validateDiagramSpec(spec, "sequence").ok).toBe(true);

    spec.activations[0]!.start_step = 3;
    spec.activations[0]!.end_step = 1;
    const rejected = validateDiagramSpec(spec, "sequence");
    expect(rejected.errors.map((error) => error.code)).toContain("reversed_activation");

    const overlap = sequenceFixture();
    overlap.activations = [
      {
        id: "first",
        participant: "service",
        start_step: 1,
        end_step: 2,
        evidence: ["service-overview"],
      },
      {
        id: "second",
        participant: "service",
        start_step: 2,
        end_step: 3,
        evidence: ["service-overview"],
      },
    ];
    expect(validateDiagramSpec(overlap, "sequence").errors.map((error) => error.code)).toContain(
      "overlapping_activation",
    );
  });

  it("rejects unsupported sequence loops and over-wide participant sets", () => {
    const selfInteraction = sequenceFixture();
    selfInteraction.interactions[0]!.to = selfInteraction.interactions[0]!.from;
    expect(
      validateDiagramSpec(selfInteraction, "sequence").errors.map((error) => error.code),
    ).toContain("unsupported_self_interaction");

    const wide = sequenceFixture();
    const template = wide.participants[0]!;
    wide.participants.push(
      ...Array.from({ length: 6 }, (_, index) => ({
        ...template,
        id: `extra-${index}`,
        label: `Extra participant ${index}`,
      })),
    );
    expect(validateDiagramSpec(wide, "sequence").errors.map((error) => error.code)).toContain(
      "single_page_density_exceeded",
    );
  });
});
