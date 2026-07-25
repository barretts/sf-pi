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

  it("keeps session_start cache-only before the deferred verification window", async () => {
    vi.useFakeTimers();
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
    vi.useRealTimers();
  });
});
