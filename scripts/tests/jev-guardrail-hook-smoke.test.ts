/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import files from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hookSmokeDecisionPasses, runHookSmoke } from "../jev-guardrail-hook-smoke.ts";
import { JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../../extensions/sf-guardrail/lib/jev-client.ts";
import { resolveJevOperatingPoint } from "../../extensions/sf-guardrail/lib/jev-operating-point.ts";
import type {
  JevAction,
  JevAllHeadRequest,
  JevEvidence,
} from "../../extensions/sf-guardrail/lib/types.ts";

const ENDPOINT = "https://decisions.example.test/v1/decisions";
let ordinal = 0;
afterEach(() => {
  vi.restoreAllMocks();
  syncBuiltinESMExports();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function rawReply(request: JevAllHeadRequest, choice: JevAction, allowProbability: number) {
  const probabilities =
    choice === "allow"
      ? { allow: allowProbability, confirm: 1 - allowProbability, block: 0 }
      : { allow: 0, confirm: choice === "confirm" ? 1 : 0, block: choice === "block" ? 1 : 0 };
  return {
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    id: `synthetic-hook-smoke-${ordinal++}`,
    usage: { input_tokens: 20, output_tokens: 1, cost: 0.00001 },
    answers: Object.fromEntries(
      Object.keys(request.questions).map((id) => [
        id,
        {
          type: "choice",
          choice,
          confidence: 1,
          probabilities,
        },
      ]),
    ),
  };
}

async function inertSmoke(
  point: "conservative" | "argmax",
  allowProbability: number,
  choice: JevAction = "allow",
) {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "synthetic-hook-smoke-key");
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", point);
  let body = "";
  let reply = "";
  const previousProfile = process.env.PI_CODING_AGENT_DIR;
  const fetch = vi.fn(async (_input, init) => {
    expect(process.env.PI_CODING_AGENT_DIR).not.toBe(previousProfile);
    expect(process.env.PI_CODING_AGENT_DIR).toMatch(/sf-pi-jev-hook-smoke-[^/]+\/agent$/);
    body = String(init.body);
    reply = JSON.stringify(rawReply(JSON.parse(body), choice, allowProbability));
    return new Response(reply);
  });
  vi.stubGlobal("fetch", fetch);
  const report = await runHookSmoke({ prepareOnly: false });
  expect(process.env.PI_CODING_AGENT_DIR).toBe(previousProfile);
  expect(globalThis.fetch).toBe(fetch);
  return { report, fetch, body, reply };
}

function prepared(body: string) {
  return {
    request: JSON.parse(body) as JevAllHeadRequest,
    hash: createHash("sha256").update(body).digest("hex"),
    bytes: Buffer.byteLength(body),
  };
}

describe("actual SDK hook smoke operating point", () => {
  it("prepares the SDK with no endpoint, key-file read or provider dispatch", async () => {
    vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", undefined);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", undefined);
    vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "unread-synthetic-hook-key-file");
    vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", undefined);
    const originalOpen = fs.openSync;
    const keyOpens: unknown[] = [];
    vi.spyOn(fs, "openSync").mockImplementation(((path, ...rest) => {
      if (String(path) === "unread-synthetic-hook-key-file") {
        keyOpens.push(path);
        throw new Error("Unexpected smoke key read.");
      }
      return originalOpen(path, ...rest);
    }) as typeof fs.openSync);
    syncBuiltinESMExports();
    const fetch = vi.fn(() => {
      throw new Error("Unexpected smoke provider call.");
    });
    vi.stubGlobal("fetch", fetch);
    const previousProfile = process.env.PI_CODING_AGENT_DIR;
    const privateWrites: string[] = [];
    const originalWrite = files.writeFile;
    vi.spyOn(files, "writeFile").mockImplementation(((path, ...rest) => {
      privateWrites.push(String(path));
      return originalWrite(path, ...rest);
    }) as typeof files.writeFile);
    syncBuiltinESMExports();
    const report = await runHookSmoke();
    expect(report).toMatchObject({
      success: true,
      preparedOnly: true,
      proofLevel: "sdk-preparation-only",
      requests: 0,
      executionCount: 0,
      requestBytes: 0,
      requestHash: null,
      operatingPoint: null,
      operatingPointHash: null,
      requestId: null,
      model: null,
      provider: null,
      cost: null,
      audit: null,
      failure: null,
    });
    expect(keyOpens).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(process.env.PI_CODING_AGENT_DIR).toBe(previousProfile);
    expect(globalThis.fetch).toBe(fetch);
    expect(privateWrites.length).toBeGreaterThan(0);
    expect(privateWrites.every((path) => path.includes("/sf-pi-jev-hook-smoke-"))).toBe(true);
  });

  it.each([
    ["conservative", 0.995],
    ["argmax", 0.8],
  ] as const)(
    "accepts the actual %s source gate with one strict reply and audit before inert execution",
    async (point, probability) => {
      const originalRead = files.readFile;
      const originalReadSync = fs.readFileSync;
      const contentReads: unknown[] = [];
      const rejectBody = (path: unknown) => {
        if (String(path).endsWith("/README.md") && String(path).includes("sf-pi-jev-hook-smoke-")) {
          contentReads.push(path);
          throw new Error("Unexpected smoke file-content read.");
        }
      };
      vi.spyOn(files, "readFile").mockImplementation(((path, ...rest) => {
        rejectBody(path);
        return originalRead(path, ...rest);
      }) as typeof files.readFile);
      vi.spyOn(fs, "readFileSync").mockImplementation(((path, ...rest) => {
        rejectBody(path);
        return originalReadSync(path, ...rest);
      }) as typeof fs.readFileSync);
      syncBuiltinESMExports();
      const { report, fetch, body, reply } = await inertSmoke(point, probability);
      expect(report).toMatchObject({
        success: true,
        preparedOnly: false,
        proofLevel: "actual-sdk-hook-with-inert-tool",
        requests: 1,
        executionCount: 1,
        wirePrivacySuccess: true,
        outcome: "allow_auto",
        failure: null,
        operatingPoint: { name: point, allowProbability: point === "argmax" ? 0 : 0.99 },
      });
      expect(fetch).toHaveBeenCalledOnce();
      expect(contentReads).toEqual([]);
      expect(body).not.toContain("private-file-body-must-stay-local-hook-smoke");
      expect(body).not.toContain("synthetic-hook-smoke-key");
      const evidence = report.audit!.jev;
      expect(evidence.process?.kind).toBe("all_heads");
      if (evidence.process?.kind !== "all_heads") throw new Error("Missing one-call evidence.");
      expect(evidence.process).toMatchObject({
        completed: true,
        cleanupFailed: false,
        stageTimingOrigin: "transport_cleanup",
        stage: {
          stage: "all_heads",
          evidence: {
            requestHash: prepared(body).hash,
            requestBytes: Buffer.byteLength(body),
            responseHash: createHash("sha256").update(reply).digest("hex"),
            responseBytes: Buffer.byteLength(reply),
            requestId: JSON.parse(reply).id,
          },
        },
      });
      expect(report.requestId).toBe(JSON.parse(reply).id);
      expect(report.probabilities?.allow).toBe(probability);
      expect(
        hookSmokeDecisionPasses(
          evidence,
          prepared(body),
          ENDPOINT,
          resolveJevOperatingPoint(point),
        ),
      ).toBe(true);
    },
  );

  it.each(["conservative", "argmax"] as const)(
    "keeps an actual block hard at the %s point",
    async (point) => {
      const { report, fetch } = await inertSmoke(point, 0, "block");
      expect(report.success).toBe(false);
      expect(report.executionCount).toBe(0);
      expect(report.outcome).toBe("hard_block");
      expect(report.probabilities?.block).toBe(1);
      expect(fetch).toHaveBeenCalledOnce();
    },
  );

  it("does not accept a conservative allow below its actual source floor", async () => {
    const { report, fetch } = await inertSmoke("conservative", 0.8);
    expect(report.success).toBe(false);
    expect(report.executionCount).toBe(0);
    expect(report.audit?.jev.failure).toBeUndefined();
    expect(report.audit?.jev.riskAnswer?.choice).toBe("allow");
    expect(report.outcome).toBe("headless_block");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects edited point, hash, receipt, origin and top-level answer fields from an actual SDK audit", async () => {
    const { report, body } = await inertSmoke("argmax", 0.8);
    expect(report.success).toBe(true);
    const original = report.audit!.jev;
    const point = resolveJevOperatingPoint("argmax");
    const mutations: Array<(evidence: JevEvidence) => void> = [
      (e) => {
        e.operatingPoint = resolveJevOperatingPoint("conservative");
      },
      (e) => {
        e.operatingPointHash = "0".repeat(64);
      },
      (e) => {
        e.protocolHash = "0".repeat(64);
      },
      (e) => {
        e.transportHash = "0".repeat(64);
      },
      (e) => {
        delete e.process;
      },
      (e) => {
        if (e.process?.kind === "all_heads") e.process.completed = false;
      },
      (e) => {
        if (e.process?.kind === "all_heads") e.process.cleanupFailed = true;
      },
      (e) => {
        if (e.process?.kind === "all_heads") e.process.stageTimingOrigin = "strict_validation";
      },
      (e) => {
        if (e.process?.kind === "all_heads") e.process.attempt!.requestBytes++;
      },
      (e) => {
        if (e.process?.kind === "all_heads") e.process.stage!.evidence.requestHash = "0".repeat(64);
      },
      (e) => {
        if (e.process?.kind === "all_heads")
          e.process.stage!.evidence.transportHash = "0".repeat(64);
      },
      (e) => {
        e.requestId = "changed-synthetic-reply-id";
      },
      (e) => {
        e.riskOrigin!.requestId = "changed-synthetic-origin-id";
      },
      (e) => {
        e.probabilities = { allow: 1, confirm: 0, block: 0 };
      },
      (e) => {
        e.confidence = 0.5;
      },
      (e) => {
        delete e.answers!.file_policy;
      },
      (e) => {
        e.latencyMs = Number.NaN;
      },
      (e) => {
        e.latencyMs = point.totalTimeoutMs;
      },
    ];
    for (const mutate of mutations) {
      const changed = structuredClone(original);
      mutate(changed);
      expect(hookSmokeDecisionPasses(changed, prepared(body), ENDPOINT, point)).toBe(false);
    }
    const editedRequest = prepared(body);
    editedRequest.request.state = { ...(editedRequest.request.state as object), injected: true };
    expect(hookSmokeDecisionPasses(original, editedRequest, ENDPOINT, point)).toBe(false);
  });
});
