/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for mutate.ts — minimal structured mutations plus coordinate-fallback edits.
 *
 * Real SDK, real fixture file. We validate:
 *   - apply_quick_fix works end-to-end via SDK/LSP diagnostics.
 *   - set_field rewrites and upserts scalar fields.
 *   - rename updates declarations and references for supported symbols.
 *   - mutate refuses to touch a file with severity-1 parse errors.
 *   - unsupported broad insert/delete modes guide the agent to generic edit.
 */

import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { checkAgentScriptFile } from "../lib/diagnostics.ts";
import { applyMutation } from "../lib/mutate.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-mutate-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeAgent(name: string, source: string): Promise<string> {
  const filePath = path.join(workDir, name);
  await writeFile(filePath, source, "utf8");
  return filePath;
}

const FULL_FIXTURE = [
  "config:",
  '    agent_name: "Test_Bot"',
  '    description: "Demo"',
  "",
  "system:",
  "    instructions: |",
  "        old instructions",
  "",
  "topic billing:",
  '    description: "old billing description"',
  "",
  "topic faq:",
  '    description: "old faq description"',
  "",
  "start_agent main:",
  '    description: "entry"',
  "    transition to @topic.billing",
  "",
].join("\n");

const SEMANTIC_RENAME_FIXTURE = [
  "config:",
  '    agent_name: "Test_Bot"',
  '    agent_type: "AgentforceEmployeeAgent"',
  "",
  "subagent billing:",
  '    description: "Billing"',
  "",
  "subagent billing_help:",
  '    description: "A distinct helper"',
  "",
  "subagent helper_router:",
  '    description: "Routes to the distinct helper"',
  "    before_reasoning:",
  "        transition to @subagent.billing_help",
  "",
  "start_agent main:",
  '    description: "Mention @subagent.billing as prose"',
  "    # Keep @subagent.billing in this comment",
  "    before_reasoning:",
  "        transition to @subagent.billing",
  "    reasoning:",
  "        instructions: ->",
  "            | Tell the user about @subagent.billing without invoking it.",
  "",
].join("\n");

const TOPIC_CONVERSION_FIXTURE = SEMANTIC_RENAME_FIXTURE.replaceAll("subagent", "topic");

describe("applyMutation: apply_quick_fix", () => {
  const unusedVariableSource = [
    "config:",
    '    agent_name: "Quick_Fix_Bot"',
    "",
    "system:",
    '    instructions: "Help"',
    "",
    "variables:",
    '    unused: mutable string = "x"',
    '    used: mutable string = "y"',
    "",
    "start_agent main:",
    '    description: "Main"',
    "    reasoning:",
    "        instructions: |",
    "            Use {!@variables.used}.",
    "",
  ].join("\n");

  test("applies a source-bound diagnostic/action identity", async () => {
    const filePath = await writeAgent("identity.agent", unusedVariableSource);
    const compile = await checkAgentScriptFile(filePath);
    const fix = compile.quickFixes.find(
      (candidate) => candidate.diagnosticCode === "unused-variable",
    );
    expect(fix?.diagnosticId).toBeDefined();
    expect(fix?.actionId).toBeDefined();

    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      source_version: compile.sourceVersion,
      diagnostic_id: fix?.diagnosticId,
      action_id: fix?.actionId,
    });

    expect(result.ok).toBe(true);
    expect(await readFile(filePath, "utf8")).not.toContain("unused: mutable string");
  });

  test("refuses a stale source version without modifying the file", async () => {
    const filePath = await writeAgent("stale.agent", unusedVariableSource);
    const compile = await checkAgentScriptFile(filePath);
    const fix = compile.quickFixes.find(
      (candidate) => candidate.diagnosticCode === "unused-variable",
    );
    await writeFile(filePath, `${unusedVariableSource}\n`, "utf8");
    const before = await readFile(filePath, "utf8");

    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      source_version: compile.sourceVersion,
      diagnostic_id: fix?.diagnosticId,
      action_id: fix?.actionId,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("stale_source");
    expect(await readFile(filePath, "utf8")).toBe(before);
  });

  test("does not fall back to coordinates when an action identity is unknown", async () => {
    const filePath = await writeAgent("unknown-action.agent", unusedVariableSource);
    const compile = await checkAgentScriptFile(filePath);
    const fix = compile.quickFixes.find(
      (candidate) => candidate.diagnosticCode === "unused-variable",
    );

    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      source_version: compile.sourceVersion,
      diagnostic_id: fix?.diagnosticId,
      action_id: "act1:unknown",
      diagnostic_code: fix?.diagnosticCode,
      line: (fix?.diagnosticLine ?? 0) + 1,
      fix_index: 0,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_matching_quick_fix");
    expect(await readFile(filePath, "utf8")).toBe(unusedVariableSource);
  });

  test("refuses ambiguous legacy line/code selectors", async () => {
    const source = [
      "config:",
      '    agent_name: "Ambiguous_Bot"',
      "system:",
      '    instructions: "Use @variables.first and @variables.second."',
      "variables:",
      '    first: mutable string = "a"',
      '    second: mutable string = "b"',
      "start_agent main:",
      '    description: "Main"',
      "",
    ].join("\n");
    const filePath = await writeAgent("ambiguous.agent", source);
    const compile = await checkAgentScriptFile(filePath);
    const diagnostics = compile.diagnostics.filter(
      (diagnostic) => diagnostic.code === "instruction-template-syntax",
    );
    expect(diagnostics).toHaveLength(2);

    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      diagnostic_code: "instruction-template-syntax",
      line: diagnostics[0].range.start.line + 1,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("ambiguous_diagnostic");
    expect(result.candidates).toHaveLength(2);
    expect(await readFile(filePath, "utf8")).toBe(source);
  });

  test("returns no_matching_diagnostic when the line/code don't match", async () => {
    const filePath = await writeAgent(
      "billing.agent",
      ["system:", '    instructions: "ok"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "apply_quick_fix",
      path: filePath,
      diagnostic_code: "deprecated-field",
      line: 99,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no_matching_diagnostic");
  });
});

describe("applyMutation: set_field", () => {
  test("rewrites a nested topic.description (string) via AST and re-compiles", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: "new faq description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("new faq description");
    expect(after).not.toContain("old faq description");
    expect((result.diagnostics_after ?? []).filter((d) => d.severity === 1)).toHaveLength(0);
  });

  test("rewrites a config field (top-level scalar) via AST", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "description",
      value: "updated demo description",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    expect(result.applied_via).toBe("ast");
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("updated demo description");
  });

  test("upserts schema-valid scalar fields on existing singular blocks", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "config:",
        '    agent_name: "Test_Bot"',
        "",
        "model_config:",
        '    model: "model://old"',
        "",
        "knowledge:",
        '    citations_url: "https://old.example"',
        "",
        "system:",
        '    instructions: "x"',
        "",
      ].join("\n"),
    );

    const config = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "temperature",
      value: 0.2,
    });
    expect(config.ok).toBe(true);

    const model = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "model_config",
      field: "model",
      value: "model://new",
    });
    expect(model.ok).toBe(true);

    const knowledge = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "knowledge",
      field: "rag_feature_config_id",
      value: "kb_1",
    });
    expect(knowledge.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    expect(after).toContain("temperature: 0.2");
    expect(after).toContain('model: "model://new"');
    expect(after).toContain('rag_feature_config_id: "kb_1"');
  });

  test("upserts schema-valid scalar fields on existing named entries", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "system:",
        '    instructions: "x"',
        "",
        "connection messaging:",
        '    label: "Messaging"',
        "",
        "start_agent main:",
        '    description: "entry"',
        "",
      ].join("\n"),
    );

    const connection = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "connection.messaging",
      field: "description",
      value: "Messaging connection",
    });
    expect(connection.ok).toBe(true);

    const startAgent = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "start_agent.main",
      field: "label",
      value: "Main entry",
    });
    expect(startAgent.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    expect(after).toContain('description: "Messaging connection"');
    expect(after).toContain('label: "Main entry"');
  });

  test("set_field rejects array values with a clear unsupported_value_type reason", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "description",
      value: ["a", "b"],
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unsupported_value_type");
    expect(result.reason_detail).toMatch(/list values are not yet supported/i);
  });

  test("returns bad_component when the path is malformed", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic",
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("bad_component");
  });

  test("refuses to add a field outside the scalar upsert allowlist", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "system",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_field");
  });

  test("refuses to add a non-scalar field on topic.<name>", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.faq",
      field: "reasoning",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("invalid_field");
  });

  test("returns entry_not_found when the named entry doesn't exist", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "topic.does_not_exist",
      field: "description",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("entry_not_found");
  });

  test("dry_run on a scalar upsert returns a preview diff", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "config",
      field: "agent_type",
      value: "AgentforceEmployeeAgent",
      dry_run: true,
    });
    expect(result.ok).toBe(true);
    expect(result.was_dry_run).toBe(true);
    expect(result.diff).toContain('agent_type: "AgentforceEmployeeAgent"');
    expect(result.preview_source).toContain('agent_type: "AgentforceEmployeeAgent"');
  });

  test("returns unknown_component_kind for unrecognized heads", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );
    const result = await applyMutation({
      op: "set_field",
      path: filePath,
      component: "ghost.x",
      field: "y",
      value: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("unknown_component_kind");
  });
});

describe("applyMutation: rename", () => {
  test("renames a declarable symbol and its references", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "config:",
        '    agent_name: "Test_Bot"',
        '    description: "Demo"',
        "",
        "subagent billing:",
        '    description: "Billing"',
        "",
        "start_agent main:",
        '    description: "entry"',
        "    transition to @subagent.billing",
        "",
      ].join("\n"),
    );
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.billing",
      to: "@subagent.account_billing",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("subagent account_billing:");
    expect(after).toContain("transition to @subagent.account_billing");
    expect(after).not.toContain("subagent billing:");
  });

  test("renames semantic references without changing comments, prompt text, or similar symbols", async () => {
    const filePath = await writeAgent("bot.agent", SEMANTIC_RENAME_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.billing",
      to: "@subagent.account_billing",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }

    const after = await readFile(filePath, "utf8");
    expect(after).toContain("subagent account_billing:");
    expect(after).toContain("transition to @subagent.account_billing");
    expect(after).toContain('description: "Mention @subagent.billing as prose"');
    expect(after).toContain("# Keep @subagent.billing in this comment");
    expect(after).toContain("| Tell the user about @subagent.billing without invoking it.");
    expect(after).toContain("subagent billing_help:");
    expect(after).toContain("transition to @subagent.billing_help");
  });

  test("renames inline actions and variables through semantic provider ranges", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "config:",
        '    agent_name: "Scoped_Rename"',
        '    agent_type: "AgentforceEmployeeAgent"',
        "",
        "variables:",
        '    customer_name: mutable string = "Ada"',
        "",
        "start_agent main:",
        '    description: "Main"',
        "    actions:",
        "        lookup:",
        '            description: "Lookup"',
        "            inputs:",
        "                query: string",
        "            outputs:",
        "                result: string",
        '            target: "flow://Lookup"',
        "    reasoning:",
        "        instructions: ->",
        "            run @actions.lookup",
        "                with query = @variables.customer_name",
        "",
      ].join("\n"),
    );

    const variable = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@variables.customer_name",
      to: "@variables.contact_name",
    });
    expect(variable.ok).toBe(true);
    const action = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@actions.lookup",
      to: "@actions.find_contact",
    });
    expect(action.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    expect(after).toContain("contact_name: mutable string");
    expect(after).toContain("with query = @variables.contact_name");
    expect(after).toContain("find_contact:");
    expect(after).toContain("run @actions.find_contact");
  });

  test("refuses ambiguous scoped action symbols with structured candidates", async () => {
    const source = [
      "config:",
      '    agent_name: "Ambiguous_Actions"',
      "",
      "subagent first:",
      '    description: "First"',
      "    actions:",
      "        lookup:",
      '            description: "Lookup first"',
      '            target: "flow://First"',
      "",
      "subagent second:",
      '    description: "Second"',
      "    actions:",
      "        lookup:",
      '            description: "Lookup second"',
      '            target: "flow://Second"',
      "",
      "start_agent main:",
      '    description: "Main"',
      "",
    ].join("\n");
    const filePath = await writeAgent("bot.agent", source);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@actions.lookup",
      to: "@actions.find_contact",
    });

    expect(result).toMatchObject({ ok: false, reason: "ambiguous_symbol" });
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates?.map((candidate) => candidate.scope)).toEqual(
      expect.arrayContaining([{ subagent: "first" }, { subagent: "second" }]),
    );
    expect(await readFile(filePath, "utf8")).toBe(source);
  });

  test("checks scoped action collisions only inside the source scope", async () => {
    const source = [
      "config:",
      '    agent_name: "Scoped_Collision"',
      "",
      "subagent first:",
      '    description: "First"',
      "    actions:",
      "        lookup:",
      '            description: "Lookup first"',
      '            target: "flow://First"',
      "    reasoning:",
      "        instructions: ->",
      "            run @actions.lookup",
      "",
      "subagent second:",
      '    description: "Second"',
      "    actions:",
      "        find_contact:",
      '            description: "Existing in another scope"',
      '            target: "flow://Second"',
      "",
      "start_agent main:",
      '    description: "Main"',
      "",
    ].join("\n");
    const filePath = await writeAgent("bot.agent", source);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@actions.lookup",
      to: "@actions.find_contact",
    });
    expect(result.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    expect(after).toContain('description: "Existing in another scope"');
    expect(after.match(/find_contact:/g)).toHaveLength(2);
    expect(after).toContain("run @actions.find_contact");

    const sameScopeSource = source.replace(
      '            target: "flow://First"',
      [
        '            target: "flow://First"',
        "        find_contact:",
        '            description: "Existing in source scope"',
        '            target: "flow://Existing"',
      ].join("\n"),
    );
    const sameScopeFile = await writeAgent("same-scope.agent", sameScopeSource);
    const collision = await applyMutation({
      op: "rename",
      path: sameScopeFile,
      from: "@actions.lookup",
      to: "@actions.find_contact",
    });
    expect(collision).toMatchObject({ ok: false, reason: "target_exists" });
    expect(await readFile(sameScopeFile, "utf8")).toBe(sameScopeSource);
  });

  test("rejects missing sources and target-name collisions", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      `${SEMANTIC_RENAME_FIXTURE}\nsubagent account_billing:\n    description: "Existing"\n`,
    );
    const missing = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.unknown",
      to: "@subagent.other",
    });
    expect(missing).toMatchObject({ ok: false, reason: "entry_not_found" });

    const collision = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.billing",
      to: "@subagent.account_billing",
    });
    expect(collision).toMatchObject({ ok: false, reason: "target_exists" });
  });

  test("dry-run semantic rename previews edits without writing", async () => {
    const filePath = await writeAgent("bot.agent", SEMANTIC_RENAME_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "@subagent.billing",
      to: "@subagent.account_billing",
      dry_run: true,
    });
    expect(result).toMatchObject({ ok: true, was_dry_run: true });
    expect(result.preview_source).toContain("subagent account_billing:");
    expect(await readFile(filePath, "utf8")).toBe(SEMANTIC_RENAME_FIXTURE);
  });

  test("supports legacy topic.X → subagent.X conversion input", async () => {
    const filePath = await writeAgent("bot.agent", TOPIC_CONVERSION_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "topic.billing",
      to: "subagent.billing",
    });
    if (!result.ok) {
      throw new Error(`Expected success, got ${result.reason}: ${result.reason_detail}`);
    }
    const after = await readFile(filePath, "utf8");
    expect(after).toContain("subagent billing:");
    expect(after).toContain("transition to @subagent.billing");
    expect(after).toContain('description: "Mention @topic.billing as prose"');
    expect(after).toContain("topic billing_help:");
    expect(after).toContain("transition to @topic.billing_help");
  });

  test("keeps reverse subagent → topic conversion as a narrow semantic operation", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      [
        "config:",
        '    agent_name: "Reverse_Conversion"',
        "",
        "subagent billing:",
        '    description: "Billing"',
        "",
        "start_agent main:",
        '    description: "Mention @subagent.billing as prose"',
        "    before_reasoning:",
        "        transition to @subagent.billing",
        "",
      ].join("\n"),
    );
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "subagent.billing",
      to: "topic.billing",
    });
    expect(result.ok).toBe(true);

    const after = await readFile(filePath, "utf8");
    expect(after).toContain("topic billing:");
    expect(after).toContain("transition to @topic.billing");
    expect(after).toContain('description: "Mention @subagent.billing as prose"');
  });

  test("rejects broad cross-namespace renames", async () => {
    const filePath = await writeAgent("bot.agent", FULL_FIXTURE);
    const result = await applyMutation({
      op: "rename",
      path: filePath,
      from: "topic.billing",
      to: "variables.billing",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rename_unsupported");
  });
});

describe("applyMutation: insert / delete guidance", () => {
  test("returns use_generic_edit with a compile/check hint", async () => {
    const filePath = await writeAgent(
      "bot.agent",
      ["system:", '    instructions: "x"', ""].join("\n"),
    );

    const insert = await applyMutation({
      op: "insert",
      path: filePath,
      parent: "topic.x.actions",
      child: "lookup",
    });
    expect(insert.ok).toBe(false);
    expect(insert.reason).toBe("use_generic_edit");
    expect(insert.reason_detail).toContain("generic edit tool");
    expect(insert.reason_detail).toContain("compile/check");
  });
});

describe("applyMutation: file safety", () => {
  test("read_failed when the path doesn't exist", async () => {
    const result = await applyMutation({
      op: "set_field",
      path: path.join(workDir, "nope.agent"),
      component: "system",
      field: "instructions",
      value: "x",
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("read_failed");
  });
});
