/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { JevClientError, JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../lib/jev-client.ts";
import {
  buildJevGroupedCommandRequest,
  prepareJevCommandProcess,
  restoreJevOriginalSyntax,
  restoreJevSyntax37,
  restoreJevSyntax42,
  restoreJevSyntax43,
} from "../lib/jev-command-process.ts";
import {
  buildJevFilePolicyRequest,
  decodeJevFileTranscript,
  encodeJevFileTranscript,
  prepareJevFileProcess,
  restoreJevFileSourceRequest,
  validateJevFileMatchResult,
} from "../lib/jev-file-process.ts";
import type { JevFileProcessPlan } from "../lib/jev-file-process.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import { buildJevRequest } from "../lib/jev-risk.ts";
import type {
  GuardrailConfig,
  JevChoiceAnswer,
  JevFacts,
  JevFileMatchChoiceAnswer,
  JevFileMatchQuestionId,
  JevFileMatchStageResult,
  JevNonCommandStageResult,
  JevRequest,
  JevSyntaxStageResult,
} from "../lib/types.ts";

const forbidden = vi.hoisted(() => ({
  openSync: vi.fn(() => {
    throw new Error("Key-file reads are prohibited in this codec test.");
  }),
  fileFactory: vi.fn(() => {
    throw new Error("Transport creation is prohibited in this codec test.");
  }),
  decisionFactory: vi.fn(() => {
    throw new Error("Transport creation is prohibited in this codec test.");
  }),
}));
vi.mock("node:fs", async (original) => ({
  ...(await original<typeof import("node:fs")>()),
  openSync: forbidden.openSync,
}));
vi.mock("../lib/jev-client.ts", async (original) => ({
  ...(await original<typeof import("../lib/jev-client.ts")>()),
  createJevFileMatchProcessTransport: forbidden.fileFactory,
  createJevProcessTransport: forbidden.decisionFactory,
}));

const TRANSPORT = "c".repeat(64);
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const state = (request: JevRequest): Record<string, any> => request.state as Record<string, any>;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.values(forbidden).forEach((mock) => mock.mockClear());
  fetch = vi.fn(() => {
    throw new Error("Network dispatch is prohibited in this codec test.");
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  Object.values(forbidden).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function config(rowCount = 1): GuardrailConfig {
  return {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "SYNTHETIC_CODEC_HEADLESS",
    confirmTimeoutMs: 300,
    policies: {
      rules: Array.from({ length: rowCount }, (_, index) => ({
        id: `synthetic-row-${index}`,
        enabled: true,
        patterns: [{ pattern: "workspace/**" }],
        allowedPatterns: [{ pattern: `workspace/exception-${index}.data` }],
        protection: "noAccess",
        onlyIfExists: false,
        behavior: "block",
      })),
    },
    orgAwareGate: { rules: [] },
    commandGate: {
      allowedPatterns: [],
      autoDenyPatterns: [],
      patterns: [{ id: "synthetic-command", pattern: "git status", behavior: "confirm" }],
    },
  };
}
function records(count = 1): NonNullable<JevFacts["files"]> {
  return Array.from({ length: count }, (_, index) => ({
    path: `workspace/synthetic-${index}.data`,
    absolutePath: `/work/workspace/synthetic-${index}.data`,
    relativePath: `workspace/synthetic-${index}.data`,
    basename: `synthetic-${index}.data`,
    homeRelativePath: `~/workspace/synthetic-${index}.data`,
    exists: index === 0 ? "unknown" : false,
    kind: index === 0 ? "unknown" : "file",
  }));
}
function source(recordCount = 1, rowCount = 1, bash = false): JevRequest {
  const input = bash
    ? { command: "git status" }
    : { path: "workspace/synthetic-0.data", content: "Local synthetic data." };
  return buildJevRequest(
    buildJevMetadata(bash ? "bash" : "write", input),
    { files: records(recordCount) },
    config(rowCount),
    bash ? { command: "git status" } : {},
  );
}
function staged(value = source(), bash = false): JevFileProcessPlan {
  const plan = prepareJevFileProcess(value, bash);
  expect(plan.format).toBe("file_match_then_policy");
  expect(plan.match).toBeDefined();
  return plan;
}
function answer(index: number): JevFileMatchChoiceAnswer {
  const examples: JevFileMatchChoiceAnswer[] = [
    {
      choice: "unknown",
      probabilities: { match: 0.019877, no_match: 0.01, unknown: 0.970123 },
      confidence: 0.1234567890123456,
    },
    {
      choice: "match",
      probabilities: { match: 0.987654321, no_match: 0.012345678, unknown: 0.000000001 },
      confidence: Number.MIN_VALUE,
    },
    { choice: "no_match", probabilities: { match: 0, no_match: 1, unknown: -0 }, confidence: -0 },
    {
      choice: "unknown",
      probabilities: { match: 0.34, no_match: 0.33, unknown: 0.34 },
      confidence: 0.9999999999999999,
    },
  ];
  return structuredClone(examples[index % examples.length]);
}
function receipt(plan: JevFileProcessPlan): JevFileMatchStageResult {
  const answers = Object.fromEntries(
    plan.selection.questionIds.map((id, index) => [id, answer(index)]),
  );
  const raw = JSON.stringify({
    id: "gen-synthetic-codec",
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    answers,
    usage: { input_tokens: 37, output_tokens: 19, cost: 0.0001234567890123456 },
  });
  return {
    stage: "file_match",
    answers,
    evidence: {
      requestedQuestionIds: plan.selection.questionIds as JevFileMatchQuestionId[],
      requestHash: plan.match.hash,
      responseHash: hash(raw),
      transportHash: TRANSPORT,
      requestBytes: plan.match.bytes,
      responseBytes: Buffer.byteLength(raw),
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      requestId: "gen-synthetic-codec",
      usage: { input_tokens: 37, output_tokens: 19, cost: 0.0001234567890123456 },
      latencyMs: 7.123456789012345,
    },
  };
}
function packet(plan: JevFileProcessPlan, actual = receipt(plan)) {
  return JSON.parse(encodeJevFileTranscript(plan, actual, TRANSPORT)) as any[];
}
function rejectPacket(plan: JevFileProcessPlan, fields: any[], expected = receipt(plan)) {
  expect(() => decodeJevFileTranscript(plan, JSON.stringify(fields), TRANSPORT, expected)).toThrow(
    JevClientError,
  );
}
function legacy(value: JevRequest, bash = false) {
  const json = JSON.stringify(value);
  const plan = prepareJevFileProcess(value, bash);
  expect(plan.format).toBe("legacy");
  expect(plan.original).toEqual({
    request: value,
    json,
    bytes: Buffer.byteLength(json),
    hash: hash(json),
  });
  expect(plan.match).toBeUndefined();
  expect(plan.maxTranscriptBytes).toBeUndefined();
  expect(plan.original.request.state).not.toHaveProperty("fileMatch");
  expect(plan.original.request.questions).toEqual(value.questions);
  return plan;
}

describe("strict actual transcript contract", () => {
  it("has sixteen fields and exact ordered six-field raw answer tuples", () => {
    const plan = staged(source(2, 2));
    const actual = receipt(plan);
    const encoded = encodeJevFileTranscript(plan, actual, TRANSPORT);
    const fields = JSON.parse(encoded);
    expect(fields).toHaveLength(16);
    expect(fields.slice(0, 9)).toEqual([
      1,
      plan.selection.stateHash,
      plan.selection.manifestHash,
      actual.evidence.requestHash,
      actual.evidence.responseHash,
      TRANSPORT,
      JEV_RESOLVED_MODEL,
      JEV_PROVIDER,
      "gen-synthetic-codec",
    ]);
    expect(fields[15]).toHaveLength(8);
    expect(fields[15][0]).toEqual(["f_a", 2, "0.019877", "0.01", "0.970123", "0.1234567890123456"]);
    expect(fields[15][1]).toEqual(["f_b", 0, "0.987654321", "0.012345678", "1e-9", "5e-324"]);
    expect(fields[15][2]).toEqual(["f_c", 1, "0", "1", "-0", "-0"]);
    expect(fields[15][3]).toEqual(["f_d", 2, "0.34", "0.33", "0.34", "0.9999999999999999"]);
    expect(fields[15].map((tuple: any[]) => tuple[0])).toEqual([
      "f_a",
      "f_b",
      "f_c",
      "f_d",
      "f_e",
      "f_f",
      "f_g",
      "f_h",
    ]);
    const decoded = decodeJevFileTranscript(plan, encoded, TRANSPORT, actual);
    expect(decoded).toEqual(actual);
    expect(Object.is(decoded.answers.f_c.probabilities.unknown, -0)).toBe(true);
    expect(Object.is(decoded.answers.f_c.confidence, -0)).toBe(true);
  });

  it("retains source-valid signed zero in every permitted numeric role", () => {
    const plan = staged();
    const actual = receipt(plan);
    actual.answers.f_a = {
      choice: "match",
      probabilities: { match: 1, no_match: -0, unknown: -0 },
      confidence: -0,
    };
    actual.evidence.usage = { input_tokens: -0, output_tokens: -0, cost: -0 };
    actual.evidence.latencyMs = -0;
    const encoded = encodeJevFileTranscript(plan, actual, TRANSPORT);
    const fields = JSON.parse(encoded);
    expect(fields.slice(11, 15)).toEqual(["-0", "-0", "-0", "-0"]);
    const decoded = decodeJevFileTranscript(plan, encoded, TRANSPORT, actual);
    for (const value of [
      decoded.answers.f_a.probabilities.no_match,
      decoded.answers.f_a.probabilities.unknown,
      decoded.answers.f_a.confidence,
      decoded.evidence.usage.input_tokens,
      decoded.evidence.usage.output_tokens,
      decoded.evidence.usage.cost,
      decoded.evidence.latencyMs,
    ])
      expect(Object.is(value, -0)).toBe(true);
  });

  it.each([undefined, 0, -0, Number.MIN_VALUE])(
    "keeps reported cost %s distinct from absent cost",
    (cost) => {
      const plan = staged();
      const actual = receipt(plan);
      if (cost === undefined) delete actual.evidence.usage.cost;
      else actual.evidence.usage.cost = cost;
      const encoded = encodeJevFileTranscript(plan, actual, TRANSPORT);
      const fields = JSON.parse(encoded);
      expect(fields[13]).toBe(
        cost === undefined ? null : Object.is(cost, -0) ? "-0" : cost === 0 ? "0" : "5e-324",
      );
      const decoded = decodeJevFileTranscript(plan, encoded, TRANSPORT, actual);
      expect(Object.hasOwn(decoded.evidence.usage, "cost")).toBe(cost !== undefined);
      if (cost !== undefined) expect(Object.is(decoded.evidence.usage.cost, cost)).toBe(true);
      fields[13] = fields[13] === null ? "0" : null;
      rejectPacket(plan, fields, actual);
    },
  );

  it("fits maximum valid IDs, counters, finite scalars and all eight raw heads inside the reserve", () => {
    const plan = staged(source(2, 2));
    const actual = receipt(plan);
    actual.evidence.requestId = `A${".a".repeat(127)}Z`;
    expect(actual.evidence.requestId).toHaveLength(256);
    actual.evidence.responseBytes = 65_536;
    actual.evidence.usage = {
      input_tokens: Number.MAX_SAFE_INTEGER,
      output_tokens: Number.MAX_SAFE_INTEGER,
      cost: Number.MAX_VALUE,
    };
    actual.evidence.latencyMs = Number.MAX_VALUE;
    actual.answers.f_a = {
      choice: "match",
      probabilities: { match: 1, no_match: Number.MIN_VALUE, unknown: -0 },
      confidence: Number.MIN_VALUE,
    };
    const encoded = encodeJevFileTranscript(plan, actual, TRANSPORT);
    expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(plan.maxTranscriptBytes);
    expect(decodeJevFileTranscript(plan, encoded, TRANSPORT, actual)).toEqual(actual);
    const posted = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    expect(bytes(posted.request)).toBeLessThanOrEqual(plan.selection.downstreamMaxBytes[0]);
    expect(bytes(posted.request)).toBeLessThanOrEqual(32_768);
  });

  it.each([
    ["0x1", 1],
    ["0b1", 1],
    ["0o1", 1],
    [" 1", 1],
    ["1 ", 1],
    ["\t1", 1],
    ["1\n", 1],
    ["+1", 1],
    ["01", 1],
    ["1.0", 1],
    ["1e0", 1],
    ["1E0", 1],
    ["1e+0", 1],
    ["1e+00", 1],
    ["", 0],
    ["0.0", 0],
    ["0e0", 0],
    ["1e-999", 0],
    ["-0.0", -0],
    [" -0", -0],
  ])("rejects noncanonical %j even when it parses to the exact expected value", (text, value) => {
    const plan = staged();
    const actual = receipt(plan);
    actual.evidence.latencyMs = value as number;
    actual.answers.f_a.confidence = value as number;
    const fields = packet(plan, actual);
    fields[14] = text;
    rejectPacket(plan, fields, actual);
    const tupleFields = packet(plan, actual);
    tupleFields[15][0][5] = text;
    rejectPacket(plan, tupleFields, actual);
  });

  it.each(["NaN", "Infinity", "-Infinity", "1e+309", "1".repeat(33), 1, null])(
    "rejects invalid scalar representation %j",
    (text) => {
      const plan = staged();
      const fields = packet(plan);
      fields[14] = text;
      rejectPacket(plan, fields);
    },
  );

  it.each([
    ["state", 1, "a".repeat(64)],
    ["manifest", 2, "a".repeat(64)],
    ["request", 3, "a".repeat(64)],
    ["response", 4, "a".repeat(64)],
    ["transport", 5, "a".repeat(64)],
    ["model", 6, "other-model"],
    ["provider", 7, "OtherProvider"],
    ["request ID", 8, "gen-another-valid-ID"],
    ["request bytes", 9, "1"],
    ["response bytes", 10, "1"],
    ["input tokens", 11, "38"],
    ["output tokens", 12, "20"],
    ["reported cost", 13, "0"],
    ["latency", 14, "8"],
  ])(
    "rejects a replaced %s binding rather than accepting a new receipt",
    (_name, index, replacement) => {
      const plan = staged();
      const fields = packet(plan);
      fields[index as number] = replacement;
      rejectPacket(plan, fields);
    },
  );

  it.each([
    "missing",
    "extra",
    "wrong_version",
    "object",
    "leading_space",
    "trailing_space",
  ] as const)("rejects %s outer transcript form", (kind) => {
    const plan = staged();
    const fields = packet(plan);
    if (kind === "missing") fields.pop();
    if (kind === "extra") fields.push("extra");
    if (kind === "wrong_version") fields[0] = 2;
    const encoded =
      kind === "object"
        ? JSON.stringify({ fields })
        : `${kind === "leading_space" ? " " : ""}${JSON.stringify(fields)}${kind === "trailing_space" ? " " : ""}`;
    expect(() => decodeJevFileTranscript(plan, encoded, TRANSPORT, receipt(plan))).toThrow(
      JevClientError,
    );
  });

  it.each([
    "swapped",
    "missing",
    "extra",
    "duplicate",
    "unknown_id",
    "short_tuple",
    "long_tuple",
    "string_code",
    "fractional_code",
    "negative_code",
    "extra_code",
    "signed_zero_code",
  ] as const)("rejects %s tuple coverage or code", (kind) => {
    const plan = staged();
    const fields = packet(plan);
    const tuples = fields[15];
    if (kind === "swapped") tuples.reverse();
    if (kind === "missing") tuples.pop();
    if (kind === "extra") tuples.push([...tuples[0]]);
    if (kind === "duplicate") tuples[1][0] = "f_a";
    if (kind === "unknown_id") tuples[0][0] = "risk";
    if (kind === "short_tuple") tuples[0].pop();
    if (kind === "long_tuple") tuples[0].push("extra");
    if (kind === "string_code") tuples[0][1] = "2";
    if (kind === "fractional_code") tuples[0][1] = 1.5;
    if (kind === "negative_code") tuples[0][1] = -1;
    if (kind === "extra_code") tuples[0][1] = 3;
    const encoded =
      kind === "signed_zero_code"
        ? JSON.stringify(fields).replace('["f_a",2,', '["f_a",-0,')
        : JSON.stringify(fields);
    expect(() => decodeJevFileTranscript(plan, encoded, TRANSPORT, receipt(plan))).toThrow(
      JevClientError,
    );
  });

  it("rejects valid but replaced raw probability, confidence and selected-choice premises", () => {
    const plan = staged();
    const actual = receipt(plan);
    const fields = packet(plan, actual);
    fields[15][0][2] = "0.01";
    fields[15][0][3] = "0.019877";
    rejectPacket(plan, fields, actual);
    const confidence = packet(plan, actual);
    confidence[15][0][5] = "0.5";
    rejectPacket(plan, confidence, actual);
    actual.answers.f_a = {
      choice: "unknown",
      probabilities: { match: 0.34, no_match: 0.33, unknown: 0.34 },
      confidence: 1,
    };
    const tie = packet(plan, actual);
    tie[15][0][1] = 0;
    rejectPacket(plan, tie, actual);
  });

  it("rejects noncanonical raw probabilities that parse to the exact expected values", () => {
    const plan = staged();
    const actual = receipt(plan);
    actual.answers.f_a = {
      choice: "unknown",
      probabilities: { match: 0, no_match: 0, unknown: 1 },
      confidence: 1,
    };
    for (const [slot, spelling] of [
      [2, "1e-999"],
      [3, "0x0"],
      [4, "0x1"],
    ] as const) {
      const fields = packet(plan, actual);
      fields[15][0][slot] = spelling;
      rejectPacket(plan, fields, actual);
    }
  });

  it("keeps probability-map member order irrelevant while preserving every named raw value", () => {
    const plan = staged();
    const actual = receipt(plan);
    actual.answers.f_a.probabilities = { unknown: 0.970123, match: 0.019877, no_match: 0.01 };
    const encoded = encodeJevFileTranscript(plan, actual, TRANSPORT);
    expect(decodeJevFileTranscript(plan, encoded, TRANSPORT, actual)).toEqual(actual);
  });

  it("rejects reordered prior answer IDs even when all named values remain", () => {
    const plan = staged();
    const actual = receipt(plan);
    actual.answers = { f_b: actual.answers.f_b, f_a: actual.answers.f_a };
    expect(() => validateJevFileMatchResult(actual, plan, TRANSPORT)).toThrow(JevClientError);
    expect(() => encodeJevFileTranscript(plan, actual, TRANSPORT)).toThrow(JevClientError);
  });

  it.each(["extra_answer", "extra_usage", "missing_usage", "extra_evidence", "bad_id"] as const)(
    "rejects %s in the prior receipt before encoding",
    (kind) => {
      const plan = staged();
      const actual: any = receipt(plan);
      if (kind === "extra_answer") actual.answers.extra = actual.answers.f_a;
      if (kind === "extra_usage") actual.evidence.usage.extra = 0;
      if (kind === "missing_usage") delete actual.evidence.usage.output_tokens;
      if (kind === "extra_evidence") actual.evidence.extra = true;
      if (kind === "bad_id") actual.evidence.requestId = "a".repeat(257);
      expect(() => validateJevFileMatchResult(actual, plan, TRANSPORT)).toThrow(JevClientError);
      expect(() => encodeJevFileTranscript(plan, actual, TRANSPORT)).toThrow(JevClientError);
    },
  );
});

describe("complete source operands and strict inverse", () => {
  it.each([
    "same_row_exemption",
    "multiple_records",
    "disabled",
    "off_stronger",
    "stronger_later",
    "equal_source_order",
    "unknown_facts",
  ] as const)("retains %s without computing eligibility or a policy winner", (kind) => {
    const value = source(kind === "multiple_records" ? 2 : 1, 2);
    const rows = state(value).policy.files;
    if (kind === "same_row_exemption")
      rows[0].allowedPatterns = [{ pattern: state(value).facts.files[0].relativePath }];
    if (kind === "disabled") rows[0].enabled = false;
    if (kind === "off_stronger") {
      rows[0].behavior = "off";
      rows[1].protection = "readOnly";
      rows[1].restrictedAccess = ["write"];
    }
    if (kind === "stronger_later") {
      rows[0].protection = "readOnly";
      rows[0].restrictedAccess = ["write"];
    }
    if (kind === "equal_source_order") {
      rows[0].behavior = "confirm";
      rows[1].behavior = "block";
    }
    if (kind === "unknown_facts") {
      delete state(value).facts.files[0].absolutePath;
      state(value).facts.files[0].exists = "unknown";
      state(value).facts.files[0].kind = "unknown";
    }
    const before = JSON.stringify(value);
    const plan = staged(value);
    expect(plan.match.request.state).toEqual(value.state);
    const actualRecords = state(value).facts.files;
    let question = 0;
    for (const [recordOrdinal, record] of actualRecords.entries())
      for (const [rowOrdinal, row] of rows.entries())
        for (const listName of ["patterns", "allowedPatterns"]) {
          const id = `f_${String.fromCharCode(97 + question++)}` as JevFileMatchQuestionId;
          const instructions = plan.match.request.questions[id].instructions;
          expect(instructions).toMatchObject({ recordOrdinal, rowOrdinal, listName });
          expect(instructions.record).toEqual(record);
          expect(instructions.row).toEqual(row);
        }
    const actual = receipt(plan);
    const posted = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    expect(state(posted.request).facts).toEqual(state(value).facts);
    expect(state(posted.request).policy).toEqual(state(value).policy);
    expect(posted.request.questions.risk).toEqual(value.questions.risk);
    expect(decodeJevFileTranscript(plan, posted.transcript, TRANSPORT, actual)).toEqual(actual);
    expect(restoreJevFileSourceRequest(plan, posted.request, actual, TRANSPORT)).toBe(before);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.isFrozen(plan.original.request)).toBe(true);
    expect(Object.isFrozen(plan.match.request.state)).toBe(true);
  });

  it.each([
    "missing_transcript",
    "changed_transcript",
    "missing_premises",
    "changed_premises",
    "changed_rules",
    "changed_criteria",
    "extra_question_field",
    "changed_risk",
    "changed_fact",
    "changed_policy",
  ] as const)("rejects %s before inverse restoration can hide it", (kind) => {
    const plan = staged();
    const posted = buildJevFilePolicyRequest(plan, receipt(plan), TRANSPORT);
    const changed: any = structuredClone(posted.request);
    if (kind === "missing_transcript") delete changed.state.fileMatch;
    if (kind === "changed_transcript") changed.state.fileMatch = "[]";
    if (kind === "missing_premises")
      delete changed.questions.file_policy.instructions.matchingPremises;
    if (kind === "changed_premises")
      changed.questions.file_policy.instructions.matchingPremises = "Changed.";
    if (kind === "changed_rules") changed.questions.file_policy.instructions.rules[1] = "Changed.";
    if (kind === "changed_criteria") changed.questions.file_policy.criteria.allow = "Changed.";
    if (kind === "extra_question_field") changed.questions.file_policy.extra = true;
    if (kind === "changed_risk") changed.questions.risk.instructions = "Changed.";
    if (kind === "changed_fact") changed.state.facts.files[0].exists = true;
    if (kind === "changed_policy") changed.state.policy.files[0].behavior = "off";
    expect(() => restoreJevFileSourceRequest(plan, changed, receipt(plan), TRANSPORT)).toThrow(
      JevClientError,
    );
  });
});

describe("whole-chain admission before transport", () => {
  it("keeps the exact supported 31,914-byte original file-write source", () => {
    const path = "p".repeat(4_000);
    const value = buildJevRequest(
      buildJevMetadata("write", { path, content: "Local data." }),
      {
        files: [
          {
            path,
            relativePath: path,
            absolutePath: `/work/${path}`,
            basename: path,
            exists: false,
            kind: "unknown",
          },
        ],
      },
      readBundledConfig(),
    );
    expect(bytes(value)).toBe(31_914);
    const plan = legacy(value);
    expect(plan.selection.reason).toBe("complete-match-body-exceeds-cap");
    expect(state(plan.original.request).facts.files[0].path).toHaveLength(4_000);
    expect(state(plan.original.request).policy.files).toEqual(state(value).policy.files);
    expect(state(plan.original.request).policy.files).toHaveLength(4);
  });

  it("keeps all 32 original paths, all policy rows and every original action question", () => {
    const value = source(32, 2);
    expect(bytes(value)).toBeLessThan(32_768);
    const plan = legacy(value);
    expect(plan.selection.reason).toBe("head-count-exceeds-eight");
    expect(state(plan.original.request).facts.files).toHaveLength(32);
    expect(state(plan.original.request).policy.files).toHaveLength(2);
  });

  it("selects exact legacy when the matching body fits but the complete later action reserve does not", () => {
    const value = source();
    const rules = (value.questions.file_policy.instructions as { rules: string[] }).rules;
    rules[0] += "x".repeat(31_500 - bytes(value));
    expect(bytes(value)).toBe(31_500);
    const plan = legacy(value);
    expect(plan.selection.reason).toBe("complete-downstream-reserve-exceeds-cap");
    expect(plan.selection.matchRequestBytes).toBeLessThanOrEqual(32_768);
    expect(plan.selection.matchRequestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      (plan.original.request.questions.file_policy.instructions as { rules: string[] }).rules[0],
    ).toBe(rules[0]);
  });

  it("selects exact legacy on complete matching body overflow without dropping copied operands", () => {
    const value = source();
    const long = "x".repeat(6_000);
    state(value).facts.files[0].path = long;
    state(value).facts.files[0].relativePath = long;
    state(value).facts.files[0].absolutePath = `/work/${long}`;
    state(value).facts.files[0].basename = long;
    expect(bytes(value)).toBeLessThanOrEqual(32_768);
    const plan = legacy(value);
    expect(plan.selection.reason).toBe("complete-match-body-exceeds-cap");
  });

  it("preserves the exact 32,768-byte supported command source and rejects one more original byte", () => {
    const value = source(1, 1, true);
    state(value).observations.padding = "";
    state(value).observations.padding = "x".repeat(32_768 - bytes(value));
    expect(bytes(value)).toBe(32_768);
    const original = prepareJevCommandProcess(value);
    const plan = legacy(value, true);
    expect(plan.selection.reason).toBe("complete-downstream-reserve-exceeds-cap");
    expect(prepareJevCommandProcess(plan.original.request)).toEqual(original);
    state(value).observations.padding += "x";
    expect(() => prepareJevFileProcess(value, true)).toThrow(JevClientError);
  });

  it.each([43, 44] as const)(
    "preserves the complete exact 32,768-byte syntax %i form and every inverse",
    (version) => {
      function edge(flatCount: number, name: string) {
        const value = source(1, 1, true);
        const tokens = state(value).operation.metadata.commandTokens;
        tokens.original = Array.from({ length: version === 43 ? 256 : 1 }, () => ({
          head: 0,
          args: Array(version === 43 ? 15 : 2_200).fill(1),
        }));
        tokens.flat = Array(flatCount).fill(0);
        tokens.classes.push({ id: 2 });
        tokens.publicSyntax.push({ word: name, id: 2 });
        return value;
      }
      const seed = prepareJevCommandProcess(edge(0, "x"));
      const initialBytes =
        version === 43 ? Buffer.byteLength(restoreJevSyntax43(seed)) : seed.syntax.bytes;
      const remaining = 32_768 - initialBytes;
      expect(remaining).toBeGreaterThanOrEqual(0);
      const value = edge(Math.floor(remaining / 6), "x".repeat(2 + (remaining % 6)));
      const original = prepareJevCommandProcess(value);
      expect(original.syntax.bytes).toBe(32_768);
      expect(state(original.syntax.request as JevRequest).version).toBe(version);
      const plan = staged(value, true);
      const actual = receipt(plan);
      const posted = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
      const next = prepareJevCommandProcess(posted.request);
      expect(next.syntax.json).toBe(original.syntax.json);
      expect(next.syntax.bytes).toBe(32_768);
      for (const inverse of [
        restoreJevSyntax43,
        restoreJevSyntax42,
        restoreJevSyntax37,
        restoreJevOriginalSyntax,
      ])
        expect(inverse(next)).toBe(inverse(original));
      expect(restoreJevFileSourceRequest(plan, posted.request, actual, TRANSPORT)).toBe(
        JSON.stringify(value),
      );
    },
  );

  it("keeps original command syntax, grouped35 body and all exact syntax inverses unchanged", () => {
    const value = source(1, 1, true);
    const plan = staged(value, true);
    const posted = buildJevFilePolicyRequest(plan, receipt(plan), TRANSPORT);
    const original = prepareJevCommandProcess(value);
    const augmented = prepareJevCommandProcess(posted.request);
    expect(augmented.syntax.json).toBe(original.syntax.json);
    expect(augmented.manifest).toEqual(original.manifest);
    for (const inverse of [
      restoreJevSyntax43,
      restoreJevSyntax42,
      restoreJevSyntax37,
      restoreJevOriginalSyntax,
    ])
      expect(inverse(augmented)).toBe(inverse(original));
    function first(prepared: typeof original): JevNonCommandStageResult {
      const allowed: JevChoiceAnswer = {
        choice: "allow",
        probabilities: { allow: 1, confirm: 0, block: 0 },
        confidence: 0.8,
      };
      return {
        stage: "non_command",
        answers: Object.fromEntries(
          Object.keys(prepared.nonCommand.request.questions).map((id) => [id, allowed]),
        ) as JevNonCommandStageResult["answers"],
        evidence: {
          requestedQuestionIds: Object.keys(
            prepared.nonCommand.request.questions,
          ) as JevNonCommandStageResult["evidence"]["requestedQuestionIds"],
          requestHash: prepared.nonCommand.hash,
          responseHash: "d".repeat(64),
          transportHash: TRANSPORT,
          requestBytes: prepared.nonCommand.bytes,
          responseBytes: 512,
          model: JEV_RESOLVED_MODEL,
          provider: JEV_PROVIDER,
          requestId: "gen-synthetic-first",
          usage: { input_tokens: 4, output_tokens: 2 },
          latencyMs: 1,
        },
      };
    }
    const binary: JevSyntaxStageResult = {
      stage: "syntax",
      answers: {
        r_a: {
          choice: "match",
          probabilities: { match: 0.999123, no_match: 0.000877 },
          confidence: 0.8,
        },
      },
      evidence: {
        requestedQuestionIds: ["r_a"],
        requestHash: original.syntax.hash,
        responseHash: "e".repeat(64),
        transportHash: TRANSPORT,
        requestBytes: original.syntax.bytes,
        responseBytes: 256,
        model: JEV_RESOLVED_MODEL,
        provider: JEV_PROVIDER,
        requestId: "gen-synthetic-binary",
        usage: { input_tokens: 5, output_tokens: 3 },
        latencyMs: 1,
      },
    };
    expect(buildJevGroupedCommandRequest(augmented, first(augmented), binary).json).toBe(
      buildJevGroupedCommandRequest(original, first(original), binary).json,
    );
    expect(restoreJevFileSourceRequest(plan, posted.request, receipt(plan), TRANSPORT)).toBe(
      JSON.stringify(value),
    );
  });
});
