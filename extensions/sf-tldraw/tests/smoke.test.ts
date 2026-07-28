/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { collectManagerDetailActions } from "../../../lib/common/manager-actions.ts";

type Listener = (...args: unknown[]) => void;

describe("sf-tldraw extension", () => {
  it("exports a default extension function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });

  it("registers one command, one family tool, and Manager actions", async () => {
    const mod = await import("../index.ts");
    const listeners = new Map<string, Listener[]>();
    const pi = {
      on: vi.fn((event: string, handler: Listener) => {
        listeners.set(event, [...(listeners.get(event) ?? []), handler]);
      }),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: {
        on: (event: string, handler: Listener) => {
          listeners.set(event, [...(listeners.get(event) ?? []), handler]);
          return () => undefined;
        },
        emit: (event: string, payload: unknown) => {
          for (const handler of listeners.get(event) ?? []) handler(payload);
        },
      },
    };
    mod.default(pi as never);
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(pi.registerTool.mock.calls[0]?.[0]?.name).toBe("tldraw_canvas");
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-tldraw")?.[1];
    expect(
      command?.getArgumentCompletions?.("doc")?.map((item: { value: string }) => item.value),
    ).toEqual(["documents"]);
    expect(command?.getArgumentCompletions?.("status x")).toBeNull();
    expect(
      collectManagerDetailActions(pi as never, "sf-tldraw").map((action) => action.id),
    ).toEqual(["status", "documents", "cheatsheet", "help"]);
  });

  it("uses one shared observation for the status command", async () => {
    vi.resetModules();
    const runtime = await import("../lib/runtime-client.ts");
    const surface = await import("../lib/runtime-surface.ts");
    const observation = {
      status: {
        kind: "no-open-document" as const,
        openDocuments: 0,
        capabilities: {
          apiContract: "canvas-api-v1.12" as const,
          contractProof: "readme" as const,
          nativeDocumentCreation: true as const,
          documents: true as const,
          search: true as const,
          execute: true as const,
          screenshot: true as const,
        },
        skillReadiness: { kind: "ready" as const, managed: true, message: "ready" },
      },
      documents: [],
    };
    const observe = vi
      .spyOn(runtime.TldrawRuntimeClient.prototype, "observe")
      .mockResolvedValue(observation);
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const registerCommand = vi.fn();
    const mod = await import("../index.ts");
    mod.default({
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCommand,
      events: { on: vi.fn() },
    } as never);
    const command = registerCommand.mock.calls.find(([name]) => name === "sf-tldraw")?.[1];
    await command.handler("status", {
      cwd: process.cwd(),
      hasUI: false,
      ui: { notify: vi.fn() },
    });
    expect(observe).toHaveBeenCalledOnce();
    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining(surface.formatTldrawRuntimeStatus(observation.status)),
    );
    vi.restoreAllMocks();
  });

  it("keeps session_start cache-only with no deferred verification", async () => {
    vi.resetModules();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const handlers = new Map<string, Listener>();
    const mod = await import("../index.ts");
    mod.default({
      on: vi.fn((event: string, handler: Listener) => handlers.set(event, handler)),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: { on: vi.fn() },
    } as never);
    await handlers.get("session_start")?.({}, { signal: new AbortController().signal });
    expect(fetchMock).not.toHaveBeenCalled();
    await handlers.get("session_shutdown")?.();
    vi.unstubAllGlobals();
  });
});
