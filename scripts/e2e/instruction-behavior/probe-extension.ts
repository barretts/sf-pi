/* SPDX-License-Identifier: Apache-2.0 */
/** Allows bounded local context reads and blocks every other tool after recording routing. */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const SAFE_LOCAL_CONTEXT_TOOLS = new Set(["read", "grep", "find", "ls"]);
type ObservedCall = { tool: string; action?: string; context_only?: boolean };

export default function instructionBehaviorProbe(pi: ExtensionAPI): void {
  const calls: ObservedCall[] = [];

  pi.on("tool_call", (event, ctx) => {
    const input = event.input as { action?: unknown; command?: unknown } | undefined;
    const contextOnlyBash =
      event.toolName === "bash" &&
      typeof input?.command === "string" &&
      isLocalContextCommand(input.command);
    calls.push({
      tool: event.toolName,
      ...(typeof input?.action === "string" ? { action: input.action } : {}),
      ...(contextOnlyBash ? { context_only: true } : {}),
    });
    persist(calls);
    if (SAFE_LOCAL_CONTEXT_TOOLS.has(event.toolName)) return undefined;
    if (contextOnlyBash) {
      return {
        block: true,
        reason:
          "Instruction Behavior Eval does not execute shell commands. Continue with read/grep/find/ls or the owning SF Pi tool.",
      };
    }
    ctx.abort();
    return {
      block: true,
      reason:
        "Instruction Behavior Eval records routing only; non-local execution is intentionally blocked.",
    };
  });

  pi.on("agent_end", () => persist(calls));
  pi.on("session_shutdown", () => persist(calls));
}

function isLocalContextCommand(command: string): boolean {
  const value = command.trim();
  if (!value || /[;&|><\n`$(){}]/.test(value)) return false;
  if (/\b(rm|mv|cp|touch|mkdir|chmod|chown|truncate|tee|dd)\b/.test(value)) return false;
  if (/^find\b/.test(value) && /-(delete|exec|execdir|ok|okdir)\b/.test(value)) return false;
  return /^(pwd|ls\b|rg\b|find\b|cat\b|head\b|tail\b|wc\b|test\s+-(e|f|d)\b|sed\s+-n\b|git\s+(status|diff|ls-files)\b)/.test(
    value,
  );
}

function persist(calls: ObservedCall[]): void {
  const output = process.env.SF_PI_INSTRUCTION_BEHAVIOR_OBSERVATION;
  if (!output) return;
  mkdirSync(path.dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify({ calls }, null, 2)}\n`, "utf8");
}
