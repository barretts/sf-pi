/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanvasProgram } from "../lib/canvas-program.ts";
import { compileProfile } from "../lib/profiles.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import type { SalesforceDiagramSpec } from "../lib/types.ts";

function fixture(name: string): SalesforceDiagramSpec {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"),
  );
}

describe("deterministic Salesforce profiles", () => {
  it.each(["data-model", "architecture", "sequence"])("compiles %s deterministically", (name) => {
    const spec = fixture(name);
    const first = compileProfile(spec, {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    const second = compileProfile(spec, {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    expect(second).toEqual(first);
    expect(first.nodes.every((node) => Number.isInteger(node.x) && Number.isInteger(node.y))).toBe(
      true,
    );
    expect(first.assets.every((asset) => asset.src.startsWith("data:image/"))).toBe(true);
  });

  it("uses unchanged icon assets on separate vivid tiles", () => {
    const payload = compileProfile(fixture("data-model"), {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    expect(
      payload.nodes.every(
        (node) =>
          node.iconAssetId && node.iconTileAssetId && node.iconAssetId !== node.iconTileAssetId,
      ),
    ).toBe(true);
    expect(
      payload.assets
        .filter((asset) => asset.name.endsWith(".png"))
        .every((asset) => asset.attribution?.license === "CC-BY-ND-4.0"),
    ).toBe(true);
    expect(payload.nodes.map((node) => node.apiName)).toEqual([
      "Account",
      "Contact",
      "Case",
      "CaseComment",
      "EmailMessage",
    ]);
  });

  it("compiles full physical optionality to anchored vector assets", () => {
    const payload = compileProfile(fixture("data-model"), {
      renderMode: "preserve",
      preferences: { ...DEFAULT_TLDRAW_PREFERENCES, cardinalityDetail: "full" },
    });
    const optional = payload.assets.find((asset) => asset.name === "cardinality-zero_or_many.svg");
    expect(optional).toMatchObject({ width: 48, height: 32, anchor: { x: 48, y: 16 } });
    expect(payload.edges.find((edge) => edge.id === "contact-cases")?.toMarkerAssetId).toBe(
      optional?.id,
    );
  });

  it("emits transform-correct marker placement and verification", () => {
    const payload = compileProfile(fixture("data-model"), {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    const program = buildCanvasProgram(payload);
    expect(program).toContain("placeFromLocalAnchor");
    expect(program).toContain("const transform=editor.getShapePageTransform(id)");
    expect(program).toContain("actual=transform.applyToPoint(anchor)");
    expect(program).toContain("Math.atan2(sv.y,sv.x)+Math.PI");
    expect(program).toContain("semantic_binding_mismatch");
    expect(program).toContain("sequence_geometry_mismatch");
    expect(program).not.toContain("anchor.x-16");
  });

  it("keeps record types hidden by default", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const firstObject = spec.objects[0];
    if (!firstObject) throw new Error("Expected at least one data-model object.");
    firstObject.observations = { record_types: ["Primary", "Secondary"] };
    const payload = compileProfile(spec, {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    expect(payload.nodes[0]?.observations).not.toContain(expect.stringMatching(/^RT /));
  });

  it("uses fixed lanes and ordered message rows for sequences", () => {
    const payload = compileProfile(fixture("sequence"), {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    expect(payload.nodes.map((node) => node.id)).toEqual(["user", "service", "integration"]);
    expect(payload.nodes.map((node) => node.y)).toEqual([330, 330, 330]);
    expect(payload.sequenceInteractions?.map((interaction) => interaction.y)).toEqual([
      560, 690, 820,
    ]);
    expect(payload.sequenceInteractions?.map((interaction) => interaction.label)).toEqual([
      "1. Create support request",
      "2. Publish update",
      "3. Return reference number",
    ]);
  });
});
