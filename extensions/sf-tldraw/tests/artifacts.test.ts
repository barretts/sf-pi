/* SPDX-License-Identifier: Apache-2.0 */
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let tempAgentDir: string;

vi.mock("@earendil-works/pi-coding-agent", async () => {
  const actual = await vi.importActual<typeof import("@earendil-works/pi-coding-agent")>(
    "@earendil-works/pi-coding-agent",
  );
  return { ...actual, getAgentDir: () => tempAgentDir };
});

describe("sf-tldraw artifacts", () => {
  let source: string;

  beforeEach(() => {
    tempAgentDir = mkdtempSync(path.join(tmpdir(), "sf-tldraw-artifacts-"));
    const root = path.join(tmpdir(), "tldraw-canvas-api");
    mkdirSync(root, { recursive: true });
    source = path.join(root, `artifact-${process.pid}-${Date.now()}.jpg`);
    writeFileSync(source, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  });

  afterEach(() => {
    rmSync(tempAgentDir, { recursive: true, force: true });
    try {
      unlinkSync(source);
    } catch {
      // Already removed.
    }
  });

  it("persists validated screenshots with private file permissions", async () => {
    vi.resetModules();
    const { persistStandaloneScreenshot } = await import("../lib/artifacts.ts");
    const artifact = persistStandaloneScreenshot({
      documentId: "doc-1",
      screenshot: {
        filePath: source,
        width: 100,
        height: 80,
        pageName: "Page",
        captureMode: "canvas",
      },
    });
    expect(statSync(artifact.screenshotPath).mode & 0o777).toBe(0o600);
    expect(statSync(artifact.reportPath).mode & 0o777).toBe(0o600);
    expect(statSync(artifact.directory).mode & 0o777).toBe(0o700);
  });

  it("fails closed when a stale report target prevents a verified write", async () => {
    vi.resetModules();
    const { persistRenderArtifact } = await import("../lib/artifacts.ts");
    const reportTarget = path.join(
      tempAgentDir,
      "sf-pi",
      "tldraw-artifacts",
      "runs",
      "blocked-run",
      "report.json",
    );
    mkdirSync(reportTarget, { recursive: true });
    const spec = JSON.parse(
      readFileSync(path.join(import.meta.dirname, "fixtures", "data-model.json"), "utf8"),
    );
    expect(() =>
      persistRenderArtifact({
        runId: "blocked-run",
        spec,
        result: {
          documentId: "doc-1",
          pageId: "page-1",
          pageName: "Page",
          family: "data_model",
          createdShapes: 1,
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
        },
        screenshot: {
          filePath: source,
          width: 100,
          height: 80,
          pageName: "Page",
          captureMode: "canvas",
        },
        thumbnail: {
          filePath: source,
          width: 100,
          height: 80,
          pageName: "Page",
          captureMode: "canvas",
        },
      }),
    ).toThrow(/could not be persisted and verified/i);
  });

  it("refuses unvalidated screenshot sources", async () => {
    vi.resetModules();
    const { persistStandaloneScreenshot } = await import("../lib/artifacts.ts");
    const outside = path.join(tempAgentDir, "outside.jpg");
    writeFileSync(outside, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    expect(() =>
      persistStandaloneScreenshot({
        documentId: "doc-1",
        screenshot: {
          filePath: outside,
          width: 100,
          height: 80,
          pageName: "Page",
          captureMode: "canvas",
        },
      }),
    ).toThrow(/failed local file validation/i);
  });
});
