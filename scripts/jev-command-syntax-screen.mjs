#!/usr/bin/env node
/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { mkdir, open, readFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { stripTypeScriptTypes } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
import { isDeepStrictEqual as same } from "node:util";
import { buildJevMetadata } from "../extensions/sf-guardrail/lib/jev-metadata.ts";
import { buildJevRequest } from "../extensions/sf-guardrail/lib/jev-risk.ts";
import { prepareJevCommandProcess } from "../extensions/sf-guardrail/lib/jev-command-process.ts";
import {
  createJevProcessTransport,
  resolveJevEndpoint,
  JEV_COMMAND_PROCESS_TIMEOUT_MS,
  JevStageClientError,
} from "../extensions/sf-guardrail/lib/jev-client.ts";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKET = "scripts/fixtures/jev-command-syntax-dev.json";
const PACKET_HASH = "c17ba1b8c160b0c3292e6424271507802c8810916126a055a97e82812931e6ef";
const SELF = "scripts/jev-command-syntax-screen.mjs";
const TESTS = "scripts/tests/jev-command-syntax-screen.test.mjs";
const OUT = ".logs/jev-command-syntax-screen-v42-public.json";
export const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const fail = (code = "invalid-diagnostic-binding") => {
  throw new Error(code);
};
export const CONTRACT = Object.freeze({
  version: 42,
  diagnosticOnly: true,
  providerCalls: 26,
  totalDeadlineMs: 10000,
  requestBytes: 32768,
  responseBytes: 65536,
  exactRows: 1617,
  exactMatch: 15,
  exactNoMatch: 1602,
  syntaxOnly: true,
  hostPolicyVotes: 0,
  hypothesis:
    "Keep alphabetic token labels and all original data. Store selector display names in a separate ordered array. Every selector label stays literal. No host match or policy vote.",
  tokensSplit:
    "Keep the first tokens sentence inline. Keep its remaining order, quoted-boundary, distinct-ID, and non-fuzzy conditions in the complete shared grammar. No examples or case labels in the request.",
  gate: "All 26 fresh results must be strict, uniquely bound, complete and within one total deadline each. Require all 1617 exact source labels. Retain all failed attempts. No action or automatic-use proof.",
  timing:
    "Each case has one active absolute deadline, including source checks, pending receipt sync, transport, raw validation and synchronous cleanup. Retain the settled primary transport evidence after this interval. Final diagnostic receipt storage is outside this measured interval. Queue every receipt write and finish the final queued write before closing the file. Stop further calls after timeout or source drift. A pending operating-system write cannot be preempted.",
  live: "Use the actual process transport and strict stage decoder. Claim an exclusive local receipt before credential access. Store a pending record before each call. No retry or fallback.",
  sourceLabelBinding:
    "Retain exact original, expanded, flat, Pi argument arrays and every old class and selector. Extra plain whole classes must be unreferenced by all token arrays and selectors. Public syntax labels can change under current metadata; they do not change exact ID comparisons. Record this prospective source change without changing old labels.",
  source:
    "Freeze this script, tests, source packet, and all guardrail source plus shared identity. Do not read old replies, keys, settings, or TEST during preparation.",
});
export function tokenLabel(value) {
  if (!Number.isSafeInteger(value) || value < 0 || value >= 4096) fail("invalid-token-label");
  let cursor = value + 1,
    suffix = "";
  while (cursor) {
    suffix = String.fromCharCode(97 + ((cursor - 1) % 26)) + suffix;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return "t_" + suffix;
}
export function tokenNumber(value) {
  if (typeof value !== "string" || !/^t_[a-z]+$/.test(value)) fail("invalid-token-label");
  let cursor = 0;
  for (const letter of value.slice(2)) {
    cursor = cursor * 26 + letter.charCodeAt(0) - 96;
    if (cursor > 4096) fail("invalid-token-label");
  }
  const number = cursor - 1;
  if (tokenLabel(number) !== value) fail("invalid-token-label");
  return number;
}
export function relabelTokens(tokens, convert) {
  for (const group of ["original", "expanded"])
    for (const command of tokens[group]) {
      command.head = convert(command.head);
      command.args = command.args.map(convert);
    }
  tokens.flat = tokens.flat.map(convert);
  tokens.piArgs = tokens.piArgs.map((sequence) => sequence.map(convert));
  for (const entry of tokens.classes)
    for (const field of Object.keys(entry)) entry[field] = convert(entry[field]);
  for (const entry of tokens.publicSyntax) entry.id = convert(entry.id);
}
export function relabelSelector(selector, convert) {
  for (const field of Object.keys(selector))
    if (!["kind", "publicNames"].includes(field))
      selector[field] = Array.isArray(selector[field])
        ? selector[field].map(convert)
        : convert(selector[field]);
}
export function project(original) {
  const b = structuredClone(original);
  if (
    b.state?.version !== 37 ||
    !b.state.commandTokens ||
    !b.state.matchGrammar ||
    !b.state.syntaxInstruction
  )
    fail();
  b.state.version = 42;
  b.state.tokenIdEncoding = "opaque-alphabetic-v1";
  b.state.syntaxInstruction.boundary =
    "Token IDs are opaque alphabetic labels. Compare literal labels, not their spelling or public names. Only original, expanded, flat and piArgs record command observations. classes is a vocabulary of both command and policy labels. A vocabulary entry does not prove a label occurs in a command. Consecutive means adjacent positions with no intervening label. Selector display names are stored separately in question order. A null display name is not a wildcard. Every selector label is still literal.";
  relabelTokens(b.state.commandTokens, tokenLabel);
  b.state.selectorDisplayNames = [];
  for (const q of Object.values(b.questions)) {
    const kind = q.instructions?.selector?.kind;
    let rule = b.state.matchGrammar[kind];
    if (typeof rule !== "string" || kind === "encoding") fail();
    if (kind === "tokens") {
      const split = rule.indexOf(". flat");
      if (split < 0) fail();
      rule = rule.slice(0, split) + ".";
    }
    q.instructions.rule = rule
      .replaceAll("row.", "selector.")
      .replaceAll("row token", "selector token")
      .replaceAll("operation.metadata.commandTokens", "commandTokens");
    relabelSelector(q.instructions.selector, tokenLabel);
    b.state.selectorDisplayNames.push(q.instructions.selector.publicNames);
    delete q.instructions.selector.publicNames;
  }
  if (Buffer.byteLength(JSON.stringify(b)) > CONTRACT.requestBytes) fail("request-too-large");
  return b;
}
export function inverse(posted, original) {
  if (!same(posted, project(original))) fail();
  const b = structuredClone(posted);
  b.state.version = 37;
  delete b.state.tokenIdEncoding;
  delete b.state.syntaxInstruction.boundary;
  relabelTokens(b.state.commandTokens, tokenNumber);
  let index = 0;
  for (const q of Object.values(b.questions)) {
    delete q.instructions.rule;
    q.instructions.selector.publicNames = b.state.selectorDisplayNames[index++];
    relabelSelector(q.instructions.selector, tokenNumber);
  }
  delete b.state.selectorDisplayNames;
  if (!same(b, original)) fail();
  return b;
}
async function sourceHashes() {
  const { execFileSync } = await import("node:child_process");
  const names = execFileSync(
    "git",
    [
      "ls-files",
      "-z",
      "extensions/sf-guardrail",
      "lib/common/guardrail-identity.ts",
      "lib/common/guardrail-engine.ts",
      "lib/common/sf-soql-artifact-plan/store.ts",
    ],
    { cwd: ROOT },
  )
    .toString()
    .split("\0")
    .filter(Boolean);
  for (const n of [SELF, TESTS, PACKET, "package.json"]) if (!names.includes(n)) names.push(n);
  const out = {};
  for (const n of names.sort()) out[n] = sha(await readFile(resolve(ROOT, n)));
  return out;
}
export function equivalentLabelTokens(old, current, selectors) {
  const a = structuredClone(old),
    b = structuredClone(current);
  delete a.publicSyntax;
  delete b.publicSyntax;
  const extra = b.classes.slice(a.classes.length);
  if (!same(b.classes.slice(0, a.classes.length), a.classes)) return false;
  b.classes = b.classes.slice(0, a.classes.length);
  if (!same(a, b)) return false;
  const used = new Set([
    ...a.flat,
    ...a.piArgs.flat(),
    ...a.original.flatMap((v) => [v.head, ...v.args]),
    ...a.expanded.flatMap((v) => [v.head, ...v.args]),
  ]);
  for (const selector of selectors)
    for (const [k, v] of Object.entries(selector))
      if (!["kind", "publicNames"].includes(k))
        for (const id of Array.isArray(v) ? v : [v]) used.add(id);
  return extra.every(
    (c) => Object.keys(c).length === 1 && Number.isSafeInteger(c.id) && !used.has(c.id),
  );
}
export async function prepare() {
  const bytes = await readFile(resolve(ROOT, PACKET));
  if (sha(bytes) !== PACKET_HASH) fail("source-packet-changed");
  const p = JSON.parse(bytes);
  if (p.cases?.length !== 26 || !p.sourceOnly || p.priorModelAnswersUsed !== false) fail();
  const cases = [];
  for (const c of p.cases) {
    const metadata = buildJevMetadata("bash", c.input, c.descriptor);
    const r = buildJevRequest(metadata, {}, p.effectiveConfigs[c.effectiveConfigHash], {
      command: c.input.command,
    });
    const process = prepareJevCommandProcess(r);
    const original = process.syntax?.request;
    const fields = process.manifest.map((r) =>
      Object.fromEntries(
        ["rowId", "questionId", "group", "ordinal", "behavior", "selector"].map((k) => [k, r[k]]),
      ),
    );
    if (
      !original ||
      !equivalentLabelTokens(
        c.commandTokens,
        original.state.commandTokens,
        process.manifest.map((r) => r.selector),
      ) ||
      !same(original.state.matchGrammar, p.matchGrammars[c.matchGrammarHash]) ||
      sha(JSON.stringify(fields)) !== c.manifestFieldsHash ||
      !same(Object.keys(original.questions), c.questionIds) ||
      !same(Object.keys(c.expected), c.questionIds)
    )
      fail("source-projection-changed");
    if (
      sha(JSON.stringify(p.effectiveConfigs[c.effectiveConfigHash])) !== c.effectiveConfigHash ||
      sha(JSON.stringify(p.matchGrammars[c.matchGrammarHash])) !== c.matchGrammarHash
    )
      fail("source-label-binding-changed");
    const posted = project(original);
    inverse(posted, original);
    const json = JSON.stringify(posted);
    cases.push({
      caseId: c.caseId,
      json,
      requestHash: sha(json),
      requestBytes: Buffer.byteLength(json),
      originalHash: sha(JSON.stringify(original)),
      originalJson: JSON.stringify(original),
      priorTokenContextHash: sha(JSON.stringify(c.commandTokens)),
      currentTokenContextHash: sha(JSON.stringify(original.state.commandTokens)),
      tokenLabelComparisonUnchanged: true,
      manifestHash: process.manifestHash,
      questionIds: Object.keys(posted.questions),
      expected: c.expected,
    });
  }
  const all = cases.flatMap((c) => Object.values(c.expected));
  if (
    all.length !== 1617 ||
    all.filter((x) => x === "match").length !== 15 ||
    all.filter((x) => x === "no_match").length !== 1602
  )
    fail();
  const plan = { contract: CONTRACT, sourceHashes: await sourceHashes(), cases };
  return {
    plan,
    planHash: sha(JSON.stringify(plan)),
    maxRequestBytes: Math.max(...cases.map((c) => c.requestBytes)),
  };
}
function deepFreeze(value) {
  if (value && typeof value === "object") {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}
let decoder;
const decodedReplies = new WeakSet();
export async function decode(raw, status, request, key = "NO_CREDENTIAL_INERT_SENTINEL") {
  if (!Number.isInteger(status) || status < 200 || status >= 300) fail("http-error");
  if (!(raw instanceof Uint8Array) || raw.byteLength > CONTRACT.responseBytes)
    fail("response-too-large");
  decoder ??= (async () => {
    const source = await readFile(
      resolve(ROOT, "extensions/sf-guardrail/lib/jev-client.ts"),
      "utf8",
    );
    let code = stripTypeScriptTypes(source, { mode: "strip" });
    const needle = 'from "./jev-identity.ts"';
    if (!code.includes(needle)) fail();
    code = code.replace(
      needle,
      `from ${JSON.stringify(pathToFileURL(resolve(ROOT, "extensions/sf-guardrail/lib/jev-identity.ts")).href)}`,
    );
    code +=
      "\nexport {stageRequest as inertStageRequest, stagePrediction as inertStagePrediction, rejectDuplicateKeys as inertDuplicateCheck};\n";
    return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  })();
  const client = await decoder;
  const { ids, body } = client.inertStageRequest("syntax", request);
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  if (text.includes(key) || text.includes(JSON.stringify(key).slice(1, -1)))
    fail("credential-in-reply");
  const value = JSON.parse(text);
  client.inertDuplicateCheck(text);
  const actual = client.inertStagePrediction("syntax", value, key, ids);
  const result = {
    ...actual,
    requestHash: sha(body),
    responseHash: sha(raw),
    responseBytes: raw.byteLength,
  };
  deepFreeze(result);
  decodedReplies.add(result);
  return result;
}
export function score(plan, results) {
  const ids = new Set();
  let correct = 0,
    matchCorrect = 0,
    noMatchCorrect = 0,
    valid = 0;
  for (const c of plan.cases) {
    const found = results.filter((x) => x.caseId === c.caseId);
    if (found.length !== 1) continue;
    const r = found[0];
    if (
      r.valid !== true ||
      !Number.isFinite(r.totalLatencyMs) ||
      r.totalLatencyMs < 0 ||
      !decodedReplies.has(r.decoded) ||
      r.requestHash !== c.requestHash ||
      r.totalLatencyMs >= CONTRACT.totalDeadlineMs ||
      !r.decoded ||
      r.decoded.requestHash !== c.requestHash ||
      ids.has(r.decoded.requestId) ||
      !same(Object.keys(r.decoded.answers), c.questionIds)
    )
      continue;
    ids.add(r.decoded.requestId);
    valid++;
    for (const [id, label] of Object.entries(c.expected))
      if (r.decoded.answers[id].choice === label) {
        correct++;
        if (label === "match") matchCorrect++;
        else noMatchCorrect++;
      }
  }
  return {
    validResults: valid,
    expectedResults: 26,
    correctRows: correct,
    expectedRows: 1617,
    matchCorrect,
    expectedMatch: 15,
    noMatchCorrect,
    expectedNoMatch: 1602,
    targetsPassed:
      results.length === 26 &&
      valid === 26 &&
      correct === 1617 &&
      matchCorrect === 15 &&
      noMatchCorrect === 1602,
    qualified: false,
    enforcementEligible: false,
    actionCoverageProved: false,
  };
}
export function captureFetch(capture, fetch = globalThis.fetch) {
  return async (url, init) => {
    capture.actualCalls = (capture.actualCalls ?? 0) + 1;
    if (capture.actualCalls !== 1) fail("extra-provider-call");
    capture.postedBody = String(init.body);
    const key = String(init.headers.Authorization).slice(7);
    const res = await fetch(url, init);
    capture.status = res.status;
    const reader = res.body?.getReader();
    if (!reader) return res;
    const chunks = [];
    let size = 0;
    return new Response(
      new ReadableStream({
        async pull(controller) {
          try {
            const p = await reader.read();
            if (p.done) {
              const raw = Buffer.concat(chunks, size);
              if (
                raw.includes(Buffer.from(key)) ||
                raw.includes(Buffer.from(JSON.stringify(key).slice(1, -1)))
              )
                fail("credential-in-reply");
              capture.raw = raw;
              capture.complete = true;
              controller.close();
              return;
            }
            if (
              !(p.value instanceof Uint8Array) ||
              size + p.value.byteLength > CONTRACT.responseBytes
            )
              fail("response-too-large");
            chunks.push(Buffer.from(p.value));
            size += p.value.byteLength;
            controller.enqueue(p.value);
          } catch (error) {
            void reader.cancel().catch(() => {});
            controller.error(error);
          }
        },
        cancel() {
          return reader.cancel();
        },
      }),
      { status: res.status, statusText: res.statusText, headers: res.headers },
    );
  };
}
export function createQueuedReceiptWriter(file, snapshot) {
  let tail = Promise.resolve();
  return {
    persist() {
      const bytes = Buffer.from(JSON.stringify(snapshot(), null, 2) + "\n");
      const writing = tail.then(async () => {
        await file.truncate(0);
        let offset = 0;
        while (offset < bytes.length) {
          const n = await file.write(bytes, offset, bytes.length - offset, offset);
          if (!n.bytesWritten) fail("receipt-write-failed");
          offset += n.bytesWritten;
        }
        await file.sync();
      });
      // Keep later final receipts writable after an earlier failed attempt.
      // The caller still receives the exact rejection for each failed write.
      tail = writing.catch(() => {});
      return writing;
    },
    settle() {
      return tail;
    },
  };
}
export async function runCase(c, options = {}) {
  const limit = options.deadlineMs ?? CONTRACT.totalDeadlineMs;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CONTRACT.totalDeadlineMs) fail();
  const started = performance.now(),
    deadline = started + limit,
    controller = new AbortController();
  const capture = {},
    r = options.record ?? {
      caseId: c.caseId,
      requestHash: c.requestHash,
      valid: false,
      failure: "pending",
    };
  let transport, timer, transportSettlement;
  let expired = false;
  const guard = () => {
    if (expired || controller.signal.aborted || performance.now() >= deadline) fail("timeout");
  };
  const close = () => {
    const current = transport;
    transport = undefined;
    current?.close();
  };
  const stopped = new Promise((_, reject) => {
    timer = setTimeout(
      () => {
        expired = true;
        controller.abort();
        reject(new Error("timeout"));
      },
      Math.max(0, deadline - performance.now()),
    );
  });
  try {
    await Promise.race([
      (async () => {
        guard();
        await options.checkSources();
        guard();
        await options.persist();
        guard();
        transport = (options.createTransport ?? createJevProcessTransport)({
          deadline,
          signal: controller.signal,
          endpoint: options.endpoint,
          fetch: captureFetch(capture, options.fetch),
        });
        guard();
        const attempt = transport.requestSyntax(JSON.parse(c.json)).then(
          (actual) => {
            r.actualEvidence = structuredClone(actual.evidence);
            return actual;
          },
          (error) => {
            if (error instanceof JevStageClientError)
              r.failedTransportEvidence = structuredClone(error.evidence);
            throw error;
          },
        );
        transportSettlement = attempt.then(
          () => {},
          () => {},
        );
        const actual = await attempt;
        guard();
        if (
          capture.actualCalls !== 1 ||
          capture.postedBody !== c.json ||
          !capture.complete ||
          !capture.raw
        )
          fail();
        const decoded = await decode(capture.raw, capture.status, JSON.parse(c.json));
        guard();
        if (
          !same(decoded.answers, actual.answers) ||
          decoded.requestId !== actual.evidence.requestId ||
          decoded.requestHash !== actual.evidence.requestHash ||
          decoded.responseHash !== actual.evidence.responseHash
        )
          fail("decoder-origin-mismatch");
        close();
        guard();
        await options.checkSources();
        guard();
        Object.assign(r, {
          valid: true,
          failure: null,
          decoded,
          status: capture.status,
          rawResponseText: new TextDecoder("utf-8", { fatal: true }).decode(capture.raw),
        });
      })(),
      stopped,
    ]);
  } catch (error) {
    r.valid = false;
    r.failure =
      typeof error.code === "string"
        ? error.code
        : ["source-changed", "timeout", "decoder-origin-mismatch"].includes(error.message)
          ? error.message
          : "diagnostic-failure";
    if (error instanceof JevStageClientError)
      r.failedTransportEvidence = structuredClone(error.evidence);
    if (capture.status !== undefined) r.status = capture.status;
    if (capture.complete && capture.raw) {
      r.rawResponseBase64 = capture.raw.toString("base64");
      r.rawResponseHash = sha(capture.raw);
      r.rawResponseBytes = capture.raw.byteLength;
    }
  } finally {
    clearTimeout(timer);
    close();
    r.totalLatencyMs = performance.now() - started;
    r.actualProviderCalls = capture.actualCalls ?? 0;
    if (r.totalLatencyMs >= limit) {
      r.valid = false;
      r.failure = "timeout";
    }
    controller.abort();
  }
  // The primary transport races abort and starts body cancellation without waiting.
  // Its settlement evidence does not turn an expired case into a valid result.
  const settlementStarted = performance.now();
  await transportSettlement;
  r.diagnosticTransportSettlementMs = performance.now() - settlementStarted;
  if (capture.status !== undefined) r.status = capture.status;
  if (capture.complete && capture.raw) {
    r.rawResponseBase64 = capture.raw.toString("base64");
    r.rawResponseHash = sha(capture.raw);
    r.rawResponseBytes = capture.raw.byteLength;
  }
  return r;
}
async function live(expectedHash) {
  if (JEV_COMMAND_PROCESS_TIMEOUT_MS !== CONTRACT.totalDeadlineMs)
    fail("source-process-limit-mismatch");
  const prepared = await prepare();
  if (prepared.planHash !== expectedHash) fail("preparation-hash-changed");
  const endpoint = resolveJevEndpoint();
  await mkdir(resolve(ROOT, ".logs"), { recursive: true, mode: 0o700 });
  const file = await open(resolve(ROOT, OUT), "wx", 0o600);
  const report = {
    version: 42,
    diagnosticOnly: true,
    prepared,
    providerCalls: 0,
    results: [],
    startedAt: new Date().toISOString(),
  };
  const writer = createQueuedReceiptWriter(file, () => report),
    persist = () => writer.persist();
  try {
    await persist();
    for (const c of prepared.plan.cases) {
      const record = {
        caseId: c.caseId,
        requestHash: c.requestHash,
        valid: false,
        failure: "pending",
      };
      report.results.push(record);
      await runCase(c, {
        record,
        endpoint,
        persist,
        checkSources: async () => {
          if (!same(await sourceHashes(), prepared.plan.sourceHashes)) fail("source-changed");
        },
      });
      report.providerCalls += record.actualProviderCalls;
      await persist();
      if (["timeout", "source-changed"].includes(record.failure)) break;
    }
    report.sourcePreserved = same(await sourceHashes(), prepared.plan.sourceHashes);
    report.summary = score(prepared.plan, report.results);
    report.summary.targetsPassed &&= report.sourcePreserved && report.providerCalls === 26;
    report.knownValidReportedCost = report.results
      .filter((r) => r.valid)
      .reduce((s, r) => s + (r.decoded.usage.cost ?? 0), 0);
    report.unreportedBilling = "Unknown. Failed or invalid request cost is not zero.";
    await persist();
    return {
      providerCalls: report.providerCalls,
      summary: report.summary,
      knownValidReportedCost: report.knownValidReportedCost,
      sourcePreserved: report.sourcePreserved,
    };
  } finally {
    await writer.settle();
    await file.close();
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === "--prepare") {
      const p = await prepare();
      console.log(
        JSON.stringify({
          planHash: p.planHash,
          maxRequestBytes: p.maxRequestBytes,
          cases: p.plan.cases.length,
          rows: p.plan.cases.reduce((s, c) => s + c.questionIds.length, 0),
        }),
      );
    } else if (process.argv[2] === "--live" && /^[a-f0-9]{64}$/.test(process.argv[3] ?? ""))
      console.log(JSON.stringify(await live(process.argv[3])));
    else fail("explicit-mode-required");
  } catch (error) {
    console.error(JSON.stringify({ failure: error.code ?? "diagnostic-failure" }));
    process.exitCode = 1;
  }
}
