/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";
import { buildMermaidTopology, renderMermaidTopology } from "../lib/topology.ts";

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("SF Flow Mermaid topology", () => {
  it("projects normal and fault connectors into bounded Mermaid", async () => {
    const result = analyzeFlowSource(await fixture("broken.flow"), "broken.flow");
    const topology = buildMermaidTopology(result.model!, 20);

    expect(topology.source).toContain("flowchart TD");
    expect(topology.source).toContain("-->");
    expect(topology.nodes).toBeGreaterThan(0);
    expect(topology.truncated).toBe(false);
  });

  it("renders Unicode art when it fits and falls back when narrow", async () => {
    const result = analyzeFlowSource(
      await fixture("Record_Triggered_Example.flow-meta.xml"),
      "Record_Triggered_Example.flow-meta.xml",
    );
    const topology = buildMermaidTopology(result.model!, 20);
    const wide = renderMermaidTopology(topology.source, 120);
    const narrow = renderMermaidTopology(topology.source, 12);

    expect(wide.fallback).toBe(false);
    expect(wide.lines.length).toBeGreaterThan(1);
    expect(narrow.fallback).toBe(true);
  });
});
