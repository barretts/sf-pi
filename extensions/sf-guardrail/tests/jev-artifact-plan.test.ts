/* SPDX-License-Identifier: Apache-2.0 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  prepareSoqlArtifactPlan,
  registerSoqlArtifactPlanner,
  revokeAllSoqlArtifactPlans,
  type PreparedSoqlArtifactPlan,
} from "../../../lib/common/sf-soql-artifact-plan/store.ts";
import { readBundledConfig } from "../lib/config.ts";
import { addJevArtifactPlan, buildJevMetadata } from "../lib/jev-metadata.ts";
import { resolveJevFacts } from "../lib/jev-facts.ts";
import {
  buildJevRequest,
  evaluateJevSafety,
  jevContextComplete,
  jevFactBindingHash,
} from "../lib/jev-risk.ts";
import { jevHash } from "../lib/jev-identity.ts";
import { JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../lib/jev-client.ts";
import type { JevArtifactPlanContext, JevPrediction } from "../lib/types.ts";

const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({ connectSalesforce: sdk.connect }));

let directory: string;
let context: JevArtifactPlanContext;
let sequence = 0;

const names = [
  "query.soql",
  "result.raw.json",
  "result.flattened.json",
  "result.flattened.csv",
  "summary.json",
];

function prepare(input = context.input, callId = context.toolCallId!) {
  return prepareSoqlArtifactPlan({
    toolName: "sf_soql",
    sessionId: context.sessionId!,
    toolCallId: callId,
    inputHash: jevHash(input),
    cwd: context.cwd,
  });
}

function project(prepared: Readonly<PreparedSoqlArtifactPlan>, source = context) {
  return addJevArtifactPlan(buildJevMetadata(source.toolName, source.input), prepared, source);
}

async function observe(metadata: ReturnType<typeof project>, input = context.input) {
  return resolveJevFacts({
    toolName: context.toolName,
    input,
    metadata,
    cwd: context.cwd,
    sessionId: context.sessionId,
    config: readBundledConfig(),
    signal: new AbortController().signal,
  });
}

function prediction(): JevPrediction {
  const answer = {
    choice: "allow" as const,
    probabilities: { allow: 1, confirm: 0, block: 0 },
    confidence: 1,
  };
  return {
    ...answer,
    answers: { risk: answer, file_policy: answer, disclosure: answer },
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    requestId: "source-only-artifact-test",
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "sf-pi-jev-artifact-facts-"));
  const home = path.join(directory, "home");
  mkdirSync(home);
  vi.stubEnv("HOME", home);
  context = {
    toolName: "sf_soql",
    input: { action: "query.run", query: "SELECT Id FROM Sample__c LIMIT 25", max_rows: 25 },
    cwd: directory,
    sessionId: `source-session-${++sequence}`,
    toolCallId: "source-call",
  };
  let run = 0;
  registerSoqlArtifactPlanner(() => {
    const root = path.join(directory, "agent", "sf-pi", "sf-soql");
    const runDirectory = path.join(root, "runs", `jev-${(++run).toString(16).padStart(32, "0")}`);
    const directories: string[] = [];
    let current = runDirectory;
    for (;;) {
      directories.unshift(current);
      const parent = path.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return {
      version: 1,
      writerCwd: directory,
      root,
      runDirectory,
      directories,
      files: names.map((name) => path.join(runDirectory, name)),
    };
  });
  sdk.connect.mockReset();
  sdk.connect.mockResolvedValue({
    target: { targetOrg: "source-org", orgType: "sandbox", orgId: "source-org-identity" },
  });
});

afterEach(() => {
  revokeAllSoqlArtifactPlans();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("trusted query artifact projection", () => {
  it("observes every ordered mkdir and write path and resolves only its own gap", async () => {
    const prepared = prepare();
    const base = buildJevMetadata(context.toolName, context.input);
    expect(base.complete).toBe(false);
    expect(base.artifactPathsOnlyIncomplete).toBe(true);
    expect(JSON.stringify(buildJevRequest(base, {}, readBundledConfig()))).not.toContain(
      "artifactPathsOnlyIncomplete",
    );
    const before = JSON.stringify(base);
    const metadata = addJevArtifactPlan(base, prepared, context);
    const accesses = [
      ...prepared.plan.directories.map((path) => ({ path, access: "mkdir" })),
      ...prepared.plan.files.map((path) => ({ path, access: "write" })),
    ];
    expect(metadata.metadata.fileAccesses).toEqual(accesses);
    expect(metadata.metadata.paths).toEqual(accesses.map(({ path }) => path));
    expect(metadata.artifactPlan).toEqual({ hash: prepared.hash, accesses });
    expect(metadata.omissions).toEqual(
      base.omissions.filter((reason) => reason !== "generated_artifact_paths_unobserved"),
    );
    expect(metadata.complete).toBe(true);
    expect(metadata).not.toHaveProperty("artifactPathsOnlyIncomplete");
    expect(JSON.stringify(base)).toBe(before);
    expect(addJevArtifactPlan(metadata, prepared, context)).toEqual(metadata);
    const resolved = await observe(metadata);
    expect(resolved.facts.files?.map(({ path }) => path)).toEqual(accesses.map(({ path }) => path));
    expect(resolved.facts.files?.slice(-5)).toEqual(
      prepared.plan.files.map((path) =>
        expect.objectContaining({ path, exists: false, kind: "unknown" }),
      ),
    );
    expect(resolved.facts.files?.find((file) => file.path === directory)).toMatchObject({
      exists: true,
      kind: "directory",
    });
    expect(resolved.artifactPlan).toEqual(metadata.artifactPlan);
    expect(jevContextComplete(metadata, resolved.facts)).toBe(true);
    const request = buildJevRequest(metadata, resolved.facts, readBundledConfig());
    expect(Object.keys(request.questions)).toEqual(["risk", "file_policy", "disclosure"]);
    expect(request.state).toMatchObject({
      version: 6,
      operation: { metadata: { fileAccesses: accesses, queryShape: { sensitivity: "unknown" } } },
      observations: { contextComplete: true },
    });
    const wire = JSON.stringify(request);
    for (const omitted of [
      prepared.hash,
      prepared.binding.inputHash,
      context.sessionId!,
      context.toolCallId!,
      "artifactPathsOnlyIncomplete",
      "artifactPlan",
      "Sample__c",
      context.input.query as string,
    ])
      expect(wire).not.toContain(omitted);
    expect(wire).toContain('"sensitivity":"unknown"');
    expect(JSON.stringify(request.questions.file_policy?.instructions)).toContain(
      "Both use write access in winner.restrictedAccess",
    );
    expect(request.questions.file_policy?.criteria.confirm).toMatchObject({
      when: expect.stringContaining("declared write access (write or mkdir)"),
    });
  });

  it.each([
    { filters: "PRIVATE_FILTER" },
    { artifact_plan: { approved: true, path: "PRIVATE_FORGED_PATH" } },
    { query: "SELECT PrivateField__c FROM PrivateObject__c LIMIT 25" },
  ])("keeps every independent unknown for $query $filters $artifact_plan", async (extra) => {
    const source = { ...context, input: { ...context.input, ...extra } };
    const prepared = prepare(source.input);
    const base = buildJevMetadata(source.toolName, source.input);
    expect(base.artifactPathsOnlyIncomplete).toBeUndefined();
    const metadata = addJevArtifactPlan(base, prepared, source);
    expect(metadata.complete).toBe(false);
    expect(metadata.omissions).toEqual(
      base.omissions.filter((reason) => reason !== "generated_artifact_paths_unobserved"),
    );
    const resolved = await observe(metadata, source.input);
    expect(jevContextComplete(metadata, resolved.facts)).toBe(false);
    expect(
      JSON.stringify(buildJevRequest(metadata, resolved.facts, readBundledConfig())),
    ).not.toContain("PRIVATE_");
  });

  it.each([
    { toolName: "future_tool" },
    { input: { action: "query.sample", query: "SELECT Id FROM Sample__c LIMIT 25" } },
    { input: { action: "query.run", query: "SELECT Id FROM Sample__c LIMIT 26", max_rows: 25 } },
    { cwd: "/synthetic/changed" },
    { sessionId: "changed-session" },
    { toolCallId: "changed-call" },
  ])("rejects a changed original binding $toolName $cwd $sessionId $toolCallId", (changed) => {
    const prepared = prepare();
    expect(() => project(prepared, { ...context, ...changed })).toThrow(
      "Invalid Jev tool metadata",
    );
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("rejects forged plans and over-bound path sets without truncation", () => {
    const prepared = prepare();
    expect(() => project(structuredClone(prepared))).toThrow("Invalid Jev tool metadata");
    const base = buildJevMetadata(context.toolName, context.input);
    base.metadata.paths = Array.from({ length: 32 }, (_, index) => `source/path-${index}`);
    expect(() => addJevArtifactPlan(base, prepared, context)).toThrow("Invalid Jev tool metadata");
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("keeps injectable unknown metadata and missing or unknown path observations incomplete", async () => {
    const prepared = prepare();
    const base = buildJevMetadata(context.toolName, context.input);
    delete base.artifactPathsOnlyIncomplete;
    const metadata = addJevArtifactPlan(base, prepared, context);
    expect(metadata.complete).toBe(false);
    const completeMetadata = project(prepared);
    const resolved = await observe(completeMetadata);
    const files = resolved.facts.files!;
    expect(jevContextComplete(completeMetadata, { ...resolved.facts, files: files.slice(1) })).toBe(
      false,
    );
    expect(
      jevContextComplete(completeMetadata, {
        ...resolved.facts,
        files: files.map((file, index) => (index === 0 ? { ...file, exists: "unknown" } : file)),
      }),
    ).toBe(false);
    const missingPathMetadata = {
      ...completeMetadata,
      metadata: { ...completeMetadata.metadata, paths: files.slice(1).map(({ path }) => path) },
    };
    await expect(observe(missingPathMetadata)).rejects.toThrow("invalid-metadata");
  });

  it("binds plan identity and access order while leaving sensitivity to Jev", async () => {
    const prepared = prepare();
    const metadata = project(prepared);
    const resolved = await observe(metadata);
    const hash = jevFactBindingHash(resolved);
    expect(hash).not.toBe(jevFactBindingHash({ ...resolved, artifactPlan: undefined }));
    expect(hash).not.toBe(
      jevFactBindingHash({
        ...resolved,
        artifactPlan: {
          ...resolved.artifactPlan!,
          accesses: [...resolved.artifactPlan!.accesses].reverse(),
        },
      }),
    );
    const request = vi.fn(async () => prediction());
    const decision = await evaluateJevSafety(
      { ...context, config: readBundledConfig(), artifactPlan: prepared },
      {
        endpoint: "https://decisions.example.test/v1/decisions",
        request,
        resolveFacts: async () => resolved,
      },
    );
    expect(request).toHaveBeenCalledOnce();
    expect(decision.action).toBe("allow");
    expect(decision.jev?.factsHash).toBe(hash);
    expect(decision.jev?.artifactPlanHash).toBe(prepared.hash);
    expect(decision.jev?.artifactAccessCounts).toEqual({
      mkdir: prepared.plan.directories.length,
      write: 5,
    });
    for (const file of [...prepared.plan.directories, ...prepared.plan.files])
      expect(JSON.stringify(decision.jev)).not.toContain(JSON.stringify(file));
    for (const file of [...prepared.plan.directories, ...prepared.plan.files])
      expect(decision.subject).not.toContain(file);
    expect(decision.subject).toContain(
      `artifacts mkdir=${prepared.plan.directories.length} write=5`,
    );
    const next = prepare(context.input, "next-call");
    const nextContext = { ...context, toolCallId: "next-call" };
    const nextResolved = await observe(project(next, nextContext));
    const nextDecision = await evaluateJevSafety(
      { ...nextContext, config: readBundledConfig(), artifactPlan: next },
      {
        endpoint: "https://decisions.example.test/v1/decisions",
        request: async () => prediction(),
        resolveFacts: async () => nextResolved,
      },
    );
    expect(nextDecision.jev?.inputHash).toBe(decision.jev?.inputHash);
    expect(nextDecision.jev?.factsHash).not.toBe(decision.jev?.factsHash);
    expect(nextDecision.fingerprint).not.toBe(decision.fingerprint);
  });
});
