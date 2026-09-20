/* SPDX-License-Identifier: Apache-2.0 */

import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlowSource } from "../lib/analyzer.ts";

const fixture = (name: string) =>
  readFile(path.join(import.meta.dirname, "fixtures", name), "utf8");

describe("SF Flow local diagnostics", () => {
  it.each([
    ["Screen_Example.flow-meta.xml", "screen"],
    ["Autolaunched_Example.flow-meta.xml", "autolaunched"],
    ["Record_Triggered_Example.flow-meta.xml", "record-triggered"],
    ["Schedule_Triggered_Example.flow-meta.xml", "schedule-triggered"],
    ["Platform_Event_Triggered_Example.flow-meta.xml", "platform-event-triggered"],
  ])("recognizes a valid %s fixture", async (name, family) => {
    const result = analyzeFlowSource(await fixture(name), name);

    expect(result.status).not.toBe("failed");
    expect(result.family).toBe(family);
    expect(result.findings.filter((finding) => finding.severity === "high")).toEqual([]);
    expect(result.coverage.ran.length).toBeGreaterThan(0);
  });

  it("reports deterministic graph, reference, loop, fault, and trigger findings", async () => {
    const result = analyzeFlowSource(await fixture("broken.flow"), "broken.flow");
    const ids = new Set(result.findings.map((finding) => finding.rule_id));

    expect([...ids]).toEqual(
      expect.arrayContaining([
        "duplicate-name",
        "dangling-target",
        "unresolved-reference",
        "dml-in-loop",
        "missing-fault-path",
        "element-not-allowed-before-save",
      ]),
    );
    expect(result.findings.every((finding) => finding.line > 0 && finding.column > 0)).toBe(true);
  });

  it("reports a Flow that has no executable path from Start", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><description>Empty Flow fixture.</description><label>Empty Flow</label><processType>AutoLaunchedFlow</processType><start/><status>Draft</status></Flow>`,
      "empty.flow-meta.xml",
    );

    expect(result.findings).toContainEqual(
      expect.objectContaining({
        rule_id: "missing-start-reference",
        severity: "high",
      }),
    );
  });

  it("skips specialized record-context semantics instead of guessing", () => {
    const result = analyzeFlowSource(
      `<?xml version="1.0"?><Flow><apiVersion>68.0</apiVersion><assignments><name>Use_Record</name><assignmentItems><assignToReference>$Record.Name</assignToReference><operator>Assign</operator><value><stringValue>x</stringValue></value></assignmentItems></assignments><label>Specialized</label><processType>RoutingFlow</processType><start/><status>Draft</status></Flow>`,
      "specialized.flow-meta.xml",
    );

    expect(result.findings.some((finding) => finding.rule_id === "record-context")).toBe(false);
    expect(result.coverage.skipped).toContainEqual({
      id: "record-context",
      reason: "specialized Flow record context is not inferred",
    });
  });

  it("fails closed on malformed XML and discloses skipped coverage", () => {
    const result = analyzeFlowSource("<Flow><label>Broken</Flow>", "broken.flow");

    expect(result.status).toBe("failed");
    expect(result.findings.some((finding) => finding.rule_id === "xml-syntax")).toBe(true);
    expect(result.coverage.skipped.length).toBeGreaterThan(0);
  });
});
