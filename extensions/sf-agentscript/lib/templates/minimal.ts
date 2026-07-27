/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Minimal executable `.agent` scaffold: one start agent and one deterministically
 * entered subagent. It avoids deprecated topic blocks and gives the generated
 * subagent real reasoning guidance instead of an empty routing node.
 *
 * agent_type follows the same Issue 1 rule as agentforce-default: explicit
 * `AgentforceEmployeeAgent` by default, `AgentforceServiceAgent` + user when
 * `job_spec.agent_user` is supplied. See ./agent-type.ts.
 */

import { chooseAgentTypeFromSpec } from "./agent-type.ts";
import type { AgentJobSpec } from "../create.ts";

export function generateMinimal(bundleName: string, jobSpec?: AgentJobSpec): string {
  const description = jobSpec?.description ?? "You are a helpful agent.";
  const safeName = escapeString(bundleName);
  const { agent_type, default_agent_user } = chooseAgentTypeFromSpec(jobSpec);
  const lines = [
    "config:",
    `    agent_name: "${safeName}"`,
    `    agent_type: "${agent_type}"`,
    `    description: "Minimal scaffold for ${safeName}."`,
  ];
  lines.push("");
  if (default_agent_user) {
    lines.push("access:", `    default_agent_user: "${escapeString(default_agent_user)}"`, "");
  }
  lines.push("system:", "    instructions: |");
  appendTemplateLines(lines, description, 8);
  lines.push(
    "    messages:",
    `        welcome: "Welcome to ${safeName}. How can I help?"`,
    '        error: "I could not complete that request. Please try again."',
    "",
    "subagent primary:",
    '    description: "Primary responsibility for this agent."',
    "    reasoning:",
    "        instructions: ->",
  );
  appendProcedureLines(lines, description, 12);
  lines.push(
    "",
    "start_agent main:",
    `    description: "Entry point for ${safeName}."`,
    "    before_reasoning:",
    "        transition to @subagent.primary",
    "",
  );
  return lines.join("\n");
}

function appendTemplateLines(lines: string[], value: string, spaces: number): void {
  const indent = " ".repeat(spaces);
  for (const line of value.split("\n")) lines.push(`${indent}${line}`);
}

function appendProcedureLines(lines: string[], value: string, spaces: number): void {
  const indent = " ".repeat(spaces);
  for (const line of value.split("\n")) lines.push(`${indent}| ${line}`);
}

function escapeString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
