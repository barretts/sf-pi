/* SPDX-License-Identifier: Apache-2.0 */
/** Registered-family dispatch contract for private action extraction. */
import { beforeEach, describe, expect, test, vi } from "vitest";

function envelope(marker: string) {
  return Promise.resolve({
    content: [{ type: "text" as const, text: marker }],
    details: { ok: true, marker },
  });
}

const preview = vi.hoisted(() => ({
  start: vi.fn((...args: unknown[]) => (void args, envelope("preview.start"))),
  send: vi.fn((...args: unknown[]) => (void args, envelope("preview.send"))),
  end: vi.fn((...args: unknown[]) => (void args, envelope("preview.end"))),
  endAll: vi.fn((...args: unknown[]) => (void args, envelope("preview.end_all"))),
  trace: vi.fn((...args: unknown[]) => (void args, envelope("preview.trace"))),
  cleanup: vi.fn((...args: unknown[]) => (void args, envelope("preview.cleanup"))),
}));
const evalActions = vi.hoisted(() => ({
  run: vi.fn((...args: unknown[]) => (void args, envelope("eval.run"))),
  runRelease: vi.fn((...args: unknown[]) => (void args, envelope("eval.run_release"))),
  getFailure: vi.fn((...args: unknown[]) => (void args, envelope("eval.get_failure"))),
  trace: vi.fn((...args: unknown[]) => (void args, envelope("eval.trace"))),
  resolve: vi.fn((...args: unknown[]) => (void args, envelope("eval.resolve_active"))),
  generate: vi.fn((...args: unknown[]) => (void args, envelope("eval.generate_spec"))),
}));
const lifecycle = vi.hoisted(() => ({
  publish: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.publish"))),
  activate: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.activate"))),
  deactivate: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.deactivate"))),
  list: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.list_versions"))),
  status: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.agent_user_status"))),
  diagnose: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.diagnose_agent_user"))),
  provision: vi.fn((...args: unknown[]) => (void args, envelope("lifecycle.provision_agent_user"))),
}));

vi.mock("../lib/preview/actions/session.ts", () => ({
  actionStart: preview.start,
  actionSend: preview.send,
  actionEnd: preview.end,
}));
vi.mock("../lib/preview/actions/maintenance.ts", () => ({
  actionEndAll: preview.endAll,
  actionCleanup: preview.cleanup,
}));
vi.mock("../lib/preview/actions/trace.ts", () => ({ actionTrace: preview.trace }));
vi.mock("../lib/eval/actions/run.ts", () => ({
  actionRun: evalActions.run,
  actionRunRelease: evalActions.runRelease,
}));
vi.mock("../lib/eval/actions/evidence.ts", () => ({
  actionGetFailure: evalActions.getFailure,
  actionTrace: evalActions.trace,
  readPublicFailures: vi.fn(),
}));
vi.mock("../lib/eval/actions/generation.ts", () => ({
  actionResolveActive: evalActions.resolve,
  actionGenerateSpec: evalActions.generate,
}));
vi.mock("../lib/lifecycle/actions/release.ts", () => ({
  actionPublish: lifecycle.publish,
  actionActivate: lifecycle.activate,
  actionDeactivate: lifecycle.deactivate,
  actionListVersions: lifecycle.list,
}));
vi.mock("../lib/lifecycle/actions/agent-user.ts", () => ({
  actionAgentUserStatus: lifecycle.status,
  actionDiagnoseAgentUser: lifecycle.diagnose,
  actionProvisionAgentUser: lifecycle.provision,
}));

import { registerEvalTool } from "../lib/eval-tool.ts";
import { registerLifecycleTool } from "../lib/lifecycle-tool.ts";
import { registerPreviewTool } from "../lib/preview-tool.ts";

interface CapturedTool {
  execute: (
    id: string,
    params: Record<string, unknown>,
    signal: AbortSignal,
    onUpdate: (update: unknown) => void,
    context: { cwd: string },
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
}

function capture(register: (pi: never) => void): CapturedTool {
  let tool: CapturedTool | undefined;
  register({
    registerTool(definition: unknown) {
      tool = definition as CapturedTool;
    },
  } as never);
  return tool!;
}

beforeEach(() => {
  vi.clearAllMocks();
});

async function execute(
  tool: CapturedTool,
  params: Record<string, unknown>,
  signal: AbortSignal,
  updates: unknown[],
) {
  const result = await tool.execute("contract", params, signal, (update) => updates.push(update), {
    cwd: "/workspace",
  });
  expect(result.content[0]?.text).toContain("⏱️ Timing");
  expect(result.details.timings).toBeDefined();
  return result;
}

describe("registered private-action dispatch", () => {
  test("preview dispatch preserves action routing, callbacks, signals, and timing ownership", async () => {
    preview.send.mockImplementationOnce((...args: unknown[]) => {
      const onUpdate = args[2] as ((update: unknown) => void) | undefined;
      onUpdate?.({ content: [{ type: "text", text: "preview-progress" }], details: {} });
      return envelope("preview.send");
    });
    const tool = capture(registerPreviewTool as (pi: never) => void);
    const controller = new AbortController();
    const updates: unknown[] = [];
    const observedCalls: unknown[][] = [];
    const cases = [
      [{ action: "start", agent_file: "A.agent" }, preview.start, "preview.start"],
      [{ action: "send", message: "hello" }, preview.send, "preview.send"],
      [{ action: "end" }, preview.end, "preview.end"],
      [{ action: "end_all" }, preview.endAll, "preview.end_all"],
      [{ action: "trace", session_id: "S", plan_id: "P" }, preview.trace, "preview.trace"],
      [{ action: "cleanup" }, preview.cleanup, "preview.cleanup"],
    ] as const;
    for (const [params, mock, marker] of cases) {
      const result = await execute(tool, params, controller.signal, updates);
      expect(result.details.marker).toBe(marker);
      expect(mock).toHaveBeenCalledOnce();
      observedCalls.push([...(mock.mock.calls[0] as unknown[])]);
      mock.mockClear();
    }
    expect(observedCalls[0]?.[3]).toBe(controller.signal);
    expect(observedCalls[1]?.[4]).toBe(controller.signal);
    expect(observedCalls[2]?.[2]).toBe(controller.signal);
    expect(observedCalls[3]?.[2]).toBe(controller.signal);
    expect(observedCalls[4]?.[2]).toBe(controller.signal);
    expect(updates).toContainEqual(
      expect.objectContaining({ content: [{ type: "text", text: "preview-progress" }] }),
    );
  });

  test("eval dispatch preserves all six action routes and progress/signal plumbing", async () => {
    evalActions.run.mockImplementationOnce((...args: unknown[]) => {
      const onUpdate = args[2] as ((update: unknown) => void) | undefined;
      onUpdate?.({ content: [{ type: "text", text: "eval-progress" }], details: {} });
      return envelope("eval.run");
    });
    const tool = capture(registerEvalTool as (pi: never) => void);
    const controller = new AbortController();
    const updates: unknown[] = [];
    const observedCalls: unknown[][] = [];
    const cases = [
      [{ action: "run", spec: { tests: [] } }, evalActions.run, "eval.run"],
      [
        { action: "run_release", agent_file: "A.agent", agent_api_name: "A" },
        evalActions.runRelease,
        "eval.run_release",
      ],
      [{ action: "get_failure" }, evalActions.getFailure, "eval.get_failure"],
      [{ action: "trace", session_id: "S", plan_id: "P" }, evalActions.trace, "eval.trace"],
      [
        { action: "resolve_active", agent_api_name: "A" },
        evalActions.resolve,
        "eval.resolve_active",
      ],
      [
        { action: "generate_spec", agent_file: "A.agent" },
        evalActions.generate,
        "eval.generate_spec",
      ],
    ] as const;
    for (const [params, mock, marker] of cases) {
      const result = await execute(tool, params, controller.signal, updates);
      expect(result.details.marker).toBe(marker);
      expect(mock).toHaveBeenCalledOnce();
      observedCalls.push([...(mock.mock.calls[0] as unknown[])]);
      mock.mockClear();
    }
    expect(observedCalls[0]?.[4]).toBe(controller.signal);
    expect(observedCalls[1]?.[4]).toBe(controller.signal);
    expect(observedCalls[3]?.[2]).toBe(controller.signal);
    expect(observedCalls[4]?.[1]).toBe(controller.signal);
    expect(updates).toContainEqual(
      expect.objectContaining({ content: [{ type: "text", text: "eval-progress" }] }),
    );
  });

  test("lifecycle dispatch preserves release and Agent User routes with stream/signal plumbing", async () => {
    lifecycle.publish.mockImplementationOnce((...args: unknown[]) => {
      const stream = args[2] as (message: string) => void;
      stream("lifecycle-progress");
      return envelope("lifecycle.publish");
    });
    const tool = capture(registerLifecycleTool as (pi: never) => void);
    const controller = new AbortController();
    const updates: unknown[] = [];
    const observedCalls: unknown[][] = [];
    const cases = [
      [{ action: "publish", agent_file: "A.agent" }, lifecycle.publish, "lifecycle.publish"],
      [{ action: "activate", agent_api_name: "A" }, lifecycle.activate, "lifecycle.activate"],
      [{ action: "deactivate", agent_api_name: "A" }, lifecycle.deactivate, "lifecycle.deactivate"],
      [{ action: "list_versions", agent_api_name: "A" }, lifecycle.list, "lifecycle.list_versions"],
      [
        { action: "agent_user_status", agent_file: "A.agent" },
        lifecycle.status,
        "lifecycle.agent_user_status",
      ],
      [
        { action: "diagnose_agent_user", agent_file: "A.agent" },
        lifecycle.diagnose,
        "lifecycle.diagnose_agent_user",
      ],
      [
        { action: "provision_agent_user", agent_file: "A.agent" },
        lifecycle.provision,
        "lifecycle.provision_agent_user",
      ],
    ] as const;
    for (const [params, mock, marker] of cases) {
      const result = await execute(tool, params, controller.signal, updates);
      expect(result.details.marker).toBe(marker);
      expect(mock).toHaveBeenCalledOnce();
      observedCalls.push([...(mock.mock.calls[0] as unknown[])]);
      mock.mockClear();
    }
    expect(observedCalls[0]?.[4]).toBe(controller.signal);
    expect(observedCalls[1]?.[2]).toBe(controller.signal);
    expect(observedCalls[2]?.[1]).toBe(controller.signal);
    expect(observedCalls[3]?.[1]).toBe(controller.signal);
    expect(observedCalls[6]?.[3]).toBe(controller.signal);
    expect(updates).toContainEqual(
      expect.objectContaining({ content: [{ type: "text", text: "lifecycle-progress" }] }),
    );
  });
});
