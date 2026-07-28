/* SPDX-License-Identifier: Apache-2.0 */
/** SF Pi-owned AST hardening diagnostics not yet owned by the official dialect. */
import { agentforceSchemaContext, parse } from "@sf-agentscript/agentforce";
import {
  LintEngine,
  attachDiagnostic,
  decomposeAtMemberExpression,
  isNamedMap,
  storeKey,
  walkAstExpressions,
  type AstRoot,
  type LintPass,
  type SchemaContext,
} from "@sf-agentscript/language";
import type { AgentScriptDiagnostic, AgentScriptRange } from "./types.ts";

const SOURCE = "sf-agentscript-local";
const SALESFORCE_ID_RE =
  /^(?:00D|005|001|003|500|301|300|01p|0X9|0Xx|0Mw|0Af)[A-Za-z0-9]{12}(?:[A-Za-z0-9]{3})?$/;

export async function buildAstHardeningDiagnostics(
  source: string,
): Promise<AgentScriptDiagnostic[]> {
  const document = parse(source);
  const engine = new LintEngine({ passes: [new SfPiHardeningPass()], source: SOURCE });
  return engine
    .run(document.ast as unknown as AstRoot, agentforceSchemaContext as unknown as SchemaContext)
    .diagnostics.filter((diagnostic) => diagnostic.source === SOURCE) as AgentScriptDiagnostic[];
}

class SfPiHardeningPass implements LintPass {
  readonly id = storeKey("sf-agentscript-local/hardening");
  readonly description = "Checks proven Agentforce publish/runtime footguns not covered upstream";

  run(_store: unknown, rawRoot: AstRoot): void {
    const root = asNode(rawRoot);
    const employee = scalarString(asNode(root.config).agent_type) === "AgentforceEmployeeAgent";

    if (employee) {
      for (const [name, rawConnection] of namedEntries(root.connection)) {
        if (name !== "messaging") continue;
        addDiagnostic(
          asNode(rawConnection),
          "employee-agent-connection-messaging",
          "Employee Agents must not include a connection messaging block.",
          1,
        );
      }
      walkAstExpressions(root, (expression) => {
        const ref = decomposeAtMemberExpression(expression);
        if (ref?.namespace === "utils" && ref.property === "escalate") {
          addDiagnostic(
            asNode(expression),
            "employee-agent-escalate",
            "@utils.escalate is Service-Agent-only. Employee Agents should use a help subagent or target-backed action.",
            1,
          );
        }
      });
    }

    walkAst(root, { employee: false, insideRun: false, allowInputs: false, allowOutputs: false });

    for (const component of componentNodes(root)) {
      for (const [name, rawAction] of namedEntries(component.actions)) {
        const action = asNode(rawAction);
        const target = scalarString(action.target);
        if (!target) continue;
        const separator = target.indexOf("://");
        const scheme = separator > 0 ? target.slice(0, separator) : "";
        const refName = separator > 0 ? target.slice(separator + 3) : "";
        if (SALESFORCE_ID_RE.test(refName)) {
          addDiagnostic(
            asNode(action.target) ?? action,
            "target-ref-looks-like-id",
            `Action target '${target}' looks like a Salesforce record id. Use a stable API name.`,
            2,
            { action: name, target },
          );
        }
        if (scheme === "apex" && refName.includes(".")) {
          addDiagnostic(
            asNode(action.target) ?? action,
            "apex-target-method-suffix",
            "apex:// targets must reference the invocable class API name, not Class.method.",
            2,
            { action: name, target },
          );
        }
      }
    }
  }
}

interface WalkContext {
  employee: boolean;
  insideRun: boolean;
  allowInputs: boolean;
  allowOutputs: boolean;
}

function walkAst(value: unknown, ctx: WalkContext, seen = new Set<object>()): void {
  if (!value || typeof value !== "object" || seen.has(value as object)) return;
  seen.add(value as object);
  if (Array.isArray(value)) {
    for (const item of value) walkAst(item, ctx, seen);
    return;
  }
  if (isNamedMap(value)) {
    for (const [, entry] of (
      value as { entries: () => IterableIterator<[string, unknown]> }
    ).entries()) {
      walkAst(entry, ctx, seen);
    }
    return;
  }
  const node = asNode(value);
  const ref = decomposeAtMemberExpression(node);
  if (ref?.namespace === "inputs" && !ctx.allowInputs) {
    addDiagnostic(
      node,
      "inputs-out-of-scope",
      "@inputs is only available in action with-bindings.",
      1,
    );
  }
  if (ref?.namespace === "outputs" && !ctx.allowOutputs) {
    addDiagnostic(
      node,
      "outputs-out-of-scope",
      "@outputs is only available in a set/if callback immediately after an action invocation.",
      1,
    );
  }
  if (ctx.employee && ref?.namespace === "utils" && ref.property === "escalate") {
    addDiagnostic(
      node,
      "employee-agent-escalate",
      "@utils.escalate is Service-Agent-only. Employee Agents should use a help subagent or target-backed action.",
      1,
    );
  }

  if (node.__kind === "ReasoningActionBlock") {
    const children = Array.isArray(node.__children) ? node.__children : [];
    for (const rawChild of children) {
      const child = asNode(asNode(rawChild).value ?? rawChild);
      if (child.__kind === "WithClause") {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: true, allowOutputs: false }, seen);
      } else if (child.__kind === "SetClause" || child.__kind === "IfStatement") {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: false, allowOutputs: true }, seen);
      } else {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: false, allowOutputs: false }, seen);
      }
    }
    return;
  }

  if (node.__kind === "RunStatement") {
    walkAst(node.target, { ...ctx, allowInputs: false, allowOutputs: false }, seen);
    for (const child of statementArray(node.body)) {
      if (child.__kind === "WithClause") {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: true, allowOutputs: false }, seen);
      } else if (child.__kind === "SetClause" || child.__kind === "IfStatement") {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: false, allowOutputs: true }, seen);
      } else {
        walkAst(child, { ...ctx, insideRun: true, allowInputs: false, allowOutputs: false }, seen);
      }
    }
    return;
  }

  for (const [key, child] of Object.entries(node)) {
    if (
      key === "__cst" ||
      key === "__diagnostics" ||
      key === "__comments" ||
      key === "__symbol" ||
      key === "parent"
    )
      continue;
    walkAst(child, ctx, seen);
  }
}

function componentNodes(root: AstNode): AstNode[] {
  const output: AstNode[] = [];
  for (const key of ["start_agent", "subagent", "topic"] as const) {
    for (const [, node] of namedEntries(root[key])) output.push(asNode(node));
  }
  return output;
}

interface AstNode {
  __kind?: string;
  __cst?: {
    range?: AgentScriptRange;
    node?: {
      parent?: {
        type?: string;
        startRow?: number;
        startCol?: number;
        endRow?: number;
        endCol?: number;
      };
    };
  };
  [key: string]: unknown;
}

function addDiagnostic(
  node: AstNode,
  code: string,
  message: string,
  severity: 1 | 2,
  data?: Record<string, unknown>,
): void {
  attachDiagnostic(node as never, {
    range: diagnosticRange(node),
    message,
    severity,
    code,
    source: SOURCE,
    ...(data ? { data } : {}),
  });
}

function diagnosticRange(node: AstNode): AgentScriptRange {
  const own = node.__cst?.range;
  const parent = node.__cst?.node?.parent;
  if (parent?.type === "mapping_element" && typeof parent.startRow === "number") {
    return {
      start: { line: parent.startRow, character: parent.startCol ?? 0 },
      end: {
        line: parent.endRow ?? own?.end.line ?? parent.startRow,
        character: parent.endCol ?? own?.end.character ?? 1,
      },
    };
  }
  return own ?? { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
}

function namedEntries(value: unknown): Array<[string, unknown]> {
  return value && isNamedMap(value)
    ? Array.from((value as { entries: () => IterableIterator<[string, unknown]> }).entries())
    : [];
}

function statementArray(value: unknown): AstNode[] {
  return Array.isArray(value)
    ? value.filter((item) => item && typeof item === "object").map(asNode)
    : [];
}

function asNode(value: unknown): AstNode {
  return (value && typeof value === "object" ? value : {}) as AstNode;
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;
  const scalar =
    (value as { value?: unknown; name?: unknown }).value ?? (value as { name?: unknown }).name;
  return typeof scalar === "string" ? scalar : undefined;
}
