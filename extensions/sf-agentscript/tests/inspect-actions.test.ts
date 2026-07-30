/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the new inspect actions: find_references and definition.
 *
 * Real SDK on a fixture file, no mocks. Confirms the AST walk picks up
 * `@<ns>.<prop>` usages and the NamedMap lookup pins the declaration site.
 */

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { renderTargetCheckSummary } from "../lib/authoring/actions/inspect.ts";
import { findDefinition, findReferences } from "../lib/inspect.ts";
import type { CheckActionTargetsResult } from "../lib/preflight.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-inspect-act-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

const FIXTURE = [
  "config:",
  '    agent_name: "Test_Bot"',
  '    description: "Demo"',
  "",
  "system:",
  "    instructions: |",
  "        Helpful agent.",
  "",
  "topic billing:",
  '    description: "Handle billing"',
  "",
  "topic faq:",
  '    description: "FAQ"',
  "",
  "start_agent main:",
  '    description: "entry"',
  "    transition to @topic.billing",
  "",
].join("\n");

async function fixture(): Promise<string> {
  const filePath = path.join(workDir, "bot.agent");
  await writeFile(filePath, FIXTURE, "utf8");
  return filePath;
}

describe("findReferences", () => {
  test("rejects malformed symbols", async () => {
    const filePath = await fixture();
    const result = await findReferences(filePath, "topic.billing"); // no leading @
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_symbol");
  });

  test("returns at least the declaration for a known topic", async () => {
    const filePath = await fixture();
    const result = await findReferences(filePath, "@topic.billing");
    expect(result.ok).toBe(true);
    expect(result.references?.length).toBeGreaterThan(0);
    const decl = result.references?.find((r) => r.is_declaration);
    expect(decl).toBeDefined();
    expect(decl?.line).toBeGreaterThan(0);
  });

  test("returns ok with empty list for an undeclared symbol", async () => {
    const filePath = await fixture();
    const result = await findReferences(filePath, "@actions.nonexistent");
    expect(result.ok).toBe(true);
    expect(result.references).toEqual([]);
    expect(result.total).toBe(0);
  });
});

describe("findDefinition", () => {
  test("finds the declaration line for a topic", async () => {
    const filePath = await fixture();
    const result = await findDefinition(filePath, "@topic.billing");
    expect(result.ok).toBe(true);
    expect(typeof result.line).toBe("number");
    expect(result.line).toBeGreaterThan(0);
    expect(result.file).toBe(filePath);
  });

  test("returns not_found for an undeclared symbol", async () => {
    const filePath = await fixture();
    const result = await findDefinition(filePath, "@topic.ghost");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found");
  });

  test("rejects unknown namespaces", async () => {
    const filePath = await fixture();
    const result = await findDefinition(filePath, "@outputs.foo");
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_symbol");
  });
});

describe("renderTargetCheckSummary", () => {
  test("shows a failed target even when it follows eight successful targets", () => {
    const targets = Array.from({ length: 10 }, (_, index) => ({
      name: index === 9 ? "failed_last" : `ok_${index}`,
      target: `flow://Target_${index}`,
      scheme: "flow",
      ref_name: `Target_${index}`,
      status: index === 9 ? ("missing" as const) : ("ok" as const),
      ...(index === 9 ? { detail: "Flow exists but its active contract does not match." } : {}),
    }));
    const result: CheckActionTargetsResult = {
      ok: false,
      targets,
      total: targets.length,
      resolved: 9,
      missing: 1,
      unverifiable: 0,
    };

    const summary = renderTargetCheckSummary(result).join("\n");

    expect(summary).toContain("1/10 action target checks failed");
    expect(summary).toContain("✗ failed_last → flow://Target_9");
    expect(summary).toContain("Flow exists but its active contract does not match.");
    expect(summary).not.toContain("✓ ok_7");
  });
});
