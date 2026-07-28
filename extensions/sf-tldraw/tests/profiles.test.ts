/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanvasProgram } from "../lib/canvas-program.ts";
import { DATA_MODEL_CARD, dataModelCardSize, layoutDataModel } from "../lib/layout.ts";
import { compileProfile } from "../lib/profiles.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import type { SalesforceDiagramSpec } from "../lib/types.ts";

function fixture(name: string): SalesforceDiagramSpec {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, "fixtures", `${name}.json`), "utf8"),
  );
}

describe("deterministic Salesforce profiles", () => {
  it.each(["data-model", "architecture", "sequence", "oauth-sequence"])(
    "compiles %s deterministically",
    (name) => {
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
      expect(
        first.nodes.every((node) => Number.isInteger(node.x) && Number.isInteger(node.y)),
      ).toBe(true);
      expect(first.assets.every((asset) => asset.src.startsWith("data:image/"))).toBe(true);
    },
  );

  it("uses unchanged icon assets on separate vivid tiles", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    // Prove the renderer recovers authentic SLDS colors without requiring the spec to
    // repeat presentation hex values for every standard object.
    for (const object of spec.objects) delete object.icon;
    const payload = compileProfile(spec, {
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
        .every((asset) => asset.attribution?.license === "BSD-3-Clause"),
    ).toBe(true);
    expect(payload.nodes.map((node) => node.apiName)).toEqual([
      "Account",
      "Contact",
      "Case",
      "CaseComment",
      "EmailMessage",
    ]);
    const tileNames = payload.nodes.map(
      (node) => payload.assets.find((asset) => asset.id === node.iconTileAssetId)?.name,
    );
    expect(tileNames).toEqual([
      "tile-#5867e8.svg",
      "tile-#9602c7.svg",
      "tile-#ff538a.svg",
      "tile-#ff5d2d.svg",
      "tile-#939393.svg",
    ]);
  });

  it("compiles full physical optionality to anchored vector assets", () => {
    const payload = compileProfile(fixture("data-model"), {
      renderMode: "preserve",
      preferences: { ...DEFAULT_TLDRAW_PREFERENCES, cardinalityDetail: "full" },
    });
    const optional = payload.assets.find(
      (asset) => asset.name === "cardinality-zero_or_many-neutral.svg",
    );
    expect(optional).toMatchObject({ width: 48, height: 32, anchor: { x: 48, y: 16 } });
    expect(payload.edges.find((edge) => edge.id === "contact-cases")?.toMarkerAssetId).toBe(
      optional?.id,
    );
    // Master-detail terminals get their own red-toned marker assets.
    expect(
      payload.assets.some((asset) => asset.name === "cardinality-many-master_detail.svg"),
    ).toBe(true);
  });

  it("sizes data-model cards from their declared label and optional API name", () => {
    const conceptual = dataModelCardSize({ label: "Party" });
    const short = dataModelCardSize({ label: "Account", api_name: "Account" });
    const long = dataModelCardSize({
      label: "Work Type Group Member",
      api_name: "WorkTypeGroupMember",
    });
    // A longer API name must widen the card, not wrap mid-word inside a fixed one.
    expect(long.w).toBeGreaterThan(short.w);
    expect(long.h).toBeGreaterThanOrEqual(short.h);
    expect(short.w).toBeGreaterThanOrEqual(DATA_MODEL_CARD.textX + DATA_MODEL_CARD.padRight);
    expect(conceptual.h).toBeLessThanOrEqual(short.h);
  });

  it("elongates high-degree hubs so final connection sides retain marker pitch", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const account = spec.objects[0];
    if (!account) throw new Error("Expected an Account fixture object.");
    const leaves = Array.from({ length: 20 }, (_, index) => ({
      ...structuredClone(account),
      id: `leaf-${index}`,
      label: `Leaf ${index}`,
      api_name: `Leaf${index}`,
    }));
    spec.objects = [account, ...leaves];
    spec.relationships = leaves.map((leaf, index) => ({
      id: `hub-leaf-${index}`,
      from: account.id,
      to: leaf.id,
      type: "lookup" as const,
      from_cardinality: "one" as const,
      to_cardinality: "many" as const,
      evidence: [...account.evidence],
    }));
    const base = dataModelCardSize(account);
    const hub = layoutDataModel(spec).find((node) => node.id === account.id);
    expect(hub).toBeDefined();
    expect(Math.max(hub?.w ?? 0, hub?.h ?? 0)).toBeGreaterThanOrEqual(1_200);
    expect((hub?.w ?? 0) > base.w || (hub?.h ?? 0) > base.h).toBe(true);
  });

  it("packs disconnected components into a bounded landscape poster", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const template = spec.objects[0];
    if (!template) throw new Error("Expected a fixture object.");
    spec.objects = Array.from({ length: 18 }, (_, index) => ({
      ...structuredClone(template),
      id: `island-${index}`,
      label: `Island ${index}`,
      api_name: `Island${index}`,
    }));
    spec.relationships = [
      [0, 1],
      [1, 2],
      [3, 4],
      [4, 5],
    ].map(([from, to], index) => ({
      id: `component-edge-${index}`,
      from: `island-${from}`,
      to: `island-${to}`,
      type: "lookup" as const,
      from_cardinality: "one" as const,
      to_cardinality: "many" as const,
      evidence: [...template.evidence],
    }));
    const nodes = layoutDataModel(spec);
    const width =
      Math.max(...nodes.map((node) => node.x + node.w)) - Math.min(...nodes.map((node) => node.x));
    const height =
      Math.max(...nodes.map((node) => node.y + node.h)) - Math.min(...nodes.map((node) => node.y));
    expect(new Set(nodes.map((node) => node.x)).size).toBeGreaterThan(3);
    expect(Math.max(width / height, height / width)).toBeLessThan(4);
    for (let left = 0; left < nodes.length; left++) {
      for (let right = left + 1; right < nodes.length; right++) {
        const a = nodes[left];
        const b = nodes[right];
        if (!a || !b) continue;
        const overlapX = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const overlapY = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        expect(overlapX > 0 && overlapY > 0, `${a.id}/${b.id}`).toBe(false);
      }
    }
  });

  it("reserves additional side capacity for dense automatic-route hubs", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const hub = structuredClone(spec.objects[0]);
    if (!hub) throw new Error("Expected a fixture hub.");
    hub.id = "hub";
    const leaves = Array.from({ length: 10 }, (_, index) => ({
      ...structuredClone(hub),
      id: `alternate-leaf-${index}`,
      label: `Alternate Leaf ${index}`,
      api_name: `AlternateLeaf${index}`,
    }));
    spec.objects = [hub, ...leaves];
    spec.relationships = leaves.map((leaf, index) => ({
      id: `alternate-edge-${index}`,
      from: hub.id,
      to: leaf.id,
      type: "lookup" as const,
      from_cardinality: "one" as const,
      to_cardinality: "many" as const,
      evidence: [...hub.evidence],
    }));
    const positionedHub = layoutDataModel(spec).find((node) => node.id === hub.id);
    expect(Math.max(positionedHub?.w ?? 0, positionedHub?.h ?? 0)).toBeGreaterThan(330);
  });

  it("reserves both exterior sides for recursive relationship terminals", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const node = structuredClone(spec.objects[0]);
    if (!node) throw new Error("Expected a fixture object.");
    spec.objects = [node];
    spec.relationships = Array.from({ length: 2 }, (_, index) => ({
      id: `self-${index}`,
      from: node.id,
      to: node.id,
      type: "lookup" as const,
      from_cardinality: "one" as const,
      to_cardinality: "many" as const,
      evidence: [...node.evidence],
    }));
    const positioned = layoutDataModel(spec)[0];
    expect(positioned?.h).toBeGreaterThanOrEqual(200);
  });

  it("carries relationship kind and optional end semantics on the connector", () => {
    const spec = fixture("data-model");
    if (spec.family !== "data_model") throw new Error("Expected data-model fixture.");
    const relationship = spec.relationships[0];
    if (!relationship) throw new Error("Expected at least one relationship.");
    relationship.type = "master_detail";
    relationship.field_api_name = "AccountId";
    relationship.from_label = "child of";
    relationship.to_label = "parent of";
    const payload = compileProfile(spec, {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    const edge = payload.edges.find((item) => item.id === relationship.id);
    expect(edge?.label).toBe("");
    expect(edge?.relationshipType).toBe("master_detail");
    expect(edge).toMatchObject({
      fieldApiName: "AccountId",
      fromLabel: "child of",
      toLabel: "parent of",
    });
    const neutral = payload.assets.find(
      (asset) => asset.name === "cardinality-many-neutral.svg",
    )?.id;
    expect(edge?.toMarkerAssetId).not.toBe(neutral);
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
    expect(program).toContain("Math.atan2(g.startInward.y,g.startInward.x)");
    expect(program).toContain("terminalGeometry");
    expect(program).toContain("semantic_binding_mismatch");
    expect(program).toContain("sequence_geometry_mismatch");
    expect(program).not.toContain("anchor.x-16");
  });

  it("styles data-model connectors by relationship kind and routes them orthogonally", () => {
    const program = buildCanvasProgram(
      compileProfile(fixture("data-model"), {
        renderMode: "preserve",
        preferences: DEFAULT_TLDRAW_PREFERENCES,
      }),
    );
    expect(program).toContain("const arrowKind=FAMILY==='data_model'?'elbow':'arc'");
    expect(program).toContain("isMasterDetail?'solid':'dotted'");
    expect(program).toContain("isMasterDetail?'red':'grey'");
    // Cards must be re-fronted after connectors exist, or bound arrows paint over them.
    expect(program).toContain("editor.bringToFront(groupIds)");
    // Precise side anchors keep the elbow corridor out of unrelated card interiors.
    expect(program).toContain("normalizedAnchor:anchorFor(side,fraction)");
    expect(program).toContain("card_content_overflow");
    expect(program).toContain("routeObstructions");
    expect(program).toContain("routeTraffic");
    expect(program).toContain("renderSelfEdge");
    expect(program).toContain("outsidePoint");
    expect(program).toContain("marker_overlap");
    expect(program).toContain("the document may have reached its page limit");
    expect(program).toContain("tldraw did not select the requested page");
    // White/transparent-style cards have an opaque backing so routes never show through.
    expect(program).toContain("card-background");
    expect(program).toContain("payload.preferences.cardFill==='family'");
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

  it("uses content-sized lanes and ordered message rows for sequences", () => {
    const payload = compileProfile(fixture("sequence"), {
      renderMode: "preserve",
      preferences: DEFAULT_TLDRAW_PREFERENCES,
    });
    expect(payload.nodes.map((node) => node.id)).toEqual(["user", "service", "integration"]);
    expect(payload.nodes.map((node) => node.y)).toEqual([290, 290, 290]);
    expect(payload.sequenceInteractions?.map((interaction) => interaction.y)).toEqual([
      520, 638, 756,
    ]);
    expect(payload.sequenceInteractions?.map((interaction) => interaction.label)).toEqual([
      "Create support request",
      "Publish update",
      "Return reference number",
    ]);
  });
});
