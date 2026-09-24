/* SPDX-License-Identifier: Apache-2.0 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const runNode = promisify(execFile);
const sourceUrl = (path: string) => new URL("../../" + path, import.meta.url).href;
const urls = {
  baseline: sourceUrl("scripts/jev-guardrail-baseline-eval.ts"),
  scorer: sourceUrl("scripts/jev-guardrail-replacement-score.ts"),
  browser: sourceUrl("lib/common/sf-browser-snapshot-state.ts"),
  risk: sourceUrl("extensions/sf-guardrail/lib/jev-risk.ts"),
  facts: sourceUrl("extensions/sf-guardrail/lib/jev-facts.ts"),
  piPaths: sourceUrl("lib/common/pi-paths.ts"),
};

const childGuards = String.raw`
import assert from "node:assert/strict";
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { performance } from "node:perf_hooks";
const urls = JSON.parse(process.argv[2]);
const initialProfile = process.env.PI_CODING_AGENT_DIR;
const initialHome = process.env.HOME;
const keySentinel = join(initialProfile, "credential-read-sentinel");
assert.equal(process.env.SF_GUARDRAIL_JEV_API_KEY, undefined);
assert.equal(process.env.SF_GUARDRAIL_JEV_API_KEY_FILE, undefined);
process.env.SF_GUARDRAIL_JEV_API_KEY_FILE = keySentinel;
const counters = { fetch: 0, keyEnvironment: 0, keyFile: 0, dispatch: 0, subprocess: 0 };
process.env = new Proxy(process.env, {
  get(target, name) {
    if (name === "SF_GUARDRAIL_JEV_API_KEY" || name === "SF_GUARDRAIL_JEV_API_KEY_FILE") counters.keyEnvironment++;
    return Reflect.get(target, name);
  },
  set(target, name, value) { target[name] = value; return true; },
});
globalThis.fetch = async () => { counters.fetch++; throw new Error("Unexpected fetch."); };
const originalOpen = fs.openSync;
fs.openSync = (path, ...args) => {
  if (String(path) === keySentinel) { counters.keyFile++; throw new Error("Unexpected credential read."); }
  return originalOpen(path, ...args);
};
for (const name of ["exec", "execFile", "spawn", "fork", "execSync", "execFileSync", "spawnSync"]) {
  childProcess[name] = () => { counters.subprocess++; throw new Error("Unexpected tool dispatch."); };
}
syncBuiltinESMExports();
const config = { version: 1, productionAliases: [], headlessEscapeHatchEnv: "TEST_COLD_HEADLESS", confirmTimeoutMs: 300,
  policies: { rules: [] }, orgAwareGate: { rules: [] }, commandGate: { patterns: [], allowedPatterns: [], autoDenyPatterns: [] } };
`;

const coldProfileChild =
  childGuards +
  String.raw`
const browserRelative = join("sf-pi", "sf-browser", "snapshots", "latest-refs.json");
const canaryPath = join(initialProfile, browserRelative);
const canary = JSON.stringify({ schemaVersion: 1, state: { sessions: [{ sessionId: "cold-canary", capturedAt: new Date().toISOString(),
  refs: [{ ref: "e7", role: "button", label: "Keep canary", line: '- button "Keep canary" [ref=e7]' }] }] } });
await fs.promises.mkdir(dirname(canaryPath), { recursive: true });
await fs.promises.writeFile(canaryPath, canary);
await fs.promises.writeFile(join(initialHome, "home-canary"), "Keep private home.\n");
async function inventory(root, prefix = "") {
  const entries = await fs.promises.readdir(join(root, prefix), { withFileTypes: true });
  const result = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = join(prefix, entry.name);
    if (entry.isDirectory()) result.push([relative, "directory"], ...await inventory(root, relative));
    else result.push([relative, createHash("sha256").update(await fs.promises.readFile(join(root, relative))).digest("hex")]);
  }
  return result;
}
const initialInventory = await inventory(initialProfile);
const homeInventory = await inventory(initialHome);
const browserWrites = [];
const originalRename = fs.renameSync;
fs.renameSync = (from, to) => {
  if (String(to).endsWith(browserRelative)) browserWrites.push(String(to));
  return originalRename(from, to);
};
syncBuiltinESMExports();
// Both public script imports precede the evaluator's private profile selection.
const baseline = await import(urls.baseline);
const scorer = await import(urls.scorer);
assert.deepEqual(await inventory(initialProfile), initialInventory);
const evaluator = await baseline.createBaselineDevEvaluator();
const ownedProfile = process.env.PI_CODING_AGENT_DIR;
const ownedRoot = dirname(ownedProfile);
assert.notEqual(ownedProfile, initialProfile);
assert.equal(fs.existsSync(join(ownedProfile, browserRelative)), false);
let receipt;
try {
  let preparedBrowser;
  let fileFactoryCalls = 0;
  const preparedRequests = [];
  const fileConfig = { ...config, policies: { rules: [{ id: "cold-file-read", protection: "noAccess",
    patterns: [{ pattern: "**/cold-note.txt" }], allowedPatterns: [{ pattern: "**/cold-public.txt" }],
    enabled: true, onlyIfExists: true, behavior: "block" }] } };
  const results = await evaluator.runCases([
    { id: "cold-cancel", family: "cold-browser-control", group: "control",
      tool: "sf_browser_click", input: { ref: "e1" }, browser: { role: "button", label: "Cancel", status: "fresh" },
      gold: { action: "allow", reason: "Fresh authored Cancel control." } },
    { id: "cold-file-read", family: "cold-file-policy", group: "policy", tool: "read",
      input: { path: "cold-note.txt" }, files: ["cold-note.txt"],
      gold: { action: "block", reason: "The file rule blocks this read." } },
  ], {
    prepareOnly: true, config: fileConfig,
    createTransport: () => { counters.dispatch++; throw new Error("Unexpected provider factory."); },
    createFileTransport: () => { fileFactoryCalls++; throw new Error("Unexpected file transport factory."); },
    onRequestPrepared: (request, caseId, stage) => {
      preparedRequests.push({ caseId, stage, request });
      if (caseId === "cold-cancel") preparedBrowser = request.state.facts.browser;
    },
  });
  const [result, fileResult] = results;
  const browser = await import(urls.browser);
  const lookup = browser.findLatestBrowserSnapshotRefLookup("baseline-development-cold-cancel", "e1");
  assert.equal(lookup.status, "fresh");
  assert.equal(lookup.ref.role, "button");
  assert.equal(lookup.ref.label, "Cancel");
  assert.deepEqual(preparedBrowser, { status: "fresh", role: "button", label: "Cancel" });
  for (const row of results) {
    assert.equal(row.stage, "prepared");
    assert.equal(row.syntheticPreparation, true);
    assert.equal(row.candidateAction, null);
    assert.equal(row.requestInvoked, false);
    assert.equal(row.complete, true);
    assert.equal(row.baselineFailure, undefined);
    for (const field of ["process", "model", "provider", "requestId", "riskOrigin", "modelChoice", "probabilities", "confidence", "cost"]) assert.equal(row[field], undefined);
  }
  assert.equal(fileResult.baselineAction, "block");
  assert.equal(fileFactoryCalls, 0);
  const fileRequests = preparedRequests.filter((prepared) => prepared.caseId === "cold-file-read");
  assert.deepEqual(fileRequests.map((prepared) => prepared.stage), ["file_match", "all_heads"]);
  const [fileMatch, fileActions] = fileRequests;
  const fileMatchIds = Object.keys(fileMatch.request.questions);
  assert.deepEqual(fileMatchIds, ["f_a", "f_b"]);
  assert.ok(fileMatchIds.length <= 8);
  for (const question of Object.values(fileMatch.request.questions)) assert.deepEqual(Object.keys(question.criteria).sort(), ["match", "no_match", "unknown"]);
  assert.ok(Object.hasOwn(fileActions.request.questions, "risk"));
  assert.ok(Object.hasOwn(fileActions.request.questions, "file_policy"));
  assert.deepEqual(fileResult.questionIds, Object.keys(fileActions.request.questions));
  assert.equal(fileResult.questionIds.some((id) => fileMatchIds.includes(id)), false);
  assert.deepEqual(Object.keys(fileResult.answers).sort(), [...fileResult.questionIds].sort());
  assert.ok(fileResult.fileSourceRequest);
  assert.equal(fileResult.syntheticFilePreparation.syntheticPreparation, true);
  const fileStage = fileResult.syntheticFilePreparation.fileStage;
  assert.equal(fileStage.format, "file_match_then_policy");
  assert.equal(fileStage.match.stage, "file_match");
  assert.deepEqual(Object.keys(fileStage.match.answers), fileMatchIds);
  for (const answer of Object.values(fileStage.match.answers)) {
    assert.equal(answer.choice, "unknown");
    assert.deepEqual(answer.probabilities, { match: 0, no_match: 0, unknown: 1 });
  }
  assert.deepEqual(fileResult.requestPreparations.map((prepared) => prepared.stage), ["file_match", "all_heads"]);
  const fileDeadline = fileResult.requestPreparations[0].deadline;
  for (const [index, prepared] of fileResult.requestPreparations.entries()) {
    assert.deepEqual(prepared.processBinding, {
      protocolHash: fileResult.protocolHash,
      operatingPointHash: fileResult.operatingPointHash,
    });
    assert.equal(typeof prepared.deadline, "number");
    assert.ok(Number.isFinite(prepared.deadline));
    assert.ok(prepared.deadline >= 0);
    assert.equal(prepared.deadline, fileDeadline);
    assert.deepEqual(prepared.request, fileRequests[index].request);
    assert.deepEqual(prepared.questionIds, Object.keys(prepared.request.questions));
    assert.equal(prepared.requestHash, createHash("sha256").update(JSON.stringify(prepared.request)).digest("hex"));
    assert.equal(prepared.requestBytes, Buffer.byteLength(JSON.stringify(prepared.request)));
  }
  const score = scorer.scoreJevGuardrailReplacement(results);
  assert.equal(score.answerEvidence.complete, 0);
  assert.equal(score.safeAutomaticAllows.matched, 0);
  assert.equal(score.addedRisks.matched, 0);
  assert.equal(score.qualified, false);
  assert.deepEqual(browserWrites, [join(ownedProfile, browserRelative)]);
  const ownedState = JSON.parse(await fs.promises.readFile(join(ownedProfile, browserRelative), "utf8"));
  assert.equal(ownedState.state.sessions.length, 1);
  assert.equal(ownedState.state.sessions[0].sessionId, "baseline-development-cold-cancel");
  assert.equal(await fs.promises.readFile(canaryPath, "utf8"), canary);
  assert.deepEqual(await inventory(initialProfile), initialInventory);
  assert.deepEqual(await inventory(initialHome), homeInventory);
  assert.deepEqual(counters, { fetch: 0, keyEnvironment: 0, keyFile: 0, dispatch: 0, subprocess: 0 });
  receipt = { browserStatus: lookup.status, browserLabel: lookup.ref.label, ownedBrowserWrites: browserWrites.length,
    syntheticPreparation: result.syntheticPreparation, syntheticFilePreparation: fileResult.syntheticFilePreparation.syntheticPreparation,
    fileMatchStage: fileStage.match.stage, fileMatchHeadCount: fileMatchIds.length,
    fileMatchChoices: Object.values(fileStage.match.answers).map((answer) => answer.choice), fileFactoryCalls,
    completeModelEvidence: score.answerEvidence.complete, counters };
} finally {
  await evaluator.dispose();
}
assert.equal(fs.existsSync(ownedRoot), false);
assert.equal(process.env.PI_CODING_AGENT_DIR, initialProfile);
assert.equal(process.env.HOME, initialHome);
assert.deepEqual(await inventory(initialProfile), initialInventory);
assert.deepEqual(await inventory(initialHome), homeInventory);
process.stdout.write(JSON.stringify({ ...receipt, ownedProfileRemoved: true, initialProfileRestored: true, canaryAndInventoryUnchanged: true }));
`;

const delayedFactsChild =
  childGuards +
  String.raw`
const { evaluateJevSafety } = await import(urls.risk);
// SDK startup is outside the measured call. The facts and browser store modules stay cold.
await import(urls.piPaths);
const receipts = [];
for (const mode of ["injected", "aborted", "expired", "default"]) {
  const controller = new AbortController();
  if (mode === "aborted") controller.abort();
  let injectedFactsCalls = 0;
  counters.dispatch = 0;
  const started = performance.now();
  const decision = await evaluateJevSafety({ toolName: "sf_browser_press", input: { key: "Escape" }, cwd: initialHome, config, sessionId: "cold-deadline" }, {
    endpoint: "https://decisions.example.invalid/v1/decisions",
    signal: controller.signal,
    deadline: mode === "expired" ? started - 1 : started + 100,
    ...(mode === "injected" ? { resolveFacts: async () => { injectedFactsCalls++; return { facts: {} }; } } : {}),
    createTransport: () => { counters.dispatch++; throw new Error("Controlled provider stop."); },
  });
  const elapsedMs = performance.now() - started;
  const delayedImportStarted = fs.existsSync(process.env.TEST_FACTS_COUNTER_PATH);
  assert.equal(decision.action, "block");
  assert.equal(decision.jev.failure, mode === "aborted" ? "cancelled" : mode === "injected" ? "invalid-input-or-context" : "deadline");
  assert.equal(delayedImportStarted, mode === "default");
  assert.equal(injectedFactsCalls, mode === "injected" ? 1 : 0);
  assert.equal(counters.dispatch, mode === "injected" ? 1 : 0);
  assert.equal(counters.fetch, 0);
  assert.equal(counters.keyEnvironment, 0);
  assert.equal(counters.keyFile, 0);
  assert.equal(counters.subprocess, 0);
  assert.equal(process.env.PI_CODING_AGENT_DIR, initialProfile);
  assert.ok(elapsedMs < 600, JSON.stringify({ mode, elapsedMs, delayedImportStarted }));
  receipts.push({ mode, action: decision.action, failure: decision.jev.failure, elapsedMs, delayedImportStarted, injectedFactsCalls, dispatch: counters.dispatch });
}
await import(urls.facts);
assert.equal(globalThis.__testDefaultFactsCalls ?? 0, 0);
assert.deepEqual(counters, { fetch: 0, keyEnvironment: 0, keyFile: 0, dispatch: 0, subprocess: 0 });
process.stdout.write(JSON.stringify({ receipts, defaultFactsCallsAfterLateLoad: globalThis.__testDefaultFactsCalls ?? 0, counters }));
`;

async function runColdChild(program: string, delayed = false) {
  const root = await mkdtemp(join(tmpdir(), "jev-cold-source-test-"));
  const home = join(root, "home");
  const profile = join(root, "initial-profile");
  const temporary = join(root, "tmp");
  const counterPath = join(root, "facts-import-started");
  const childPath = join(root, "child.mjs");
  const loaderPath = join(root, "delay-facts.mjs");
  try {
    await Promise.all([home, profile, temporary].map((path) => mkdir(path, { recursive: true })));
    await writeFile(childPath, program);
    const args = ["--experimental-strip-types"];
    if (delayed) {
      await writeFile(
        loaderPath,
        String.raw`import { writeFile } from "node:fs/promises";
export async function load(url, context, nextLoad) {
  if (url === process.env.TEST_FACTS_MODULE_URL) {
    await writeFile(process.env.TEST_FACTS_COUNTER_PATH, "started\n");
    const loaded = await nextLoad(url, context);
    const source = typeof loaded.source === "string" ? loaded.source : Buffer.from(loaded.source).toString("utf8");
    const needle = "  const { toolName, input, metadata, cwd, config, sessionId, signal } = options;";
    if (!source.includes(needle)) throw new Error("Missing actual facts entry.");
    return { ...loaded, source: "await new Promise((resolve) => setTimeout(resolve, 800));\n" + source.replace(needle,
      "  globalThis.__testDefaultFactsCalls = (globalThis.__testDefaultFactsCalls ?? 0) + 1;\n" + needle) };
  }
  return nextLoad(url, context);
}`,
      );
      args.push("--experimental-loader", pathToFileURL(loaderPath).href);
    }
    args.push(childPath, JSON.stringify(urls));
    const { stdout } = await runNode(process.execPath, args, {
      cwd: fileURLToPath(new URL("../../", import.meta.url)),
      env: {
        HOME: home,
        USERPROFILE: home,
        PI_CODING_AGENT_DIR: profile,
        TMPDIR: temporary,
        TMP: temporary,
        TEMP: temporary,
        LANG: "C.UTF-8",
        TZ: "UTC",
        TEST_FACTS_MODULE_URL: urls.facts,
        TEST_FACTS_COUNTER_PATH: counterPath,
      },
      timeout: 15_000,
      maxBuffer: 65_536,
    });
    return JSON.parse(stdout);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

describe("Jev cold Node profile and facts import", () => {
  it("keeps the initial profile intact after imports and file preparation", async () => {
    expect(await runColdChild(coldProfileChild)).toMatchObject({
      browserStatus: "fresh",
      browserLabel: "Cancel",
      ownedBrowserWrites: 1,
      syntheticPreparation: true,
      syntheticFilePreparation: true,
      fileMatchStage: "file_match",
      fileMatchHeadCount: 2,
      fileMatchChoices: ["unknown", "unknown"],
      fileFactoryCalls: 0,
      completeModelEvidence: 0,
      ownedProfileRemoved: true,
      initialProfileRestored: true,
      canaryAndInventoryUnchanged: true,
      counters: { fetch: 0, keyEnvironment: 0, keyFile: 0, dispatch: 0, subprocess: 0 },
    });
  }, 20_000);

  it("keeps one deadline while the first default facts module load is delayed", async () => {
    const receipt = await runColdChild(delayedFactsChild, true);
    expect(receipt.receipts).toEqual([
      expect.objectContaining({
        mode: "injected",
        delayedImportStarted: false,
        injectedFactsCalls: 1,
        dispatch: 1,
      }),
      expect.objectContaining({
        mode: "aborted",
        delayedImportStarted: false,
        failure: "cancelled",
        dispatch: 0,
      }),
      expect.objectContaining({
        mode: "expired",
        delayedImportStarted: false,
        failure: "deadline",
        dispatch: 0,
      }),
      expect.objectContaining({
        mode: "default",
        delayedImportStarted: true,
        failure: "deadline",
        dispatch: 0,
      }),
    ]);
    for (const call of receipt.receipts) expect(call.elapsedMs).toBeLessThan(600);
    expect(receipt.counters).toEqual({
      fetch: 0,
      keyEnvironment: 0,
      keyFile: 0,
      dispatch: 0,
      subprocess: 0,
    });
    expect(receipt.defaultFactsCallsAfterLateLoad).toBe(0);
  }, 20_000);
});
