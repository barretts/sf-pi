/* SPDX-License-Identifier: Apache-2.0 */
/** Opt-in full-corpus regression over normalized, externally supplied Gallery specs. */
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { compileProfile } from "../lib/profiles.ts";
import { renderSalesforceDiagram } from "../lib/renderer.ts";
import { TldrawRuntimeClient } from "../lib/runtime-client.ts";
import { DEFAULT_TLDRAW_PREFERENCES } from "../lib/settings.ts";
import { validateDiagramSpec } from "../lib/spec-validation.ts";
import type { DataModelSpec, RenderArtifact, RenderReadiness } from "../lib/types.ts";

const manifestPath = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_MANIFEST;
const liveEnabled = Boolean(manifestPath);
const liveIt = liveEnabled ? it : it.skip;
const sharedPageName = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_PAGE?.trim();
const expectedCount = optionalPositiveInteger(
  process.env.SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_COUNT,
);
const expectedHash = process.env.SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_HASH?.trim();
const SAFE_SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/;

interface ExternalManifestItem {
  index?: number;
  slug: string;
  category: string;
  title: string;
  file: string;
  maxRouteObstructions?: number;
  maxRouteCrossings?: number;
  maxSharedCorridors?: number;
}

interface GalleryCase extends ExternalManifestItem {
  key: string;
  spec: DataModelSpec;
}

interface GalleryRow {
  key: string;
  slug: string;
  category: string;
  title: string;
  pageName: string;
  objectCount: number;
  relationshipCount: number;
  status: "pending" | "passed" | "invalid" | "render-failed" | "blocked";
  durationMs?: number;
  message?: string;
  readiness?: RenderReadiness;
  artifact?: RenderArtifact;
  thumbnail?: string;
}

const cases = manifestPath ? loadCases(manifestPath) : [];
const corpusHash = sha256(JSON.stringify(cases.map((item) => item.spec)));
const rows: GalleryRow[] = cases.map((item) => ({
  key: item.key,
  slug: item.slug,
  category: item.category,
  title: item.title,
  pageName: sharedPageName || `Gallery Matrix — ${item.key}`.slice(0, 64),
  objectCount: item.spec.objects.length,
  relationshipCount: item.spec.relationships.length,
  status: "pending",
}));

let client: TldrawRuntimeClient | undefined;
let documentId: string | undefined;
let preflightError: Error | undefined;
let qualification: { status: "pending" | "passed" | "failed"; message?: string } = {
  status: liveEnabled ? "pending" : "passed",
};

describe.sequential("sf-tldraw Data Model Gallery matrix", () => {
  beforeAll(async () => {
    if (!liveEnabled) return;
    client = new TldrawRuntimeClient({ timeoutMs: 120_000 });
    try {
      documentId = (await client.resolveDocument(undefined)).id;
    } catch (error) {
      preflightError = error instanceof Error ? error : new Error(String(error));
    }
  });

  liveIt("keeps every supplied Gallery spec valid and deterministic", () => {
    try {
      expect(cases.length).toBeGreaterThan(0);
      expect(new Set(cases.map((item) => item.key)).size).toBe(cases.length);
      if (expectedCount !== undefined) expect(cases.length).toBe(expectedCount);
      if (expectedHash) expect(corpusHash).toBe(expectedHash);
      if (cases.length > 30)
        expect(sharedPageName, "large corpora must reuse one page").toBeTruthy();
      for (const item of cases) {
        const row = requiredRow(item.key);
        try {
          const validation = validateDiagramSpec(item.spec, "data_model");
          expect(validation.errors, item.key).toEqual([]);
          const options = {
            renderMode: "replace" as const,
            pageName: sharedPageName || `Gallery Matrix — ${item.key}`.slice(0, 64),
            preferences: { ...DEFAULT_TLDRAW_PREFERENCES, cardinalityDetail: "full" as const },
          };
          expect(compileProfile(item.spec, options), item.key).toEqual(
            compileProfile(structuredClone(item.spec), options),
          );
        } catch (error) {
          row.status = "invalid";
          row.message = error instanceof Error ? error.message : String(error);
          throw error;
        }
      }
      qualification = { status: "passed" };
    } catch (error) {
      qualification = {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
      };
      throw error;
    }
  });

  for (const item of cases) {
    liveIt(
      `${item.category}: ${item.key}`,
      async () => {
        const row = requiredRow(item.key);
        if (preflightError || !client || !documentId) {
          row.status = "blocked";
          row.message = preflightError?.message ?? "tldraw runtime preflight did not complete.";
          throw new Error(`${item.key}: ${row.message}`);
        }
        const started = Date.now();
        const outcome = await renderSalesforceDiagram(
          {
            family: "data_model",
            spec: item.spec,
            documentId,
            pageName: row.pageName,
            mode: "replace",
            outputMode: "file_only",
            preferences: { cardinalityDetail: "full", cardFill: "transparent" },
          },
          { cwd: process.cwd(), client },
        );
        row.durationMs = Date.now() - started;
        if (outcome.ok === false) {
          row.status = outcome.reason === "readiness_blocked" ? "blocked" : "render-failed";
          row.message = `${outcome.reason}: ${outcome.message}`;
          row.readiness = outcome.result?.readiness;
          throw new Error(`${item.key}: ${row.message}`);
        }
        row.readiness = outcome.result.readiness;
        row.artifact = outcome.artifact;
        try {
          expect(outcome.result.pageName, item.key).toBe(row.pageName);
          expect(outcome.result.readiness, item.key).toMatchObject({ ready: true, lintCount: 0 });
          expect(outcome.result.readiness.markerOverlapChecks, item.key).toEqual([]);
          expectWithinBudget(
            outcome.result.readiness.routeChecks?.length ?? 0,
            item.maxRouteObstructions,
            `${item.key} route obstructions`,
          );
          expectWithinBudget(
            outcome.result.readiness.routeCrossingChecks?.length ?? 0,
            item.maxRouteCrossings,
            `${item.key} route crossings`,
          );
          expectWithinBudget(
            outcome.result.readiness.sharedCorridorChecks?.length ?? 0,
            item.maxSharedCorridors,
            `${item.key} shared corridors`,
          );
          row.status = "passed";
        } catch (error) {
          row.status = "blocked";
          row.message = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      120_000,
    );
  }

  afterAll(() => {
    if (!liveEnabled) return;
    const runId = new Date().toISOString().replace(/[:.]/g, "-");
    const directory = path.join(
      getAgentDir(),
      "sf-pi",
      "tldraw-artifacts",
      "data-model-gallery-matrix",
      runId,
    );
    const thumbnails = path.join(directory, "thumbnails");
    secureDirectory(directory);
    secureDirectory(thumbnails);
    rows.forEach((row, index) => {
      if (!row.artifact) return;
      const extension = path.extname(row.artifact.thumbnailPath).toLowerCase() || ".jpg";
      const filename = `${String(index + 1).padStart(3, "0")}-${row.key}${extension}`;
      const destination = path.resolve(thumbnails, filename);
      if (!destination.startsWith(`${path.resolve(thumbnails)}${path.sep}`)) {
        throw new Error(`Unsafe Gallery thumbnail path for '${row.key}'.`);
      }
      copyFileSync(row.artifact.thumbnailPath, destination);
      chmodSync(destination, 0o600);
      row.thumbnail = path.join("thumbnails", filename);
    });
    const indexPath = path.join(directory, "index.json");
    const reportPath = path.join(directory, "report.md");
    const totals = rows.reduce<Record<string, number>>((counts, row) => {
      counts[row.status] = (counts[row.status] ?? 0) + 1;
      return counts;
    }, {});
    writePrivate(
      indexPath,
      `${JSON.stringify({ schemaVersion: 1, createdAt: new Date().toISOString(), corpusHash, expectedCount, expectedHash, qualification, manifestPath, documentId, sharedPageName, totals, cases: rows }, null, 2)}\n`,
    );
    writePrivate(
      reportPath,
      [
        "# SF tldraw Data Model Gallery matrix",
        "",
        `- Corpus: \`${corpusHash}\``,
        `- Qualification: \`${JSON.stringify(qualification)}\``,
        `- Totals: \`${JSON.stringify(totals)}\``,
        "",
        "| # | Model | Objects | Relationships | Obstructions | Crossings | Shared | Status | Evidence |",
        "|---:|---|---:|---:|---:|---:|---:|---|---|",
        ...rows.map(
          (row, index) =>
            `| ${index + 1} | ${row.title} | ${row.objectCount} | ${row.relationshipCount} | ${row.readiness?.routeChecks?.length ?? "-"} | ${row.readiness?.routeCrossingChecks?.length ?? "-"} | ${row.readiness?.sharedCorridorChecks?.length ?? "-"} | ${row.status} | ${row.thumbnail ? `[thumbnail](${row.thumbnail})` : (row.message ?? "none")} |`,
        ),
        "",
      ].join("\n"),
    );
    console.info(`SF_TLDRAW_DATA_MODEL_GALLERY_INDEX=${indexPath}`);
    console.info(`SF_TLDRAW_DATA_MODEL_GALLERY_REPORT=${reportPath}`);
  });
});

function loadCases(filePath: string): GalleryCase[] {
  const resolvedManifest = realpathSync(filePath);
  const manifest = JSON.parse(readFileSync(resolvedManifest, "utf8")) as ExternalManifestItem[];
  const directory = path.dirname(resolvedManifest);
  return manifest.map((item, position) => {
    if (!SAFE_SLUG.test(item.slug)) throw new Error(`Unsafe Gallery slug '${item.slug}'.`);
    if (item.index !== undefined && (!Number.isInteger(item.index) || item.index <= 0)) {
      throw new Error(`Invalid Gallery index '${String(item.index)}'.`);
    }
    for (const [name, budget] of [
      ["maxRouteObstructions", item.maxRouteObstructions],
      ["maxRouteCrossings", item.maxRouteCrossings],
      ["maxSharedCorridors", item.maxSharedCorridors],
    ] as const) {
      if (budget !== undefined && (!Number.isInteger(budget) || budget < 0)) {
        throw new Error(`Invalid ${name} for '${item.slug}'.`);
      }
    }
    const key = `${String(item.index ?? position + 1).padStart(3, "0")}-${item.slug}`;
    const candidatePath = path.isAbsolute(item.file)
      ? item.file
      : path.resolve(directory, item.file);
    const specPath = realpathSync(candidatePath);
    if (!specPath.startsWith(`${directory}${path.sep}`)) {
      throw new Error(`Gallery spec '${item.file}' is outside the manifest directory.`);
    }
    return {
      ...item,
      key,
      spec: JSON.parse(readFileSync(specPath, "utf8")) as DataModelSpec,
    };
  });
}

function requiredRow(key: string): GalleryRow {
  const row = rows.find((item) => item.key === key);
  if (!row) throw new Error(`Missing Gallery matrix row '${key}'.`);
  return row;
}

function optionalPositiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive integer, received '${value}'.`);
  }
  return parsed;
}

function expectWithinBudget(actual: number, budget: number | undefined, label: string): void {
  if (budget !== undefined) expect(actual, label).toBeLessThanOrEqual(budget);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function secureDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
}

function writePrivate(filePath: string, content: string): void {
  writeFileSync(filePath, content, { mode: 0o600 });
  chmodSync(filePath, 0o600);
}
