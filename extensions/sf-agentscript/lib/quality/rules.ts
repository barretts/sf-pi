/* SPDX-License-Identifier: Apache-2.0 */
/** Rule evaluators over stable Agent Script quality facts. */
import { graphlib } from "@dagrejs/dagre";
import {
  attachDiagnostic,
  decomposeAtMemberExpression,
  findSuggestion,
  inferExpressionType,
  type AstRoot,
  type LintPass,
  type PassStore,
  storeKey,
} from "@sf-agentscript/language";
import { qualityRuleById, type AgentScriptQualityRuleId } from "./catalog.ts";
import {
  actionForInvocation,
  actionKey,
  asNode,
  asOptionalNode,
  buildQualityFacts,
  expressionsIn,
  namedEntries,
  scalarValue,
  statementArray,
} from "./facts.ts";
import type {
  CyclomaticComplexityMetric,
  QualityAstNode,
  QualityFacts,
  QualityFlowEdge,
  QualityProcedure,
} from "./types.ts";

export const QUALITY_SOURCE = "sf-agentscript-quality";
export const qualityFactsKey = storeKey<QualityFacts>("sf-agentscript-quality/facts");

export class QualityFactsPass implements LintPass {
  readonly id = qualityFactsKey;
  readonly description = "Builds stable Agent Script quality facts from the official AST";
  finalize(store: PassStore, root: AstRoot): void {
    store.set(qualityFactsKey, buildQualityFacts(root));
  }
}

export function createQualityRulePass(ruleId: AgentScriptQualityRuleId): LintPass {
  const definition = qualityRuleById(ruleId);
  if (!definition) throw new Error(`Unknown Agent Script quality rule: ${ruleId}`);
  return {
    id: storeKey(`sf-agentscript-quality/${ruleId}`),
    description: definition.description,
    requires: [qualityFactsKey],
    run(store) {
      const facts = store.get(qualityFactsKey);
      if (!facts || definition.severity === "metric") return;
      evaluateRule(ruleId, facts);
    },
  };
}

export function evaluateRule(ruleId: AgentScriptQualityRuleId, facts: QualityFacts): void {
  switch (ruleId) {
    case "unconditional-transition-cycle":
      addCycleFindings(
        facts,
        ruleId,
        (edge) => edge.kind === "deterministic_transition" && edge.unconditional,
      );
      return;
    case "conditional-transition-cycle":
      addConditionalCycleFindings(facts);
      return;
    case "subagent-delegation-cycle":
      addCycleFindings(facts, ruleId, (edge) => edge.kind === "subagent_delegation");
      return;
    case "variable-description-max-length":
      addVariableDescriptionLengthFindings(facts);
      return;
    case "unreachable-subagent":
      addUnreachableFindings(facts);
      return;
    case "unused-action":
      addUnusedActionFindings(facts);
      return;
    case "discarded-prompt-before-transition":
      addPreTransitionFindings(facts, true);
      return;
    case "action-before-transition":
      addPreTransitionFindings(facts, false);
      return;
    case "slot-filling-in-deterministic-action":
    case "deterministic-action-missing-input":
    case "deterministic-action-unknown-input":
    case "action-chain-too-deep":
    case "deterministic-action-input-type-mismatch":
    case "deterministic-action-output-type-mismatch":
      addInvocationFindings(ruleId, facts);
      return;
    case "list-element-type-mismatch":
      addListElementFindings(facts);
      return;
    case "non-numeric-list-index":
      addListIndexFindings(facts);
      return;
    case "slot-filled-variable-missing-description":
      addSlotDescriptionFindings(facts);
      return;
    case "instruction-template-syntax":
      // Projected from the official compiler/LSP diagnostics by the quality engine.
      return;
    case "prompt-template-output-flags":
      addPromptFlagFindings(facts);
      return;
    case "cyclomatic-complexity":
      return;
  }
}

function addCycleFindings(
  facts: QualityFacts,
  ruleId: AgentScriptQualityRuleId,
  include: (edge: QualityFlowEdge) => boolean,
): void {
  const edges = facts.edges.filter(include);
  const graph = graphFor(facts, edges);
  const cycles = graphlib.alg.findCycles(graph) as string[][];
  for (const cycle of cycles) {
    const path = cycle.length > 0 ? [...cycle, cycle[0]] : cycle;
    const node =
      facts.components.find((component) => component.id === cycle[0])?.node ?? facts.root;
    addDiagnostic(node, ruleId, `${qualityRuleById(ruleId)?.name}: ${path.join(" → ")}.`, {
      evidence: path,
    });
  }
}

function addConditionalCycleFindings(facts: QualityFacts): void {
  const deterministic = facts.edges.filter((edge) => edge.kind === "deterministic_transition");
  const allCycles = graphlib.alg.findCycles(graphFor(facts, deterministic)) as string[][];
  const unconditionalCycles = new Set(
    (
      graphlib.alg.findCycles(
        graphFor(
          facts,
          deterministic.filter((edge) => edge.unconditional),
        ),
      ) as string[][]
    ).map(cycleSignature),
  );
  for (const cycle of allCycles) {
    if (unconditionalCycles.has(cycleSignature(cycle))) continue;
    const cycleSet = new Set(cycle);
    const cycleEdges = deterministic.filter(
      (edge) => cycleSet.has(edge.from) && cycleSet.has(edge.to),
    );
    const conditions = Array.from(new Set(cycleEdges.flatMap((edge) => edge.conditions)));
    const path = cycle.length > 0 ? [...cycle, cycle[0]] : cycle;
    const node =
      facts.components.find((component) => component.id === cycle[0])?.node ?? facts.root;
    addDiagnostic(
      node,
      "conditional-transition-cycle",
      `Conditional transition loop: ${path.join(" → ")}.`,
      {
        evidence: conditions,
      },
    );
  }
}

function graphFor(facts: QualityFacts, edges: QualityFlowEdge[]) {
  const graph = new graphlib.Graph({ directed: true });
  for (const component of facts.components) graph.setNode(component.id);
  for (const edge of edges) graph.setEdge(edge.from, edge.to);
  return graph;
}

function cycleSignature(cycle: string[]): string {
  if (cycle.length === 0) return "";
  const rotations = cycle.map((_, index) =>
    [...cycle.slice(index), ...cycle.slice(0, index)].join("|"),
  );
  return rotations.sort()[0] ?? "";
}

function addVariableDescriptionLengthFindings(facts: QualityFacts): void {
  const maxLength = 255;
  for (const variable of facts.variables.values()) {
    if (!variable.description) continue;
    const length = Array.from(variable.description).length;
    if (length <= maxLength) continue;
    addDiagnostic(
      variable.node,
      "variable-description-max-length",
      `Variable '${variable.name}' description is ${length} characters; Salesforce allows at most ${maxLength}.`,
      { suggestion: `Shorten the description to ${maxLength} characters or fewer.` },
    );
  }
}

function addUnreachableFindings(facts: QualityFacts): void {
  const graph = graphFor(
    facts,
    facts.edges.filter((edge) => edge.kind !== "connected_agent_invocation"),
  );
  const starts = facts.components
    .filter((component) => component.isStart)
    .map((component) => component.id);
  const reachable = new Set<string>();
  for (const start of starts) {
    for (const node of graphlib.alg.preorder(graph, start) as string[]) reachable.add(node);
  }
  for (const component of facts.components) {
    if (component.isStart || component.kind === "connected_subagent" || component.unknownRouting)
      continue;
    if (!reachable.has(component.id)) {
      addDiagnostic(
        component.node,
        "unreachable-subagent",
        `Subagent '${component.name}' has no supported incoming flow edge.`,
      );
    }
  }
}

function addUnusedActionFindings(facts: QualityFacts): void {
  for (const action of facts.actions) {
    if (!facts.usedActions.has(actionKey(action.component.id, action.name))) {
      addDiagnostic(
        action.node,
        "unused-action",
        `Action '${action.name}' is defined but never invoked in '${action.component.name}'.`,
      );
    }
  }
}

function addPreTransitionFindings(facts: QualityFacts, prompt: boolean): void {
  const ruleId = prompt ? "discarded-prompt-before-transition" : "action-before-transition";
  for (const procedure of facts.procedures) {
    const transitionIndex = procedure.statements.findIndex(alwaysTransitions);
    if (transitionIndex <= 0) continue;
    for (const statement of procedure.statements.slice(0, transitionIndex)) {
      const matches = collectKinds(statement, prompt ? "Template" : "RunStatement");
      for (const node of matches) {
        addDiagnostic(
          node,
          ruleId,
          prompt
            ? "Prompt content is discarded by a guaranteed transition later on the same path."
            : "This action runs before a guaranteed transition; confirm its cost or side effect is intentional.",
        );
      }
    }
  }
}

function alwaysTransitions(statement: QualityAstNode): boolean {
  if (statement.__kind === "TransitionStatement")
    return statementArray(statement.clauses).some((c) => c.__kind === "ToClause");
  if (statement.__kind !== "IfStatement") return false;
  const body = statementArray(statement.body);
  const orelse = statementArray(statement.orelse);
  return (
    body.length > 0 &&
    orelse.length > 0 &&
    sequenceAlwaysTransitions(body) &&
    sequenceAlwaysTransitions(orelse)
  );
}

function sequenceAlwaysTransitions(statements: QualityAstNode[]): boolean {
  return statements.some(alwaysTransitions);
}

function collectKinds(value: unknown, kind: string, seen = new Set<object>()): QualityAstNode[] {
  if (!value || typeof value !== "object" || seen.has(value as object)) return [];
  seen.add(value as object);
  if (Array.isArray(value)) return value.flatMap((item) => collectKinds(item, kind, seen));
  const node = asNode(value);
  const result = node.__kind === kind ? [node] : [];
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith("__") || key === "parent") continue;
    result.push(...collectKinds(child, kind, seen));
  }
  return result;
}

function addInvocationFindings(ruleId: AgentScriptQualityRuleId, facts: QualityFacts): void {
  for (const invocation of facts.invocations) {
    const action = actionForInvocation(facts, invocation);
    if (!action) continue;
    const withClauses = invocation.statements.filter(
      (statement) => statement.__kind === "WithClause",
    );
    const setClauses = invocation.statements.filter(
      (statement) => statement.__kind === "SetClause",
    );
    const provided = new Set(withClauses.map((statement) => String(statement.param ?? "")));

    if (ruleId === "action-chain-too-deep" && invocation.depth > 1) {
      addDiagnostic(
        invocation.node,
        ruleId,
        `Action chain exceeds one supported follow-up at @actions.${invocation.actionName}.`,
      );
    }

    if (ruleId === "slot-filling-in-deterministic-action") {
      for (const clause of withClauses) {
        if (asOptionalNode(clause.value)?.__kind === "Ellipsis") {
          addDiagnostic(
            clause,
            ruleId,
            "Deterministic actions cannot use ellipsis slot filling. Bind a known value instead.",
          );
        }
      }
    }

    if (ruleId === "deterministic-action-unknown-input") {
      for (const clause of withClauses) {
        const param = String(clause.param ?? "");
        if (!param || action.inputs.has(param)) continue;
        const suggestion = findSuggestion(param, [...action.inputs.keys()]);
        addDiagnostic(clause, ruleId, `'${param}' is not an input of action '${action.name}'.`, {
          suggestion: suggestion ? `Use '${suggestion}'.` : undefined,
        });
      }
    }

    if (ruleId === "deterministic-action-missing-input") {
      for (const input of action.inputs.values()) {
        if (input.required && !input.hasDefault && !provided.has(input.name)) {
          addDiagnostic(
            invocation.node,
            ruleId,
            `Required input '${input.name}' is missing from deterministic action '${action.name}'.`,
          );
        }
      }
    }

    if (ruleId === "deterministic-action-input-type-mismatch") {
      for (const clause of withClauses) {
        const param = String(clause.param ?? "");
        const expected = action.inputs.get(param)?.type;
        if (!expected) continue;
        const actual = inferType(asOptionalNode(clause.value), facts);
        if (actual && !typesCompatible(expected, actual)) {
          addDiagnostic(
            clause,
            ruleId,
            `Input '${param}' expects '${expected}' but received '${actual}'.`,
          );
        }
      }
    }

    if (ruleId === "deterministic-action-output-type-mismatch") {
      for (const clause of setClauses) {
        const outputRef = decomposeAtMemberExpression(clause.value);
        const variableRef = decomposeAtMemberExpression(clause.target);
        if (outputRef?.namespace !== "outputs" || variableRef?.namespace !== "variables") continue;
        const outputType = action.outputs.get(outputRef.property)?.type;
        const variableType = facts.variables.get(variableRef.property)?.type;
        if (outputType && variableType && !typesCompatible(variableType, outputType)) {
          addDiagnostic(
            clause,
            ruleId,
            `Output '${outputRef.property}' is '${outputType}' but variable '${variableRef.property}' is '${variableType}'.`,
          );
        }
      }
    }
  }
}

function addListElementFindings(facts: QualityFacts): void {
  for (const variable of facts.variables.values()) {
    const elementType = listElementType(variable.type);
    if (!elementType || variable.defaultValue?.__kind !== "ListLiteral") continue;
    checkListElements(variable.defaultValue, elementType, variable.node);
  }
  for (const invocation of facts.invocations) {
    const action = actionForInvocation(facts, invocation);
    if (!action) continue;
    for (const clause of invocation.statements.filter((s) => s.__kind === "WithClause")) {
      const elementType = listElementType(action.inputs.get(String(clause.param ?? ""))?.type);
      const value = asOptionalNode(clause.value);
      if (elementType && value?.__kind === "ListLiteral")
        checkListElements(value, elementType, clause);
    }
  }
}

function checkListElements(
  list: QualityAstNode,
  expected: string,
  diagnosticParent: QualityAstNode,
): void {
  for (const element of Array.isArray(list.elements) ? list.elements.map(asNode) : []) {
    const actual = literalType(element);
    if (actual && !typesCompatible(expected, actual)) {
      addDiagnostic(
        diagnosticParent,
        "list-element-type-mismatch",
        `List expects '${expected}' values but contains '${actual}'.`,
      );
    }
  }
}

function addListIndexFindings(facts: QualityFacts): void {
  for (const expression of expressionsIn(facts.root)) {
    if (expression.__kind !== "SubscriptExpression") continue;
    const listRef = decomposeAtMemberExpression(expression.object);
    if (listRef?.namespace !== "variables") continue;
    const variableType = facts.variables.get(listRef.property)?.type;
    if (!listElementType(variableType)) continue;
    const indexType = inferType(asOptionalNode(expression.index), facts);
    if (indexType && !["number", "integer", "long"].includes(indexType.toLowerCase())) {
      addDiagnostic(
        expression,
        "non-numeric-list-index",
        `List index must be numeric, not '${indexType}'.`,
      );
    }
  }
}

function addSlotDescriptionFindings(facts: QualityFacts): void {
  for (const component of facts.components) {
    const reasoning = asOptionalNode(component.node.reasoning);
    for (const [, rawBinding] of namedEntries(reasoning?.actions)) {
      const binding = asNode(rawBinding);
      const ref = decomposeAtMemberExpression(binding.value);
      if (ref?.namespace !== "utils" || ref.property !== "setVariables") continue;
      for (const clause of statementArray(binding.statements)) {
        if (clause.__kind !== "WithClause" || asOptionalNode(clause.value)?.__kind !== "Ellipsis")
          continue;
        const variable = facts.variables.get(String(clause.param ?? ""));
        if (variable && !variable.description) {
          addDiagnostic(
            variable.node,
            "slot-filled-variable-missing-description",
            `Slot-filled variable '${variable.name}' needs a description that tells the LLM what to capture.`,
          );
        }
      }
    }
  }
}

function addPromptFlagFindings(facts: QualityFacts): void {
  for (const action of facts.actions) {
    if (!action.target?.startsWith("generatePromptResponse://")) continue;
    const rawOutput = namedEntries(action.node.outputs).find(
      ([name]) => name === "promptResponse",
    )?.[1];
    const output = asOptionalNode(rawOutput);
    if (!output) continue;
    const props = asOptionalNode(output.properties);
    const planner = scalarValue(props?.is_used_by_planner);
    const displayable = scalarValue(props?.is_displayable);
    if (planner !== true || displayable !== false) {
      addDiagnostic(
        output,
        "prompt-template-output-flags",
        "Prompt response should set is_used_by_planner: True and is_displayable: False for planner-only intermediate output.",
      );
    }
  }
}

function inferType(
  expression: QualityAstNode | undefined,
  facts: QualityFacts,
): string | undefined {
  if (!expression) return undefined;
  return (
    inferExpressionType(expression as never, (name) => facts.variables.get(name)?.type ?? null) ??
    literalType(expression) ??
    undefined
  );
}

function literalType(node: QualityAstNode): string | undefined {
  switch (node.__kind) {
    case "StringLiteral":
    case "TemplateExpression":
      return "string";
    case "NumberLiteral":
      return "number";
    case "BooleanLiteral":
      return "boolean";
    case "DictLiteral":
      return "object";
    case "ListLiteral":
      return "list";
    case "NoneLiteral":
      return undefined;
    default:
      return undefined;
  }
}

function listElementType(type: string | undefined): string | undefined {
  const match = /^list\[([^\]]+)\]$/i.exec(type ?? "");
  return match?.[1]?.toLowerCase();
}

function typesCompatible(expected: string, actual: string): boolean {
  const e = expected.toLowerCase();
  const a = actual.toLowerCase();
  if (e === a || e === "object" || a === "object") return true;
  if (e.startsWith("list[") && a === "list") return true;
  return false;
}

interface DiagnosticOptions {
  suggestion?: string;
  evidence?: string[];
}

function addDiagnostic(
  node: QualityAstNode,
  ruleId: AgentScriptQualityRuleId,
  message: string,
  options: DiagnosticOptions = {},
): void {
  const definition = qualityRuleById(ruleId);
  if (!definition || definition.severity === "metric") return;
  const range = diagnosticRange(node);
  attachDiagnostic(node as never, {
    range,
    message,
    severity: definition.severity === "high" || definition.severity === "moderate" ? 2 : 3,
    code: ruleId,
    source: QUALITY_SOURCE,
    data: {
      qualitySeverity: definition.severity,
      ruleName: definition.name,
      ...(options.suggestion ? { suggestion: options.suggestion } : {}),
      ...(options.evidence ? { evidence: options.evidence } : {}),
    },
  });
}

function diagnosticRange(node: QualityAstNode) {
  const own = node.__cst?.range;
  const parent = node.__cst?.node?.parent as
    | {
        type?: string;
        startRow?: number;
        startCol?: number;
        endRow?: number;
        endCol?: number;
      }
    | undefined;
  if (parent?.type === "mapping_element" && typeof parent.startRow === "number") {
    return {
      start: { line: parent.startRow, character: parent.startCol ?? 0 },
      end: {
        line: parent.endRow ?? own?.end.line ?? parent.startRow,
        character: parent.endCol ?? own?.end.character ?? 1,
      },
    };
  }
  return (
    own ?? {
      start: { line: 0, character: 0 },
      end: { line: 0, character: 1 },
    }
  );
}

export function calculateCyclomaticComplexity(facts: QualityFacts): CyclomaticComplexityMetric[] {
  return facts.procedures.map((procedure) => complexityFor(procedure));
}

function complexityFor(procedure: QualityProcedure): CyclomaticComplexityMetric {
  const decisions: CyclomaticComplexityMetric["decisions"] = [];
  collectStatementDecisions(procedure.statements, decisions);
  for (const expression of expressionsIn(procedure.node)) {
    if (expression.__kind === "TernaryExpression") {
      decisions.push({ kind: "ternary", range: expression.__cst?.range });
    } else if (expression.__kind === "BinaryExpression") {
      const operator = String(expression.operator ?? "");
      if (operator === "and" || operator === "or") {
        decisions.push({ kind: operator, range: expression.__cst?.range });
      }
    }
  }
  return {
    component: procedure.component.id,
    procedure: procedure.name,
    value: 1 + decisions.length,
    decisions,
  };
}

function collectStatementDecisions(
  statements: QualityAstNode[],
  output: CyclomaticComplexityMetric["decisions"],
): void {
  for (const statement of statements) {
    if (statement.__kind === "IfStatement") {
      output.push({ kind: "if", range: statement.__cst?.range });
      collectStatementDecisions(statementArray(statement.body), output);
      collectStatementDecisions(statementArray(statement.orelse), output);
    } else if (statement.__kind === "RunStatement") {
      collectStatementDecisions(statementArray(statement.body), output);
    }
  }
}
