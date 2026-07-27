/* SPDX-License-Identifier: Apache-2.0 */
/** Compact integration contracts for the official Agent Script package seam. */
import { describe, expect, test } from "vitest";
import { checkAgentScriptSource, isAgentScriptCompileValid } from "../lib/diagnostics.ts";
import { loadAgentforceSDK } from "../lib/sdk.ts";

const HEAD = `config:
  agent_name: "ContractBot"
system:
  instructions: "Help"
`;

describe("upstream Agent Script capability contracts", () => {
  test("defines compile validity by severity-1 errors only", () => {
    expect(isAgentScriptCompileValid([{ severity: 2 }, { severity: 3 }, { severity: 4 }])).toBe(
      true,
    );
    expect(isAgentScriptCompileValid([{ severity: 1 }, { severity: 3 }])).toBe(false);
  });

  test("preserves upstream warnings that have no quick fix", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  name: mutable string = "x"
start_agent main:
  description: "Main"
  actions:
    check:
      description: "Check"
      target: "flow://Check"
      outputs:
        ok: boolean
  reasoning:
    instructions: ->
      |Do something
    actions:
      do_check: @actions.check
        available when @variables.name
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "available-when-non-boolean", severity: 2 }),
      ]),
    );
  });

  test("preserves the collect experimental information diagnostic", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  email: mutable string = None
start_agent main:
  description: "Entry"
  transition to @subagent.gather
subagent gather:
  description: "Gather"
  reasoning:
    instructions: ->
      collect @variables.email
        message: "What is your email?"
`);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "collect-experimental", severity: 3 }),
      ]),
    );
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 1)).toBe(false);
  });

  test("accepts else-if syntax through sf-pi's lazy package adapter", async () => {
    const result = await checkAgentScriptSource(`${HEAD}variables:
  route: mutable string = "a"
start_agent main:
  description: "Entry"
  reasoning:
    instructions: ->
      if @variables.route == "a":
        | A
      else if @variables.route == "b":
        | B
      else:
        | C
`);
    expect(result.ok).toBe(true);
    expect(result.diagnostics.some((diagnostic) => diagnostic.severity === 1)).toBe(false);
  });

  test("compiles connected-agent post-response behavior", async () => {
    const sdk = await loadAgentforceSDK();
    expect(sdk).not.toBeNull();
    const result = sdk!.compileSource(`${HEAD}variables:
  done: mutable boolean = False
connected_subagent helper:
  target: "agent://Helper"
  description: "Helper"
  delegate_escalation: False
  after_response:
    set @variables.done = True
start_agent main:
  description: "Entry"
  reasoning:
    instructions: ->
      transition to @connected_subagent.helper
`);
    expect(
      result.diagnostics.some((diagnostic) => (diagnostic as { severity?: number }).severity === 1),
    ).toBe(false);
    const output = JSON.stringify(result.output);
    expect(output).toContain('"after_response"');
    expect(output).toContain('"delegate_escalation":false');
  });
});
