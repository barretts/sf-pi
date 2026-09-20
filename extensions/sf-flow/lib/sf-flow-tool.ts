/* SPDX-License-Identifier: Apache-2.0 */
/** Single SF Flow family tool registration. */

import { StringEnum } from "@earendil-works/pi-ai";
import {
  withFileMutationQueue,
  type ExtensionAPI,
  type Theme,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { connectSalesforce } from "../../../lib/common/sf-conn/index.ts";
import { resolveFlowFile } from "./analyzer.ts";
import { flowErrorResult } from "./errors.ts";
import { resolveFlowWorkspace } from "./project.ts";
import { applyFlowQuickFix } from "./quick-fixes.ts";
import { renderFlowResult } from "./render.ts";
import type { SfFlowParams, SfFlowSessionState, ToolResult } from "./types.ts";
import {
  buildAuthoringPlan,
  diagnoseFile,
  discoverFlowTests,
  qualityRules,
  flowInspect,
  getFlowTestResult,
  orgPreflight,
  planFlowTests,
  projectScan,
  rerunFlowTests,
  runFlowTests,
  status,
  validateFlowCheck,
} from "./operations.ts";

export const SF_FLOW_TOOL_NAME = "sf_flow";
export const SF_FLOW_ACTIONS = [
  "status",
  "org.preflight",
  "project.scan",
  "flow.inspect",
  "author.plan",
  "diagnose.file",
  "quality.rules",
  "fix.apply",
  "validate.check",
  "test.discover",
  "test.plan",
  "test.run",
  "test.result",
  "test.rerun",
] as const;

const Params = Type.Object({
  action: StringEnum(SF_FLOW_ACTIONS, { description: "SF Flow lifecycle action." }),
  target_org: Type.Optional(Type.String({ description: "Salesforce org alias or username." })),
  workspace: Type.Optional(Type.String({ description: "SFDX workspace path. Defaults to cwd." })),
  file: Type.Optional(
    Type.String({ description: "Workspace-contained .flow-meta.xml or .flow file." }),
  ),
  intent: Type.Optional(
    Type.String({ description: "Natural-language authoring intent for author.plan." }),
  ),
  flow_type: Type.Optional(
    StringEnum(
      [
        "screen",
        "autolaunched",
        "record-triggered",
        "schedule-triggered",
        "platform-event-triggered",
      ] as const,
      { description: "Explicit core Flow family when intent alone is ambiguous." },
    ),
  ),
  object: Type.Optional(Type.String({ description: "Triggering Salesforce object API name." })),
  event: Type.Optional(Type.String({ description: "Triggering platform event API name." })),
  trigger_timing: Type.Optional(
    StringEnum(["before-save", "after-save", "before-delete"] as const, {
      description: "Record-triggered transaction timing.",
    }),
  ),
  record_event: Type.Optional(
    StringEnum(["create", "update", "create-and-update", "delete"] as const, {
      description: "Record operation that starts a record-triggered Flow.",
    }),
  ),
  flow_names: Type.Optional(
    Type.Array(Type.String(), { description: "Flow API names containing Flow tests." }),
  ),
  tests: Type.Optional(
    Type.Array(Type.String(), { description: "Targeted Flow tests as FlowApiName.TestName." }),
  ),
  run_id: Type.Optional(Type.String({ description: "Flow test run ID for test.result." })),
  fix_id: Type.Optional(
    Type.String({ description: "Source-bound quick-fix ID returned by diagnose.file." }),
  ),
  source_version: Type.Optional(
    Type.String({ description: "Exact source version returned by diagnose.file." }),
  ),
  wait_seconds: Type.Optional(
    Type.Number({
      minimum: 0,
      maximum: 300,
      description: "Bounded Flow test wait. Default 60 seconds.",
    }),
  ),
  include_coverage: Type.Optional(
    Type.Boolean({ description: "Request supported test-run coverage evidence." }),
  ),
  report_formats: Type.Optional(
    Type.Array(StringEnum(["json", "markdown", "junit", "tap"] as const), {
      description: "Optional Flow test report artifact formats.",
    }),
  ),
  quality_profile: Type.Optional(
    StringEnum(["generation", "review", "audit"] as const, {
      description: "Quality rule profile for diagnose.file or quality.rules.",
    }),
  ),
  limit: Type.Optional(
    Type.Number({
      minimum: 1,
      maximum: 100,
      description: "Maximum inline items. Artifacts remain complete.",
    }),
  ),
});

export function registerSfFlowTool(pi: ExtensionAPI): void {
  const state: SfFlowSessionState = {};
  pi.registerTool<typeof Params>({
    name: SF_FLOW_TOOL_NAME,
    label: "SF Flow",
    description:
      "Lean Salesforce Flow lifecycle tool: core-five authoring plans, project scan, local diagnostics and Mermaid topology, source-bound safe quick fixes, API-native check-only validation, and targeted Flow tests.",
    promptSnippet:
      "Plan, inspect, diagnose, apply source-bound safe fixes, validate, and test Salesforce Flow metadata with compact evidence and Mermaid topology.",
    promptGuidelines: [
      "Use sf_flow before generic XML reasoning for Flow metadata; normal Pi file tools own source edits.",
      "Pass target_org to sf_flow author.plan when custom fields, actions, or subflow contracts must be grounded before authoring; omitted targets keep planning local.",
      "Use sf_flow diagnose.file before validate.check; check-only validation never deploys or activates a Flow.",
      "Use sf_flow fix.apply only with a current fix_id and source_version returned by diagnose.file; stale or unsupported fixes are refused.",
      "Use sf_flow targeted Flow tests only after an eligible Flow test exists in the org.",
      "Read extensions/sf-flow/AGENT_GUIDE.md for core Flow families, lifecycle ordering, and proof boundaries.",
    ],
    parameters: Params,
    renderCall: (args, theme) => renderCall(args as SfFlowParams, theme),
    renderResult: (result, options, theme) =>
      renderFlowResult(result as ToolResult, options, theme),
    async execute(_id, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as SfFlowParams;
      try {
        if (params.action === "project.scan") return projectScan(params, ctx.cwd);
        if (params.action === "flow.inspect") return flowInspect(params, ctx.cwd);
        if (params.action === "author.plan" && !params.target_org) {
          return buildAuthoringPlan(params, ctx.cwd);
        }
        if (params.action === "diagnose.file") return diagnoseFile(params, ctx.cwd);
        if (params.action === "quality.rules") return qualityRules(params);
        if (params.action === "fix.apply") {
          if (!params.file) throw new Error("file is required for fix.apply");
          const workspace = await resolveFlowWorkspace(params.workspace, ctx.cwd);
          const file = await resolveFlowFile(params.file, workspace);
          return withFileMutationQueue(file.absolute, () => applyFlowQuickFix(params, ctx.cwd));
        }

        const session = await connectSalesforce({
          cwd: ctx.cwd,
          targetOrg: params.target_org,
          signal,
        });
        switch (params.action) {
          case "author.plan":
            return buildAuthoringPlan(params, ctx.cwd, session);
          case "status":
            return status(session, params);
          case "org.preflight":
            return orgPreflight(session, params);
          case "validate.check":
            return validateFlowCheck(params, ctx.cwd, session, {}, signal);
          case "test.discover":
            return discoverFlowTests(params, session);
          case "test.plan":
            return planFlowTests(params, session);
          case "test.run":
            return runFlowTests(params, session, state);
          case "test.result":
            return getFlowTestResult(params, session, state);
          case "test.rerun":
            return rerunFlowTests(params, session, state);
          default:
            throw new Error(`Unsupported sf_flow action: ${params.action}`);
        }
      } catch (error) {
        return flowErrorResult(params, error);
      }
    },
  });
}

function renderCall(args: SfFlowParams, theme: Theme): Text {
  const label = theme.fg("toolTitle", theme.bold("🌊 SF Flow "));
  const scope = args.file ?? args.flow_names?.[0] ?? args.target_org;
  return new Text(
    label + theme.fg("muted", args.action) + (scope ? theme.fg("dim", ` · ${scope}`) : ""),
    0,
    0,
  );
}
