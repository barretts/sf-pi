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
  scope: string;
  purpose?: string;
  groundingMode: "reference" | "org";
  groundingAsOf: string;
  groundingDisplayLabel?: string;
  evidence: {
    sources: Array<{ id: string; label: string; kind: string }>;
    elements: Array<{ collection: string; id: string; evidence: string[] }>;
  };
  nodeCount: number;
  connectionCount: number;
  documentId: string;
  pageId: string;
  pageName: string;
  readiness: CanvasExecutionResult["readiness"];
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
    schemaVersion: 2,
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
    scope: options.spec.scope,
    purpose: options.spec.purpose,
    groundingMode: options.spec.grounding.mode,
    groundingAsOf: options.spec.grounding.as_of,
    groundingDisplayLabel:
      options.spec.grounding.mode === "org" ? options.spec.grounding.display_label : undefined,
    evidence: evidenceMap(options.spec),
    nodeCount: counts.nodes,
    connectionCount: counts.edges,
    documentId: options.result.documentId,
    pageId: options.result.pageId,
    pageName: options.result.pageName,
    readiness: options.result.readiness,
  });
  verifyPersistedReport(store.path, createdAt, "Render report", 2);
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

function evidenceMap(spec: SalesforceDiagramSpec): RenderReport["evidence"] {
  const sources = spec.grounding.sources.map((source) => ({
    id: source.id,
    label: source.label,
    kind: source.kind,
  }));
  const elements =
    spec.family === "data_model"
      ? [
          ...spec.objects.map((item) => ({
            collection: "objects",
            id: item.id,
            evidence: [...item.evidence],
          })),
          ...spec.relationships.map((item) => ({
            collection: "relationships",
            id: item.id,
            evidence: [...item.evidence],
          })),
        ]
      : spec.family === "architecture"
        ? [
            ...spec.systems.map((item) => ({
              collection: "systems",
              id: item.id,
              evidence: [...item.evidence],
            })),
            ...spec.connections.map((item) => ({
              collection: "connections",
              id: item.id,
              evidence: [...item.evidence],
            })),
          ]
        : [
            ...spec.participants.map((item) => ({
              collection: "participants",
              id: item.id,
              evidence: [...item.evidence],
            })),
            ...spec.interactions.map((item) => ({
              collection: "interactions",
              id: item.id,
              evidence: [...item.evidence],
            })),
            ...(spec.activations ?? []).map((item) => ({
              collection: "activations",
              id: item.id,
              evidence: [...item.evidence],
            })),
          ];
  return { sources, elements };
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

function verifyPersistedReport(
  filePath: string,
  createdAt: string,
  label: string,
  schemaVersion: number,
): void {
  try {
    if (!lstatSync(filePath).isFile()) throw new Error("not a regular file");
    const envelope = JSON.parse(readFileSync(filePath, "utf8")) as {
      schemaVersion?: number;
      state?: { createdAt?: string };
    };
    if (envelope.schemaVersion !== schemaVersion || envelope.state?.createdAt !== createdAt) {
      throw new Error("stale or invalid report");
    }
  } catch {
    throw new Error(`${label} could not be persisted and verified.`);
  }
}

function safeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 120);
}
