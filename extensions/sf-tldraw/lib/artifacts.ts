/* SPDX-License-Identifier: Apache-2.0 */
/** Sanitized render evidence under the global SF Pi state directory. */
import { chmodSync, copyFileSync, lstatSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createStateStore } from "../../../lib/common/state-store.ts";
import { validateRuntimeScreenshot } from "./runtime-client.ts";
import type {
  CanvasExecutionResult,
  RenderArtifact,
  RuntimeScreenshot,
  SalesforceDiagramSpec,
} from "./types.ts";

interface RenderReport {
  createdAt: string;
  family: SalesforceDiagramSpec["family"];
  title: string;
  groundingMode: "reference" | "org";
  nodeCount: number;
  connectionCount: number;
  documentId: string;
  pageId: string;
  pageName: string;
  readiness: CanvasExecutionResult["readiness"];
}

interface ScreenshotReport {
  createdAt: string;
  documentId: string;
  pageName: string;
  captureMode: "canvas" | "window";
  width: number;
  height: number;
}

export function createRunId(): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
}

export function persistRenderArtifact(options: {
  runId: string;
  spec: SalesforceDiagramSpec;
  result: CanvasExecutionResult;
  screenshot: RuntimeScreenshot;
  thumbnail: RuntimeScreenshot;
}): RenderArtifact {
  const store = createStateStore<RenderReport>({
    namespace: `tldraw-artifacts/runs/${safeSegment(options.runId)}`,
    filename: "report.json",
    schemaVersion: 1,
    defaults: {} as RenderReport,
    mode: 0o600,
  });
  const directory = path.dirname(store.path);
  secureDirectory(directory);
  const counts =
    options.spec.family === "data_model"
      ? { nodes: options.spec.objects.length, edges: options.spec.relationships.length }
      : options.spec.family === "architecture"
        ? { nodes: options.spec.systems.length, edges: options.spec.connections.length }
        : { nodes: options.spec.participants.length, edges: options.spec.interactions.length };
  const createdAt = new Date().toISOString();
  store.write({
    createdAt,
    family: options.spec.family,
    title: options.spec.title,
    groundingMode: options.spec.grounding.mode,
    nodeCount: counts.nodes,
    connectionCount: counts.edges,
    documentId: options.result.documentId,
    pageId: options.result.pageId,
    pageName: options.result.pageName,
    readiness: options.result.readiness,
  });
  verifyPersistedReport(store.path, createdAt, "Render report");
  const screenshotPath = copyValidatedScreenshot(options.screenshot, directory, "render-full");
  const thumbnailPath = copyValidatedScreenshot(options.thumbnail, directory, "render-thumbnail");
  return {
    runId: options.runId,
    directory,
    reportPath: store.path,
    screenshotPath,
    thumbnailPath,
  };
}

export function persistStandaloneScreenshot(options: {
  documentId: string;
  screenshot: RuntimeScreenshot;
}): { runId: string; directory: string; reportPath: string; screenshotPath: string } {
  const runId = createRunId();
  const store = createStateStore<ScreenshotReport>({
    namespace: `tldraw-artifacts/screenshots/${safeSegment(runId)}`,
    filename: "report.json",
    schemaVersion: 1,
    defaults: {} as ScreenshotReport,
    mode: 0o600,
  });
  const directory = path.dirname(store.path);
  secureDirectory(directory);
  const screenshot = validateRuntimeScreenshot(options.screenshot);
  const createdAt = new Date().toISOString();
  store.write({
    createdAt,
    documentId: options.documentId,
    pageName: screenshot.pageName,
    captureMode: screenshot.captureMode,
    width: screenshot.width,
    height: screenshot.height,
  });
  verifyPersistedReport(store.path, createdAt, "Screenshot report");
  return {
    runId,
    directory,
    reportPath: store.path,
    screenshotPath: copyValidatedScreenshot(screenshot, directory, "capture"),
  };
}

function copyValidatedScreenshot(
  screenshot: RuntimeScreenshot,
  directory: string,
  basename: string,
): string {
  const validated = validateRuntimeScreenshot(screenshot);
  const extension = validated.format === "png" ? ".png" : ".jpg";
  const destination = path.join(directory, `${basename}${extension}`);
  copyFileSync(validated.filePath, destination);
  chmodSync(destination, 0o600);
  return destination;
}

function secureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function verifyPersistedReport(filePath: string, createdAt: string, label: string): void {
  try {
    if (!lstatSync(filePath).isFile()) throw new Error("not a regular file");
    const envelope = JSON.parse(readFileSync(filePath, "utf8")) as {
      schemaVersion?: number;
      state?: { createdAt?: string };
    };
    if (envelope.schemaVersion !== 1 || envelope.state?.createdAt !== createdAt) {
      throw new Error("stale or invalid report");
    }
  } catch {
    throw new Error(`${label} could not be persisted and verified.`);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
}
