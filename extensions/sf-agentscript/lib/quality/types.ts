/* SPDX-License-Identifier: Apache-2.0 */
import type { AgentScriptRange } from "../types.ts";
import type { AgentScriptQualityRuleId, AgentScriptQualitySeverity } from "./catalog.ts";

export interface AgentScriptQualityFinding {
  rule_id: AgentScriptQualityRuleId;
  rule_name: string;
  severity: Exclude<AgentScriptQualitySeverity, "metric">;
  message: string;
  range: AgentScriptRange;
  line: number;
  suggestion?: string;
  evidence?: string[];
}

export interface CyclomaticComplexityMetric {
  component: string;
  procedure: string;
  value: number;
  decisions: Array<{ kind: "if" | "ternary" | "and" | "or"; range?: AgentScriptRange }>;
}

export interface AgentScriptQualityResult {
  ok: boolean;
  status: "clean" | "findings" | "partial" | "failed";
  findings: AgentScriptQualityFinding[];
  summary: { high: number; moderate: number; low: number; info: number };
  metrics: { cyclomatic_complexity: CyclomaticComplexityMetric[] };
  coverage: {
    total_rules: number;
    enabled_rules: number;
    disabled_rules: Array<{
      id: AgentScriptQualityRuleId;
      name: string;
      source: "global" | "override";
    }>;
  };
  suppressions: {
    applied: Array<{ rule_id: AgentScriptQualityRuleId; line: number; reason: string }>;
    invalid: Array<{ line: number; message: string }>;
    unused: Array<{ rule_id: AgentScriptQualityRuleId; line: number; reason: string }>;
  };
  failure_reason?: string;
}

export interface QualityComponent {
  id: string;
  kind: "start_agent" | "subagent" | "topic" | "connected_subagent";
  name: string;
  node: QualityAstNode;
  isStart: boolean;
  unknownRouting: boolean;
}

export interface QualityProcedure {
  component: QualityComponent;
  name: string;
  node: QualityAstNode;
  statements: QualityAstNode[];
}

export interface QualityParameter {
  name: string;
  type?: string;
  required: boolean;
  hasDefault: boolean;
  node: QualityAstNode;
}

export interface QualityAction {
  component: QualityComponent;
  name: string;
  node: QualityAstNode;
  target?: string;
  inputs: Map<string, QualityParameter>;
  outputs: Map<string, QualityParameter>;
}

export interface QualityInvocation {
  component: QualityComponent;
  procedure?: QualityProcedure;
  actionName: string;
  node: QualityAstNode;
  statements: QualityAstNode[];
  depth: number;
}

export type QualityEdgeKind =
  | "deterministic_transition"
  | "planner_transition"
  | "subagent_delegation"
  | "connected_agent_invocation";

export interface QualityFlowEdge {
  from: string;
  to: string;
  kind: QualityEdgeKind;
  node: QualityAstNode;
  conditions: string[];
  unconditional: boolean;
}

export interface QualityVariable {
  name: string;
  type?: string;
  node: QualityAstNode;
  description?: string;
  defaultValue?: QualityAstNode;
}

export interface QualityFacts {
  root: QualityAstNode;
  components: QualityComponent[];
  procedures: QualityProcedure[];
  actions: QualityAction[];
  invocations: QualityInvocation[];
  edges: QualityFlowEdge[];
  variables: Map<string, QualityVariable>;
  usedActions: Set<string>;
}

export interface QualityAstNode {
  __kind?: string;
  __cst?: {
    range?: AgentScriptRange;
    node?: { text?: string; parent?: unknown };
  };
  __diagnostics?: unknown[];
  [key: string]: unknown;
}
