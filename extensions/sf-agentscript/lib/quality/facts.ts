/* SPDX-License-Identifier: Apache-2.0 */
/** Stable facts derived from the official Agent Script AST for quality rules. */
import {
  decomposeAtMemberExpression,
  isNamedMap,
  walkAstExpressions,
} from "@sf-agentscript/language";
import type {
  QualityAction,
  QualityAstNode,
  QualityComponent,
  QualityFacts,
  QualityFlowEdge,
  QualityInvocation,
  QualityParameter,
  QualityProcedure,
  QualityVariable,
} from "./types.ts";

export function buildQualityFacts(root: unknown): QualityFacts {
  const ast = asNode(root);
  const components = collectComponents(ast);
  const variables = collectVariables(ast);
  const procedures = collectProcedures(components);
  const actions = collectActions(components);
  const invocations: QualityInvocation[] = [];
  const edges: QualityFlowEdge[] = [];
  const usedActions = new Set<string>();

  for (const procedure of procedures) {
    walkProcedureStatements(procedure.statements, {
      component: procedure.component,
      procedure,
      conditions: [],
      insideRun: false,
      depth: 0,
      components,
      invocations,
      edges,
      usedActions,
    });
  }

  for (const component of components) {
    const reasoning = asOptionalNode(component.node.reasoning);
    const reasoningActions = reasoning?.actions;
    for (const [, rawBinding] of namedEntries(reasoningActions)) {
      const binding = asNode(rawBinding);
      const ref = decomposeAtMemberExpression(binding.value);
      const statements = statementArray(binding.statements);
      const available = statements.find((statement) => statement.__kind === "AvailableWhen");
      const conditions = available
        ? [nodeText(asOptionalNode(available.condition)) ?? "available when"]
        : [];

      if (ref?.namespace === "actions") {
        usedActions.add(actionKey(component.id, ref.property));
      } else if (ref?.namespace === "subagent" || ref?.namespace === "topic") {
        const to = resolveComponentId(components, ref.namespace, ref.property);
        if (to) {
          edges.push({
            from: component.id,
            to,
            kind: "subagent_delegation",
            node: binding,
            conditions,
            unconditional: false,
          });
        }
      } else if (ref?.namespace === "connected_subagent") {
        const to = resolveComponentId(components, ref.namespace, ref.property);
        if (to) {
          edges.push({
            from: component.id,
            to,
            kind: "connected_agent_invocation",
            node: binding,
            conditions,
            unconditional: false,
          });
        }
      } else if (ref?.namespace === "utils" && ref.property === "transition") {
        for (const statement of statements) {
          if (statement.__kind !== "ToClause") continue;
          const target = decomposeAtMemberExpression(statement.target);
          if (!target) continue;
          const to = resolveComponentId(components, target.namespace, target.property);
          if (!to) continue;
          edges.push({
            from: component.id,
            to,
            kind: "planner_transition",
            node: statement,
            conditions,
            unconditional: false,
          });
        }
      }

      // Runs inside a reasoning-action callback are deterministic follow-ups.
      for (const statement of statements) {
        if (statement.__kind === "RunStatement") {
          collectRun(
            statement,
            component,
            undefined,
            1,
            components,
            invocations,
            edges,
            usedActions,
            conditions,
          );
        }
      }
    }
  }

  return { root: ast, components, procedures, actions, invocations, edges, variables, usedActions };
}

function collectComponents(root: QualityAstNode): QualityComponent[] {
  const result: QualityComponent[] = [];
  for (const kind of [
    "start_agent",
    "orchestrator",
    "subagent",
    "topic",
    "connected_subagent",
  ] as const) {
    for (const [name, rawNode] of namedEntries(root[kind])) {
      const node = asNode(rawNode);
      result.push({
        id: `${kind}.${name}`,
        kind,
        name,
        node,
        isStart: kind === "start_agent" || kind === "orchestrator",
        unknownRouting: scalarValue(node.schema) !== undefined,
      });
    }
  }
  return result;
}

function collectVariables(root: QualityAstNode): Map<string, QualityVariable> {
  const result = new Map<string, QualityVariable>();
  for (const [name, rawDecl] of namedEntries(root.variables)) {
    const node = asNode(rawDecl);
    const props = asOptionalNode(node.properties);
    result.set(name, {
      name,
      node,
      type: typeText(node),
      description: scalarString(props?.description),
      defaultValue: asOptionalNode(node.defaultValue),
    });
  }
  return result;
}

function collectProcedures(components: QualityComponent[]): QualityProcedure[] {
  const result: QualityProcedure[] = [];
  for (const component of components) {
    addProcedure(result, component, "before_reasoning", component.node.before_reasoning);
    addProcedure(result, component, "after_reasoning", component.node.after_reasoning);
    addProcedure(result, component, "on_init", component.node.on_init);
    addProcedure(result, component, "on_exit", component.node.on_exit);
    addProcedure(result, component, "after_response", component.node.after_response);
    const reasoning = asOptionalNode(component.node.reasoning);
    addProcedure(result, component, "reasoning.instructions", reasoning?.instructions);
  }
  return result;
}

function addProcedure(
  output: QualityProcedure[],
  component: QualityComponent,
  name: string,
  value: unknown,
): void {
  const node = asOptionalNode(value);
  if (!node) return;
  const statements = statementArray(node.statements);
  if (statements.length === 0) return;
  output.push({ component, name: `${component.id}.${name}`, node, statements });
}

function collectActions(components: QualityComponent[]): QualityAction[] {
  const result: QualityAction[] = [];
  for (const component of components) {
    for (const [name, rawAction] of namedEntries(component.node.actions)) {
      const node = asNode(rawAction);
      result.push({
        component,
        name,
        node,
        target: scalarString(node.target),
        inputs: parameterMap(node.inputs),
        outputs: parameterMap(node.outputs),
      });
    }
  }
  return result;
}

function parameterMap(value: unknown): Map<string, QualityParameter> {
  const result = new Map<string, QualityParameter>();
  for (const [name, rawDecl] of namedEntries(value)) {
    const node = asNode(rawDecl);
    const props = asOptionalNode(node.properties);
    const isRequired = scalarValue(props?.is_required);
    result.set(name, {
      name,
      node,
      type: typeText(node),
      hasDefault: node.defaultValue != null,
      required: isRequired !== false,
    });
  }
  return result;
}

interface WalkContext {
  component: QualityComponent;
  procedure: QualityProcedure;
  conditions: string[];
  insideRun: boolean;
  depth: number;
  components: QualityComponent[];
  invocations: QualityInvocation[];
  edges: QualityFlowEdge[];
  usedActions: Set<string>;
}

function walkProcedureStatements(statements: QualityAstNode[], ctx: WalkContext): void {
  for (const statement of statements) {
    if (statement.__kind === "IfStatement") {
      const condition = nodeText(asOptionalNode(statement.condition)) ?? "if";
      walkProcedureStatements(statementArray(statement.body), {
        ...ctx,
        conditions: [...ctx.conditions, condition],
      });
      walkProcedureStatements(statementArray(statement.orelse), {
        ...ctx,
        conditions: [...ctx.conditions, `else(${condition})`],
      });
      continue;
    }
    if (statement.__kind === "RunStatement") {
      collectRun(
        statement,
        ctx.component,
        ctx.procedure,
        ctx.depth,
        ctx.components,
        ctx.invocations,
        ctx.edges,
        ctx.usedActions,
        ctx.conditions,
      );
      continue;
    }
    if (statement.__kind === "TransitionStatement") {
      collectTransitionEdges(statement, ctx);
    }
  }
}

function collectRun(
  statement: QualityAstNode,
  component: QualityComponent,
  procedure: QualityProcedure | undefined,
  depth: number,
  components: QualityComponent[],
  invocations: QualityInvocation[],
  edges: QualityFlowEdge[],
  usedActions: Set<string>,
  conditions: string[],
): void {
  const ref = decomposeAtMemberExpression(statement.target);
  const statements = statementArray(statement.body);
  if (ref?.namespace === "actions") {
    invocations.push({
      component,
      procedure,
      actionName: ref.property,
      node: statement,
      statements,
      depth,
    });
    usedActions.add(actionKey(component.id, ref.property));
  }

  for (const child of statements) {
    if (child.__kind === "RunStatement") {
      collectRun(
        child,
        component,
        procedure,
        depth + 1,
        components,
        invocations,
        edges,
        usedActions,
        [...conditions, `after @actions.${ref?.property ?? "unknown"}`],
      );
    } else if (child.__kind === "IfStatement") {
      const condition = nodeText(asOptionalNode(child.condition)) ?? "if";
      for (const nested of [...statementArray(child.body), ...statementArray(child.orelse)]) {
        if (nested.__kind === "RunStatement") {
          collectRun(
            nested,
            component,
            procedure,
            depth + 1,
            components,
            invocations,
            edges,
            usedActions,
            [...conditions, condition],
          );
        }
      }
    } else if (child.__kind === "TransitionStatement") {
      const walkCtx: WalkContext = {
        component,
        procedure: procedure ?? {
          component,
          name: `${component.id}.reasoning.action`,
          node: statement,
          statements,
        },
        conditions: [...conditions, `after @actions.${ref?.property ?? "unknown"}`],
        insideRun: true,
        depth,
        components,
        invocations,
        edges,
        usedActions,
      };
      collectTransitionEdges(child, walkCtx);
    }
  }
}

function collectTransitionEdges(statement: QualityAstNode, ctx: WalkContext): void {
  for (const clause of statementArray(statement.clauses)) {
    if (clause.__kind !== "ToClause") continue;
    const ref = decomposeAtMemberExpression(clause.target);
    if (!ref) continue;
    const to = resolveComponentId(ctx.components, ref.namespace, ref.property);
    if (!to) continue;
    ctx.edges.push({
      from: ctx.component.id,
      to,
      kind: "deterministic_transition",
      node: clause,
      conditions: [...ctx.conditions],
      unconditional: ctx.conditions.length === 0 && !ctx.insideRun,
    });
  }
}

export function actionKey(componentId: string, actionName: string): string {
  return `${componentId}::${actionName}`;
}

export function actionForInvocation(
  facts: QualityFacts,
  invocation: QualityInvocation,
): QualityAction | undefined {
  return facts.actions.find(
    (action) =>
      action.component.id === invocation.component.id && action.name === invocation.actionName,
  );
}

export function resolveComponentId(
  components: QualityComponent[],
  namespace: string,
  name: string,
): string | undefined {
  const order =
    namespace === "connected_subagent"
      ? ["connected_subagent"]
      : namespace === "orchestrator"
        ? ["orchestrator"]
        : namespace === "topic"
          ? ["topic", "start_agent", "subagent", "orchestrator"]
          : ["subagent", "topic", "start_agent", "orchestrator"];
  for (const kind of order) {
    const found = components.find(
      (component) => component.kind === kind && component.name === name,
    );
    if (found) return found.id;
  }
  return undefined;
}

export function expressionsIn(value: unknown): QualityAstNode[] {
  const result: QualityAstNode[] = [];
  walkAstExpressions(value, (expr) => result.push(asNode(expr)));
  return result;
}

export function namedEntries(value: unknown): Array<[string, unknown]> {
  if (!value || !isNamedMap(value)) return [];
  return Array.from((value as { entries: () => IterableIterator<[string, unknown]> }).entries());
}

export function statementArray(value: unknown): QualityAstNode[] {
  return Array.isArray(value) ? value.filter(isNode).map(asNode) : [];
}

export function asNode(value: unknown): QualityAstNode {
  return (value && typeof value === "object" ? value : {}) as QualityAstNode;
}

export function asOptionalNode(value: unknown): QualityAstNode | undefined {
  return value && typeof value === "object" ? (value as QualityAstNode) : undefined;
}

export function nodeText(node: QualityAstNode | undefined): string | undefined {
  return node?.__cst?.node?.text?.trim();
}

export function scalarValue(value: unknown): string | number | boolean | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (!value || typeof value !== "object") return undefined;
  const node = value as { value?: unknown; name?: unknown };
  if (
    typeof node.value === "string" ||
    typeof node.value === "number" ||
    typeof node.value === "boolean"
  ) {
    return node.value;
  }
  return typeof node.name === "string" ? node.name : undefined;
}

export function scalarString(value: unknown): string | undefined {
  const scalar = scalarValue(value);
  return typeof scalar === "string" ? scalar : undefined;
}

export function typeText(node: QualityAstNode): string | undefined {
  const type = asOptionalNode(node.type);
  return nodeText(type) ?? scalarString(type);
}

function isNode(value: unknown): value is QualityAstNode {
  return !!value && typeof value === "object";
}
