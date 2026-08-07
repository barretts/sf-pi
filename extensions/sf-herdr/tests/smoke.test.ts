/* SPDX-License-Identifier: Apache-2.0 */
/** Public extension seams for command routing and gated planner registration. */
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import {
  SF_PI_MANAGER_OPEN_EVENT,
  type SfPiManagerOpenRequest,
} from "../../../lib/common/manager-deep-link.ts";

function eventBus() {
  const listeners = new Map<string, Array<(payload: unknown) => void>>();
  return {
    on(eventName: string, listener: (payload: unknown) => void) {
      listeners.set(eventName, [...(listeners.get(eventName) ?? []), listener]);
    },
    emit(eventName: string, payload: unknown) {
      for (const listener of listeners.get(eventName) ?? []) listener(payload);
    },
  };
}

function fakeCommandContext(): ExtensionCommandContext {
  return {
    hasUI: true,
    cwd: "/tmp/sf-pi-test",
    ui: { notify: vi.fn(), setStatus: vi.fn() },
  } as unknown as ExtensionCommandContext;
}

describe("sf-herdr", () => {
  it("registers the slash command before lifecycle wiring", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(() => {
        throw new Error("lifecycle registration failed");
      }),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
    };

    expect(() => mod.default(pi as never)).toThrow("lifecycle registration failed");
    expect(pi.registerCommand).toHaveBeenCalledWith("sf-herdr", expect.any(Object));
  });

  it("registers only the current session and result-normalization lifecycle hooks", async () => {
    const mod = await import("../index.ts");
    const pi = {
      events: eventBus(),
      on: vi.fn(),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
    };

    mod.default(pi as never);
    expect(pi.on.mock.calls.map(([name]) => name)).toEqual(["session_start", "tool_result"]);
  });

  it("normalizes the current pane-run empty-success result through the extension seam", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown) => unknown>();
    const pi = {
      events: eventBus(),
      on: vi.fn((name: string, handler: (event: unknown) => unknown) =>
        handlers.set(name, handler),
      ),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
    };

    mod.default(pi as never);
    const result = handlers.get("tool_result")?.({
      type: "tool_result",
      toolName: "herdr_pane",
      input: { action: "run", pane: "pane-1", command: "npm test" },
      content: [{ type: "text", text: "Expected JSON output from herdr pane run pane-1 npm test" }],
      details: {},
      isError: true,
    });

    expect(result).toEqual({
      content: [{ type: "text", text: "Submitted command to Herdr pane pane-1." }],
      isError: false,
    });
  });

  it("registers sf_herdr_plan at session startup only with Herdr env and all current tools active", async () => {
    const previousEnv = {
      HERDR_ENV: process.env.HERDR_ENV,
      HERDR_PANE_ID: process.env.HERDR_PANE_ID,
    };
    process.env.HERDR_ENV = "1";
    process.env.HERDR_PANE_ID = "opaque-current-pane";
    try {
      const mod = await import("../index.ts");
      const handlers = new Map<string, () => Promise<void>>();
      const registerTool = vi.fn();
      const pi = {
        events: eventBus(),
        on: vi.fn((name: string, handler: () => Promise<void>) => handlers.set(name, handler)),
        registerCommand: vi.fn(),
        registerTool,
        getActiveTools: vi.fn(() => ["herdr_layout", "herdr_pane"]),
      };

      mod.default(pi as never);
      await handlers.get("session_start")?.();
      expect(registerTool).not.toHaveBeenCalled();

      pi.getActiveTools.mockReturnValue(["herdr_layout", "herdr_pane", "herdr_agent"]);
      await handlers.get("session_start")?.();
      expect(registerTool).toHaveBeenCalledWith(expect.objectContaining({ name: "sf_herdr_plan" }));
    } finally {
      if (previousEnv.HERDR_ENV === undefined) delete process.env.HERDR_ENV;
      else process.env.HERDR_ENV = previousEnv.HERDR_ENV;
      if (previousEnv.HERDR_PANE_ID === undefined) delete process.env.HERDR_PANE_ID;
      else process.env.HERDR_PANE_ID = previousEnv.HERDR_PANE_ID;
    }
  });

  it("routes no-args and settings to their SF Pi Manager pages", async () => {
    const mod = await import("../index.ts");
    const events = eventBus();
    const pi = {
      events,
      on: vi.fn(),
      registerCommand: vi.fn(),
      getActiveTools: vi.fn(() => []),
    };
    const requests: SfPiManagerOpenRequest[] = [];
    events.on(SF_PI_MANAGER_OPEN_EVENT, (payload) => {
      const request = payload as SfPiManagerOpenRequest;
      requests.push(request);
      request.accept?.();
      request.resolve?.();
    });

    mod.default(pi as never);
    const command = pi.registerCommand.mock.calls.find(([name]) => name === "sf-herdr")?.[1];
    await command.handler("", fakeCommandContext());
    await command.handler("settings", fakeCommandContext());

    expect(requests[0]?.route).toMatchObject({ extensionId: "sf-herdr", view: "detail" });
    expect(requests[0]?.route?.actions?.map((action) => action.id)).toEqual([
      "status",
      "doctor",
      "help",
    ]);
    expect(requests[1]?.route).toMatchObject({ extensionId: "sf-herdr", view: "settings" });
  });
});
