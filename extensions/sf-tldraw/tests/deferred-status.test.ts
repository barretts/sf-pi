/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

describe("sf-tldraw on-demand availability", () => {
  let tempDir: string | undefined;
  const originalConfig = process.env.TLDRAW_SERVER_CONFIG;

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    if (originalConfig === undefined) delete process.env.TLDRAW_SERVER_CONFIG;
    else process.env.TLDRAW_SERVER_CONFIG = originalConfig;
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = undefined;
  });

  it("publishes config presence without a loopback request or deferred timer", async () => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-availability-"));
    const configPath = path.join(tempDir, "server.json");
    writeFileSync(configPath, JSON.stringify({ port: 7236, token: "test-token" }));
    process.env.TLDRAW_SERVER_CONFIG = configPath;

    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.resetModules();

    const store = await import("../../../lib/common/tldraw-status/store.ts");
    store.__resetTldrawStatusStoreForTests();
    const handlers = new Map<string, Listener>();
    const mod = await import("../index.ts");
    mod.default({
      on: vi.fn((event: string, handler: Listener) => handlers.set(event, handler)),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: { on: vi.fn() },
    } as never);

    await handlers.get("session_start")?.({}, {});
    expect(store.getTldrawStatus()).toMatchObject({
      kind: "available",
      origin: "availability",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchMock).not.toHaveBeenCalled();

    await handlers.get("session_shutdown")?.();
    expect(store.getTldrawStatus()).toMatchObject({ kind: "hidden" });
  });

  it("stays hidden when no local server configuration exists", async () => {
    tempDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-unavailable-"));
    process.env.TLDRAW_SERVER_CONFIG = path.join(tempDir, "missing.json");
    vi.resetModules();

    const store = await import("../../../lib/common/tldraw-status/store.ts");
    store.__resetTldrawStatusStoreForTests();
    const handlers = new Map<string, Listener>();
    const mod = await import("../index.ts");
    mod.default({
      on: vi.fn((event: string, handler: Listener) => handlers.set(event, handler)),
      registerTool: vi.fn(),
      registerCommand: vi.fn(),
      events: { on: vi.fn() },
    } as never);

    await handlers.get("session_start")?.({}, {});
    expect(store.getTldrawStatus()).toMatchObject({ kind: "hidden" });
  });
});
