/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCanvasProgram } from "../lib/canvas-program.ts";
import { compileProfile } from "../lib/profiles.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import type { SequenceSpec } from "../lib/types.ts";

function sequenceFixture(): SequenceSpec {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, "fixtures", "sequence.json"), "utf8"),
  ) as SequenceSpec;
}

function compile(spec: SequenceSpec) {
  return compileProfile(spec, {
    renderMode: "preserve",
    preferences: DEFAULT_TLDRAW_PREFERENCES,
  });
}

describe("deterministic sequence visual grammar", () => {
  it("uses readable compact lanes and omits generated participant icons", () => {
    const spec = sequenceFixture();
    spec.participants.forEach((participant) => delete participant.icon);

    const payload = compile(spec);

    expect(payload.nodes.every((node) => node.y === 290 && node.h === 96)).toBe(true);
    expect(payload.nodes.every((node) => node.w >= 260 && node.w <= 360)).toBe(true);
    for (let index = 1; index < payload.nodes.length; index++) {
      const previous = payload.nodes[index - 1]!;
      const current = payload.nodes[index]!;
      expect(current.x - (previous.x + previous.w)).toBeGreaterThanOrEqual(140);
    }
    expect(payload.nodes.every((node) => !node.iconAssetId && !node.iconTileAssetId)).toBe(true);
  });

  it("compacts seven- and eight-lane diagrams without shrinking participant cards", () => {
    const spec = sequenceFixture();
    const template = spec.participants[0]!;
    spec.participants.push(
      ...Array.from({ length: 4 }, (_, index) => ({
        ...template,
        id: `extra-${index}`,
        label: `Participant ${index}`,
        icon: undefined,
      })),
    );

    const payload = compile(spec);

    for (let index = 1; index < payload.nodes.length; index++) {
      const previous = payload.nodes[index - 1]!;
      const current = payload.nodes[index]!;
      expect(current.x - (previous.x + previous.w)).toBe(110);
    }
    expect(payload.nodes.every((node) => node.w >= 260)).toBe(true);
  });

  it("keeps step numbers separate from labels and adds phase breathing room", () => {
    const spec = sequenceFixture();
    spec.interactions = [
      spec.interactions[0]!,
      { ...spec.interactions[2]!, step: 2 },
      { ...spec.interactions[1]!, step: 3, kind: "request" },
    ];

    const payload = compile(spec);

    expect(payload.sequenceInteractions?.map((interaction) => interaction.label)).toEqual([
      "Create support request",
      "Return reference number",
      "Publish update",
    ]);
    expect(payload.sequenceInteractions?.map((interaction) => interaction.y)).toEqual([
      520, 638, 808,
    ]);
  });

  it("compiles only explicitly grounded activation intervals", () => {
    const spec = sequenceFixture();
    spec.activations = [
      {
        id: "service-work",
        participant: "service",
        start_step: 1,
        end_step: 3,
        evidence: ["service-overview"],
      },
      {
        id: "integration-work",
        participant: "integration",
        start_step: 2,
        end_step: 2,
        evidence: ["service-overview"],
      },
    ];

    const payload = compile(spec);

    expect(payload.sequenceActivations).toEqual([
      { id: "service-work", participantId: "service", y: 492, h: 292 },
      { id: "integration-work", participantId: "integration", y: 610, h: 56 },
    ]);
    expect(compile(sequenceFixture()).sequenceActivations).toEqual([]);
  });

  it("renders a sequence-specific plain-text message and activation program", () => {
    const program = buildCanvasProgram(compile(sequenceFixture()));

    expect(program).toContain("payload.sequenceActivations??[]");
    expect(program).toContain("String(edge.step).padStart(2,'0')");
    expect(program).toContain("sequenceMessageWidth");
    expect(program).toContain("sequence-activation");
    expect(program).toContain("message-label-background");
    expect(program).toContain("message-backing:");
    expect(program).toContain("message-lifeline:");
    expect(program).toContain("message-activation:");
    expect(program).toContain("current.type!==shape.type");
  });
});
