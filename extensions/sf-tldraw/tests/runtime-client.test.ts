/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("TldrawRuntimeClient", () => {
  let dir: string;
  let configPath: string;
  let screenshotPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-runtime-"));
    configPath = path.join(dir, "server.json");
    writeFileSync(configPath, JSON.stringify({ port: 7236, token: "unit-test-token", pid: 123 }));
    const captureRoot = path.join(tmpdir(), "tldraw-canvas-api");
    mkdirSync(captureRoot, { recursive: true });
    screenshotPath = path.join(captureRoot, `sf-tldraw-test-${process.pid}-${Date.now()}.jpg`);
    writeFileSync(screenshotPath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    try {
      unlinkSync(screenshotPath);
    } catch {
      // Already cleaned up.
    }
  });

  it("falls back to the installed v1 route contract when /api/capabilities is absent", async () => {
    const requests: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      requests.push({ url, init });
      if (url.endsWith("/api/capabilities")) return json({ error: "Not found" }, 404);
      return json({ success: true, result: [{ id: "doc-1", name: "Board", focusOrder: 0 }] });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    const status = await client.status();
    expect(status).toMatchObject({
      kind: "ready",
      openDocuments: 1,
      capabilities: {
        apiContract: "canvas-api-v1",
        capabilityEndpoint: false,
        nativeDocumentCreation: false,
      },
    });
    expect(new Headers(requests[0]!.init.headers).get("authorization")).toBe(
      "Bearer unit-test-token",
    );
  });

  it("uses /api/search for documents and validated screenshots", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(String(init.body));
      if (String(init.body).includes("getScreenshot")) {
        return json({
          success: true,
          result: {
            filePath: screenshotPath,
            width: 1200,
            height: 712.5,
            pageName: "Page",
            captureMode: "canvas",
          },
        });
      }
      return json({ success: true, result: [{ id: "doc-1", name: "Board", focusOrder: 0 }] });
    }) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    expect(await client.documents()).toHaveLength(1);
    expect(await client.screenshot("doc-1", { size: "full" })).toMatchObject({
      height: 712.5,
      captureMode: "canvas",
    });
    expect(bodies.some((body) => body.includes("api.getDocs"))).toBe(true);
    expect(bodies.find((body) => body.includes("api.getDocs"))).not.toContain("filePath");
    expect(bodies.some((body) => body.includes("api.getScreenshot"))).toBe(true);
  });

  it("rejects screenshot paths outside the dedicated capture directory", async () => {
    const outside = path.join(dir, "outside.jpg");
    writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const fetchImpl = vi.fn(async () =>
      json({
        success: true,
        result: {
          filePath: outside,
          width: 100,
          height: 100,
          pageName: "Page",
          captureMode: "canvas",
        },
      }),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.screenshot("doc-1")).rejects.toMatchObject({
      code: "invalid_response",
      message: expect.stringMatching(/failed local file validation/i),
    });
  });

  it("redacts bearer material from runtime errors", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ success: false, error: "Authorization: Bearer unit-test-token" }, 500),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.execute("doc-1", "return true")).rejects.toMatchObject({
      code: "execution_failed",
      message: expect.not.stringContaining("unit-test-token"),
    });
  });

  it("refuses unsupported native document creation without a fallback", async () => {
    const fetchImpl = vi.fn(async () =>
      json({ error: "Not found" }, 404),
    ) as unknown as typeof fetch;
    const client = new TldrawRuntimeClient({ fetchImpl, serverConfigPath: configPath });
    await expect(client.createDocument()).rejects.toEqual(
      expect.objectContaining({
        code: "unsupported",
        message: expect.stringMatching(/does not expose native document creation/i),
      }),
    );
  });

  it("reports a missing server configuration as not running", async () => {
    const client = new TldrawRuntimeClient({ serverConfigPath: path.join(dir, "missing.json") });
    await expect(client.status()).resolves.toMatchObject({ kind: "not-running" });
  });
});
