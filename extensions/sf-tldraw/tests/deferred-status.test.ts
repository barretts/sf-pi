/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

type Listener = (...args: unknown[]) => void;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sf-tldraw deferred Welcome verification", () => {
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

  it("transitions the shared status from detected to ready after first paint", async () => {
    vi.useFakeTimers();
    tempDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-deferred-"));
    const configPath = path.join(tempDir, "server.json");
    writeFileSync(configPath, JSON.stringify({ port: 7236, token: "test-token" }));
    process.env.TLDRAW_SERVER_CONFIG = configPath;

    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith("/api/capabilities")) return json({ error: "Not found" }, 404);
      return json({
        success: true,
        result: [{ id: "doc-1", name: "Board", shapeCount: 4, focusOrder: 0 }],
      });
    }) as unknown as typeof fetch;
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

    await handlers.get("session_start")?.({}, { signal: new AbortController().signal });
    expect(store.getTldrawStatus()).toMatchObject({ kind: "detected" });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(750);
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getTldrawStatus()).toMatchObject({
      kind: "ready",
      openDocuments: 1,
      focusedDocumentName: "Board",
    });

    await handlers.get("session_shutdown")?.();
  });
});
