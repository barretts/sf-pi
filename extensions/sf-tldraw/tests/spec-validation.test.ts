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

  it("requires verified explicit icons for standard objects", () => {
    const spec = dataModelFixture();
    const firstObject = spec.objects[0];
    if (!firstObject) throw new Error("Expected at least one data-model object.");
    delete firstObject.icon;
    const result = validateDiagramSpec(spec, "data_model");
    expect(result.errors.map((error) => error.code)).toContain("standard_icon_required");
  });

  it("rejects unreadably dense single-page specs", () => {
    const spec = dataModelFixture();
    const template = spec.objects[0];
    if (!template) throw new Error("Expected at least one data-model object.");
    spec.objects = Array.from({ length: 19 }, (_, index) => ({
      ...template,
      id: `object-${index}`,
      api_name: `Object${index}`,
    }));
    spec.relationships = [];
    const result = validateDiagramSpec(spec, "data_model");
    expect(result.errors.map((error) => error.code)).toContain("single_page_density_exceeded");
  });
});
