/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import files from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hookSmokeDecisionPasses, runHookSmoke } from "../jev-guardrail-hook-smoke.ts";
import { JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../../extensions/sf-guardrail/lib/jev-client.ts";
import { buildJevRequest } from "../../extensions/sf-guardrail/lib/jev-risk.ts";
import { readBundledConfig } from "../../extensions/sf-guardrail/lib/config.ts";
import { prepareJevFileProcess } from "../../extensions/sf-guardrail/lib/jev-file-process.ts";
import { resolveJevOperatingPoint } from "../../extensions/sf-guardrail/lib/jev-operating-point.ts";
import type {
  JevAction,
  JevAllHeadRequest,
  JevRequest,
  JevToolMetadata,
  JevFacts,
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

function rawReply(
  request: JevRequest,
  choice: JevAction,
  allowProbability: number,
  fileProbability = 1,
) {
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
          choice: id.startsWith("f_") ? "no_match" : choice,
          confidence: id.startsWith("f_") ? 0.37 : 1,
          probabilities: id.startsWith("f_")
            ? { match: 1 - fileProbability, no_match: fileProbability, unknown: 0 }
            : probabilities,
        },
      ]),
    ),
  };
}

async function inertSmoke(
  point: "conservative" | "argmax",
  allowProbability: number,
  choice: JevAction = "allow",
  fileProbability = 1,
) {
  vi.stubEnv("SF_GUARDRAIL_JEV_ENDPOINT", ENDPOINT);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "synthetic-hook-smoke-key");
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", point);
  let body = "";
  let reply = "";
  const bodies: string[] = [];
  const replies: string[] = [];
  const previousProfile = process.env.PI_CODING_AGENT_DIR;
  const fetch = vi.fn(async (_input, init) => {
    expect(process.env.PI_CODING_AGENT_DIR).not.toBe(previousProfile);
    expect(process.env.PI_CODING_AGENT_DIR).toMatch(/sf-pi-jev-hook-smoke-[^/]+\/agent$/);
    body = String(init.body);
    reply = JSON.stringify(rawReply(JSON.parse(body), choice, allowProbability, fileProbability));
    bodies.push(body);
    replies.push(reply);
    return new Response(reply);
  });
  vi.stubGlobal("fetch", fetch);
  const report = await runHookSmoke({ prepareOnly: false });
  expect(process.env.PI_CODING_AGENT_DIR).toBe(previousProfile);
  expect(globalThis.fetch).toBe(fetch);
  const source = JSON.parse(bodies[0]) as JevRequest;
  const state = source.state as { operation: JevToolMetadata; facts: JevFacts };
  const plan = prepareJevFileProcess(
    buildJevRequest(state.operation, state.facts, readBundledConfig()),
    false,
  );
  return { report, fetch, body, reply, bodies, replies, plan };
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
      syntheticRequests: 2,
      selectedFormat: "file_match_then_policy",
      syntheticPreparation: { modelCredit: false, permissionCredit: false },
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
    expect(report.syntheticPreparation!.stages.map((stage) => stage.stage)).toEqual([
      "file_match",
      "all_heads",
    ]);
    expect(report.requestPreparations.every((stage) => stage.synthetic)).toBe(true);
    expect(report.stageReceipts).toEqual([]);
    expect(process.env.SF_GUARDRAIL_JEV_API_KEY_FILE).toBe("unread-synthetic-hook-key-file");
    expect(process.env.SF_GUARDRAIL_JEV_API_KEY).toBeUndefined();
    expect(process.env.SF_GUARDRAIL_JEV_ENDPOINT).toBeUndefined();
    expect(JSON.stringify(report)).not.toContain("synthetic-hook-preparation-key");
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
    "accepts the actual %s source gate with strict matching and action replies before inert execution",
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
      const { report, fetch, body, reply, bodies, replies, plan } = await inertSmoke(
        point,
        probability,
      );
      expect(report).toMatchObject({
        success: true,
        preparedOnly: false,
        proofLevel: "actual-sdk-hook-with-inert-tool",
        requests: 2,
        syntheticRequests: 0,
        selectedFormat: "file_match_then_policy",
        executionCount: 1,
        wirePrivacySuccess: true,
        outcome: "allow_auto",
        failure: null,
        operatingPoint: { name: point, allowProbability: point === "argmax" ? 0 : 0.99 },
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect(report.requestPreparations.map((stage) => stage.stage)).toEqual([
        "file_match",
        "all_heads",
      ]);
      expect(report.stageReceipts.map((stage) => stage.stage)).toEqual(["file_match", "all_heads"]);
      expect(report.stageReceipts[0].requestHash).toBe(prepared(bodies[0]).hash);
      expect(report.stageReceipts[0].responseHash).toBe(
        createHash("sha256").update(replies[0]).digest("hex"),
      );
      expect(report.stageReceipts[0].requestId).toBe(JSON.parse(replies[0]).id);
      expect(report.stageReceipts[0].cost).toBe(0.00001);
      expect(report.cost).toBe(0.00001);
      expect(report.stageReceipts[1].cost).toBe(0.00001);
      expect(report.stageReceipts[0].requestId).not.toBe(report.requestId);
      expect(contentReads).toEqual([]);
      expect(body).not.toContain("private-file-body-must-stay-local-hook-smoke");
      expect(body).not.toContain("synthetic-hook-smoke-key");
      const sourceState = JSON.parse(body).state;
      expect(sourceState.fileMatchPremises).toEqual([
        { fileRecordIndex: 0, policyRowIndex: 0, patternList: "patterns", choice: "no_match" },
        {
          fileRecordIndex: 0,
          policyRowIndex: 0,
          patternList: "allowedPatterns",
          choice: "no_match",
        },
        { fileRecordIndex: 0, policyRowIndex: 1, patternList: "patterns", choice: "no_match" },
        {
          fileRecordIndex: 0,
          policyRowIndex: 1,
          patternList: "allowedPatterns",
          choice: "no_match",
        },
        { fileRecordIndex: 0, policyRowIndex: 2, patternList: "patterns", choice: "no_match" },
        {
          fileRecordIndex: 0,
          policyRowIndex: 2,
          patternList: "allowedPatterns",
          choice: "no_match",
        },
        { fileRecordIndex: 0, policyRowIndex: 3, patternList: "patterns", choice: "no_match" },
        {
          fileRecordIndex: 0,
          policyRowIndex: 3,
          patternList: "allowedPatterns",
          choice: "no_match",
        },
      ]);
      const evidence = report.audit!.jev;
      expect(evidence.process?.kind).toBe("all_heads");
      if (evidence.process?.kind !== "all_heads") throw new Error("Missing action-stage evidence.");
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
          plan,
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
      expect(fetch).toHaveBeenCalledTimes(2);
    },
  );

  it("does not accept a conservative allow below its actual source floor", async () => {
    const { report, fetch } = await inertSmoke("conservative", 0.8);
    expect(report.success).toBe(false);
    expect(report.executionCount).toBe(0);
    expect(report.audit?.jev.failure).toBeUndefined();
    expect(report.audit?.jev.riskAnswer?.choice).toBe("allow");
    expect(report.outcome).toBe("headless_block");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("rejects edited point, hash, receipt, origin and top-level answer fields from an actual SDK audit", async () => {
    const { report, body, plan } = await inertSmoke("argmax", 0.8);
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
        e.process!.fileStage!.selectedProbabilityFloorMet = false;
      },
      (e) => {
        e.process!.fileStage!.match!.evidence.requestId = "changed-prefix-origin";
      },
      (e) => {
        e.process!.fileStage!.match!.answers.f_a.probabilities.no_match = 0.8;
      },
      (e) => {
        e.process!.fileStage!.transcript = "[]";
      },
      (e) => {
        e.process!.fileStage!.selection.originalRequestHash = "0".repeat(64);
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
      expect(hookSmokeDecisionPasses(changed, prepared(body), ENDPOINT, point, plan)).toBe(false);
    }
    const editedRequest = prepared(body);
    editedRequest.request.state = { ...(editedRequest.request.state as object), injected: true };
    expect(hookSmokeDecisionPasses(original, editedRequest, ENDPOINT, point, plan)).toBe(false);
    for (const change of [
      (state) => delete state.fileMatchPremises,
      (state) => state.fileMatchPremises.reverse(),
      (state) => {
        state.fileMatchPremises[0].choice = "match";
      },
      (state) => {
        state.fileMatchPremises[0].privateOperand = "Unexpected data.";
      },
    ]) {
      const changed = prepared(body);
      change(changed.request.state);
      expect(hookSmokeDecisionPasses(original, changed, ENDPOINT, point, plan)).toBe(false);
    }
  });
});

it("requires the selected matching probability floor before inert execution", async () => {
  const { report, fetch } = await inertSmoke("conservative", 1, "allow", 0.98);
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(report.success).toBe(false);
  expect(report.executionCount).toBe(0);
  expect(report.audit!.jev.riskAnswer!.choice).toBe("allow");
  expect(report.audit!.jev.process!.fileStage!.selectedProbabilityFloorMet).toBe(false);
  expect(report.outcome).toBe("headless_block");
});
