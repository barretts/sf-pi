/* SPDX-License-Identifier: Apache-2.0 */
/** Background coordinator for Studio-owned Suite and Scenario Runs. */

import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { injectResolvedAgentIds, substitutePlaceholders } from "../eval/active-ids.ts";
import { evalProjectRoot, newRunId } from "../eval/persist.ts";
import { recordRunInIndex, runEval, type RunEvalResult } from "../eval/orchestrator.ts";
import type { EvalSpec } from "../eval/types.ts";
import { hashEvalSpec } from "../release-contract.ts";
import { projectEvalSuite, selectScenarioSpec } from "./projectability.ts";
import { acquireStudioRunLease } from "./run-lease.ts";
import { applyRunSeedOverrides, type StudioRunTarget } from "./run-target.ts";

interface ActiveRun {
  run_id: string;
  controller: AbortController;
}

const activeByProject = new Map<string, ActiveRun>();

export interface StudioTaskResult {
  title: string;
  body: string;
  severity: "success" | "warning" | "error";
}

export interface StartStudioRunInput {
  suite_path: string;
  expected_source_digest: string;
  scenario_id?: string;
  target: StudioRunTarget;
}

export async function startStudioRun(
  pi: ExtensionAPI,
  cwd: string,
  input: StartStudioRunInput,
): Promise<string> {
  const projectRoot = evalProjectRoot(cwd);
  const runId = newRunId();
  const lease = await acquireStudioRunLease(projectRoot, runId);
  const controller = new AbortController();
  activeByProject.set(projectRoot, { run_id: runId, controller });

  void executeStudioRun(projectRoot, runId, input, controller.signal, lease.owner_token)
    .then((result) => {
      appendCompletion(pi, {
        title: `Agent Script Eval ${result.metadata.evidence_verdict ?? "completed"}`,
        body: [
          `Run: ${result.run_id}`,
          `Scope: ${input.scenario_id ? `Scenario ${input.scenario_id}` : "Suite"}`,
          `Execution: ${result.metadata.execution_state}`,
          `Evidence: ${result.metadata.evidence_verdict}`,
          `Artifacts: ${result.run_dir}`,
        ].join("\n"),
        severity: result.metadata.evidence_verdict === "passed" ? "success" : "warning",
      });
    })
    .catch((error) => {
      appendCompletion(pi, {
        title: "Agent Script Eval did not complete",
        body: `Run: ${runId}\n${error instanceof Error ? error.message : String(error)}`,
        severity: controller.signal.aborted ? "warning" : "error",
      });
    })
    .finally(async () => {
      activeByProject.delete(projectRoot);
      await lease.release();
    });

  return runId;
}

async function executeStudioRun(
  projectRoot: string,
  runId: string,
  input: StartStudioRunInput,
  signal: AbortSignal,
  ownerToken: string,
): Promise<RunEvalResult> {
  const source = JSON.parse(await readFile(input.suite_path, "utf8")) as EvalSpec;
  if (hashEvalSpec(source) !== input.expected_source_digest) {
    throw new Error(
      "Eval Suite changed after Run Target review. Reopen Studio and review it again.",
    );
  }
  const projection = projectEvalSuite(source);
  if (!projection.projectable) {
    throw new Error(
      `Eval Suite is no longer Studio-projectable: ${[
        ...projection.issues,
        ...projection.scenarios.flatMap((scenario) => scenario.blocking_issues),
      ].join("; ")}`,
    );
  }
  if (
    input.scenario_id &&
    !projection.scenarios.some(
      (scenario) => scenario.id === input.scenario_id && scenario.projectable,
    )
  ) {
    throw new Error(`Scenario '${input.scenario_id}' is no longer Studio-projectable.`);
  }
  const overridden = applyRunSeedOverrides(source, input.target.seed_overrides);
  const selected = input.scenario_id
    ? selectScenarioSpec(overridden, input.scenario_id)
    : overridden;
  const substituted = substitutePlaceholders(selected, {
    active: input.target.resolved,
    latest: input.target.resolved,
  });
  const executed = injectResolvedAgentIds(substituted, input.target.resolved, {
    overwrite: true,
  }).spec;
  const result = await runEval({
    conn: input.target.conn,
    targetOrg: input.target.target_org,
    spec: executed,
    sourceSpec: source,
    agentApiName: input.target.agent_api_name,
    resolvedTarget: input.target.resolved,
    versionResolution: input.target.version_resolution,
    version: input.target.version,
    acknowledgeInactiveVersion: input.target.acknowledge_inactive_version,
    unverifiedEvaluatorAcknowledged: input.target.acknowledge_unverified_evaluators,
    coordinator: { kind: "studio", owner_token: ownerToken },
    tracesMode: input.target.traces_mode,
    concurrency: input.target.concurrency,
    cwd: projectRoot,
    specPath: input.suite_path,
    runId,
    runScope: input.scenario_id ? "scenario" : "suite",
    scenarioId: input.scenario_id,
    signal,
  });
  await recordRunInIndex(projectRoot, runId);
  return result;
}

export async function startStudioBackgroundTask(
  pi: ExtensionAPI,
  cwd: string,
  label: string,
  task: (signal: AbortSignal, ownerToken: string) => Promise<StudioTaskResult>,
): Promise<string> {
  const projectRoot = evalProjectRoot(cwd);
  const runId = `${label}-${Date.now()}`;
  const lease = await acquireStudioRunLease(projectRoot, runId);
  const controller = new AbortController();
  activeByProject.set(projectRoot, { run_id: runId, controller });
  void task(controller.signal, lease.owner_token)
    .then((result) => appendCompletion(pi, result))
    .catch((error) =>
      appendCompletion(pi, {
        title: `${label} did not complete`,
        body: error instanceof Error ? error.message : String(error),
        severity: controller.signal.aborted ? "warning" : "error",
      }),
    )
    .finally(async () => {
      activeByProject.delete(projectRoot);
      await lease.release();
    });
  return runId;
}

export function activeStudioRun(cwd: string): string | undefined {
  return activeByProject.get(evalProjectRoot(cwd))?.run_id;
}

export function interruptStudioRuns(): void {
  for (const active of activeByProject.values()) active.controller.abort("interrupted");
}

export function cancelStudioRun(cwd: string, runId?: string): boolean {
  const active = activeByProject.get(evalProjectRoot(cwd));
  if (!active || (runId && active.run_id !== runId)) return false;
  active.controller.abort();
  return true;
}

function appendCompletion(
  pi: ExtensionAPI,
  data: { title: string; body: string; severity: "success" | "warning" | "error" },
): void {
  pi.appendEntry("sf-agentscript-eval-studio-output", data);
}
