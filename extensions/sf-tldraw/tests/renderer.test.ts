/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TldrawRuntimeClient } from "../lib/runtime-client.ts";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf-tldraw renderer evidence gate", () => {
  let cwd: string;

  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-renderer-agent-"));
    cwd = mkdtempSync(path.join(tmpdir(), "sf-tldraw-renderer-cwd-"));
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it("rejects sensitive page names before contacting the runtime", async () => {
    vi.resetModules();
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    const { renderSalesforceDiagram } = await import("../lib/renderer.ts");
    for (const pageName of ["owner@example.test", "Basic YWJjZGVmZ2hpamts"]) {
      const outcome = await renderSalesforceDiagram(
        {
          family: "data_model",
          spec,
          pageName,
        },
        { cwd },
      );
      expect(outcome).toMatchObject({
        ok: false,
        reason: "invalid_page_name",
        validation: {
          errors: [expect.objectContaining({ code: "private_rendered_value", path: "page_name" })],
        },
      });
    }
  });

  it("rejects screenshot evidence captured from a different page", async () => {
    vi.resetModules();
    const fakeClient = {
      capabilities: vi.fn(async () => ({ execute: true, screenshot: true })),
      documents: vi.fn(async () => [{ id: "doc-1", name: "Board", focusOrder: 0 }]),
      resolveDocument: vi.fn(async () => ({ id: "doc-1", name: "Board", focusOrder: 0 })),
      readServerConfig: vi.fn(() => ({ port: 7236, token: "not-returned" })),
      execute: vi.fn(async () => ({
        pageId: "page-1",
        pageName: "Rendered Page",
        family: "data_model",
        createdShapes: 10,
        updatedShapes: 0,
        deletedShapes: 0,
        readiness: {
          ready: true,
          blockers: [],
          warnings: [],
          lintCount: 0,
          markerChecks: [],
          bindingChecks: [],
          sequenceGeometryChecks: [],
          typographyChecks: [],
        },
      })),
      screenshot: vi.fn(async () => ({
        filePath: path.join(cwd, "unused.jpg"),
        width: 100,
        height: 80,
        pageName: "Different Page",
        captureMode: "canvas",
      })),
    } as unknown as TldrawRuntimeClient;
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    const { renderSalesforceDiagram } = await import("../lib/renderer.ts");
    const outcome = await renderSalesforceDiagram(
      { family: "data_model", spec, pageName: "Rendered Page" },
      { cwd, client: fakeClient },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "evidence_page_mismatch" });
  });

  it("does not return success when screenshot evidence cannot be validated and persisted", async () => {
    vi.resetModules();
    const invalidImage = path.join(cwd, "outside.jpg");
    writeFileSync(invalidImage, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    const fakeClient = {
      capabilities: vi.fn(async () => ({ execute: true, screenshot: true })),
      documents: vi.fn(async () => [{ id: "doc-1", name: "Board", focusOrder: 0 }]),
      resolveDocument: vi.fn(async () => ({ id: "doc-1", name: "Board", focusOrder: 0 })),
      readServerConfig: vi.fn(() => ({ port: 7236, token: "not-returned" })),
      execute: vi.fn(async () => ({
        pageId: "page-1",
        pageName: "Page",
        family: "data_model",
        createdShapes: 10,
        updatedShapes: 0,
        deletedShapes: 0,
        readiness: {
          ready: true,
          blockers: [],
          warnings: [],
          lintCount: 0,
          markerChecks: [],
          bindingChecks: [],
          sequenceGeometryChecks: [],
          typographyChecks: [],
        },
      })),
      screenshot: vi.fn(async () => ({
        filePath: invalidImage,
        width: 100,
        height: 80,
        pageName: "Page",
        captureMode: "canvas",
      })),
    } as unknown as TldrawRuntimeClient;
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    const { renderSalesforceDiagram } = await import("../lib/renderer.ts");
    const outcome = await renderSalesforceDiagram(
      { family: "data_model", spec, pageName: "Page" },
      { cwd, client: fakeClient },
    );
    expect(outcome).toMatchObject({ ok: false, reason: "evidence_capture_failed" });
  });
});
