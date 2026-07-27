/* SPDX-License-Identifier: Apache-2.0 */
/** Stable eval-relevant projections over official Agent Script AST nodes. */

export type StateScalar = string | number | boolean;

export interface StateUpdateSummary {
  variable: string;
  operation: "set" | "increment" | "decrement";
  value?: StateScalar;
  amount?: number;
}

export interface StateBranchSummary {
  variable: string;
  operator: "truthy" | "equals" | "greater_than" | "greater_than_or_equal";
  expected: StateScalar;
  instructions: string;
}

export type EvalProjectionDecompose = (
  expr: unknown,
) => { namespace: string; property: string } | null;

function unwrapScalar(value: unknown): StateScalar | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value && typeof value === "object") {
    const inner = (value as { value?: unknown }).value;
    if (typeof inner === "string" || typeof inner === "number" || typeof inner === "boolean") {
      return inner;
    }
  }
  return undefined;
}

function variableName(value: unknown, decompose: EvalProjectionDecompose): string | undefined {
  const ref = decompose(value);
  return ref?.namespace === "variables" ? ref.property : undefined;
}

function templateText(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const node = value as { __kind?: unknown; parts?: unknown[] };
  if (node.__kind !== "Template" || !Array.isArray(node.parts)) return undefined;
  const parts: string[] = [];
  for (const part of node.parts) {
    const p = part as { __kind?: unknown; value?: unknown };
    if (p.__kind !== "TemplateText" || typeof p.value !== "string") return undefined;
    parts.push(p.value);
  }
  return parts.join("").trim() || undefined;
}

function templateBodyText(body: unknown): string | undefined {
  if (!Array.isArray(body) || body.length === 0) return undefined;
  const texts = body.map(templateText);
  if (texts.some((text) => !text)) return undefined;
  return (texts as string[]).join(" ").trim() || undefined;
}

function stateCondition(
  condition: unknown,
  decompose: EvalProjectionDecompose,
): Omit<StateBranchSummary, "instructions"> | undefined {
  const direct = variableName(condition, decompose);
  if (direct) return { variable: direct, operator: "truthy", expected: true };
  if (!condition || typeof condition !== "object") return undefined;
  const value = condition as {
    __kind?: unknown;
    left?: unknown;
    right?: unknown;
    operator?: unknown;
  };
  if (value.__kind !== "ComparisonExpression") return undefined;
  const variable = variableName(value.left, decompose);
  const expected = unwrapScalar(value.right);
  if (!variable || expected === undefined) return undefined;
  const operators: Record<string, StateBranchSummary["operator"]> = {
    "==": "equals",
    is: "equals",
    ">": "greater_than",
    ">=": "greater_than_or_equal",
  };
  const operator = typeof value.operator === "string" ? operators[value.operator] : undefined;
  return operator ? { variable, operator, expected } : undefined;
}

export function projectStateBranches(
  entry: Record<string, unknown>,
  decompose: EvalProjectionDecompose,
): StateBranchSummary[] {
  const reasoning = entry.reasoning as { instructions?: { statements?: unknown[] } } | undefined;
  const statements = reasoning?.instructions?.statements;
  if (!Array.isArray(statements)) return [];
  const out: StateBranchSummary[] = [];
  const visitIf = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const statement = node as {
      __kind?: unknown;
      condition?: unknown;
      body?: unknown;
      orelse?: unknown[];
    };
    if (statement.__kind !== "IfStatement") return;
    const condition = stateCondition(statement.condition, decompose);
    const instructions = templateBodyText(statement.body);
    if (condition && instructions) out.push({ ...condition, instructions });
    const nested = Array.isArray(statement.orelse) ? statement.orelse[0] : undefined;
    if ((nested as { __kind?: unknown } | undefined)?.__kind === "IfStatement") visitIf(nested);
  };
  for (const statement of statements) visitIf(statement);
  return out;
}

export function projectAfterResponseUpdates(
  entry: Record<string, unknown>,
  decompose: EvalProjectionDecompose,
): StateUpdateSummary[] {
  const procedure = entry.after_response as { statements?: unknown[] } | undefined;
  if (!Array.isArray(procedure?.statements)) return [];
  const out: StateUpdateSummary[] = [];
  for (const raw of procedure.statements) {
    if (!raw || typeof raw !== "object") continue;
    const statement = raw as { __kind?: unknown; target?: unknown; value?: unknown };
    if (statement.__kind !== "SetClause") continue;
    const variable = variableName(statement.target, decompose);
    if (!variable) continue;
    const literal = unwrapScalar(statement.value);
    if (literal !== undefined) {
      out.push({ variable, operation: "set", value: literal });
      continue;
    }
    const expression = statement.value as {
      __kind?: unknown;
      operator?: unknown;
      left?: unknown;
      right?: unknown;
    };
    if (expression?.__kind !== "BinaryExpression") continue;
    const left = variableName(expression.left, decompose);
    const amount = unwrapScalar(expression.right);
    if (left !== variable || typeof amount !== "number") continue;
    if (expression.operator === "+") out.push({ variable, operation: "increment", amount });
    else if (expression.operator === "-") out.push({ variable, operation: "decrement", amount });
  }
  return out;
}
