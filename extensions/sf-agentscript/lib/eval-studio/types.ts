/* SPDX-License-Identifier: Apache-2.0 */
import type { EvaluatorCapability } from "../eval/evaluator-catalog.ts";
import type { EvidenceVerdict, EvalExecutionState } from "../eval/verdict.ts";

export interface StudioSeed {
  name: string;
  type?: string;
  value: unknown;
  provenance: string;
}

export interface StudioTurn {
  id: string;
  utterance: string;
  expected_behavior?: string;
}

export interface StudioEvaluator {
  id: string;
  type: string;
  label: string;
  capability: EvaluatorCapability;
  scope: "turn" | "scenario";
  turn_id?: string;
  expected?: string;
}

export interface StudioScenario {
  id: string;
  name: string;
  source_index: number;
  projectable: boolean;
  blocking_issues: string[];
  turns: StudioTurn[];
  evaluators: StudioEvaluator[];
  seeds: StudioSeed[];
  checkpoints: Array<{ name: string; expected?: string; turn_id?: string }>;
}

export interface StudioSuiteProjection {
  projectable: boolean;
  issues: string[];
  scenarios: StudioScenario[];
}

export type StudioRunScope = "suite" | "scenario" | "ad_hoc";
export type StudioRunClassification =
  "current" | "legacy" | "unavailable" | "ad_hoc" | "unassigned";

export interface StudioRunSummary {
  run_id: string;
  run_dir: string;
  classification: StudioRunClassification;
  scope: StudioRunScope;
  scenario_id?: string;
  suite_path?: string;
  agent_api_name?: string;
  target_org?: string;
  started?: string;
  completed?: string;
  execution_state?: EvalExecutionState;
  recorded_verdict?: EvidenceVerdict;
  current_verdict?: EvidenceVerdict;
  stale_source?: boolean;
  source_digest?: string;
  executed_digest?: string;
  bot_version_number?: number;
  result_summary?: string;
  errors?: number;
  p95_ms?: number;
  duration_ms?: number;
  evaluators?: Array<{
    scenario_id: string;
    id: string;
    is_pass?: boolean | null;
    score?: number | null;
    actual_value?: string;
    expected_value?: string;
    error_message?: string;
  }>;
  source_snapshot_preview?: string;
  executed_snapshot_preview?: string;
  turns?: Array<{
    scenario_id: string;
    turn_id: string;
    utterance?: string;
    agent_response?: string;
    topic?: string;
    invoked_actions?: string[];
    state_variables?: Record<string, unknown>;
  }>;
  error?: string;
}

export interface StudioSuiteSummary {
  id: string;
  path: string;
  agent_api_name?: string;
  canonical_agent_api_name?: string;
  agent_source_paths?: string[];
  identity_conflict?: string;
  display_name: string;
  designated: boolean;
  generated?: boolean;
  source_digest: string;
  modified_at?: string;
  source_preview?: string;
  projection: StudioSuiteProjection;
  runs: StudioRunSummary[];
}

export interface StudioInventory {
  suites: StudioSuiteSummary[];
  unassigned_runs: StudioRunSummary[];
  issues: string[];
}
