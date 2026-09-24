/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JevClientError, JEV_PROVIDER, JEV_RESOLVED_MODEL } from "../lib/jev-client.ts";
import {
  buildJevFilePolicyRequest,
  decodeJevFileTranscript,
  encodeJevFileTranscript,
  prepareJevFileProcess,
  restoreJevFileSourceRequest,
} from "../lib/jev-file-process.ts";
import type { JevFileProcessPlan } from "../lib/jev-file-process.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import { buildJevRequest } from "../lib/jev-risk.ts";
import type {
  GuardrailConfig,
  JevFileMatchChoice,
  JevFileMatchChoiceAnswer,
  JevFileMatchQuestionId,
  JevFileMatchStageResult,
  JevRequest,
} from "../lib/types.ts";

const forbidden = vi.hoisted(() => ({
  openSync: vi.fn(() => {
    throw new Error("Key-file reads are prohibited in this premises test.");
  }),
  fileFactory: vi.fn(() => {
    throw new Error("Transport creation is prohibited in this premises test.");
  }),
  decisionFactory: vi.fn(() => {
    throw new Error("Transport creation is prohibited in this premises test.");
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

const TRANSPORT = "d".repeat(64);
const CAP = 32768;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const bytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const state = (request: JevRequest): Record<string, any> => request.state as Record<string, any>;
let fetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  Object.values(forbidden).forEach((mock) => mock.mockClear());
  fetch = vi.fn(() => {
    throw new Error("Network dispatch is prohibited in this premises test.");
  });
  vi.stubGlobal("fetch", fetch);
});
afterEach(() => {
  Object.values(forbidden).forEach((mock) => expect(mock).not.toHaveBeenCalled());
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

function source(recordCount = 2, rowCount = 2): JevRequest {
  const config: GuardrailConfig = {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "SYNTHETIC_PREMISES_HEADLESS",
    confirmTimeoutMs: 300,
    policies: {
      rules: Array.from({ length: rowCount }, (_, index) => ({
        id: `synthetic-premises-row-${index}`,
        enabled: true,
        patterns: [{ pattern: "workspace/**" }],
        allowedPatterns: [{ pattern: `workspace/exception-${index}.data` }],
        protection: "noAccess",
        onlyIfExists: false,
        behavior: "block",
      })),
    },
    orgAwareGate: { rules: [] },
    commandGate: { allowedPatterns: [], autoDenyPatterns: [], patterns: [] },
  };
  const files = Array.from({ length: recordCount }, (_, index) => ({
    path: `workspace/synthetic-${index}.data`,
    absolutePath: `/work/workspace/synthetic-${index}.data`,
    relativePath: `workspace/synthetic-${index}.data`,
    basename: `synthetic-${index}.data`,
    homeRelativePath: `~/workspace/synthetic-${index}.data`,
    exists: index === 0 ? ("unknown" as const) : false,
    kind: index === 0 ? ("unknown" as const) : ("file" as const),
  }));
  return buildJevRequest(
    buildJevMetadata("write", {
      path: "workspace/synthetic-0.data",
      content: "Local synthetic data.",
    }),
    { files },
    config,
    {},
  );
}
function staged(request = source()): JevFileProcessPlan {
  const plan = prepareJevFileProcess(request, false);
  expect(plan.format).toBe("file_match_then_policy");
  expect(plan.match).toBeDefined();
  return plan;
}
function answer(choice: JevFileMatchChoice): JevFileMatchChoiceAnswer {
  return {
    choice,
    probabilities: {
      match: choice === "match" ? 1 : -0,
      no_match: choice === "no_match" ? 1 : 0,
      unknown: choice === "unknown" ? 1 : -0,
    },
    confidence: -0,
  };
}
function receipt(
  plan: JevFileProcessPlan,
  choices: JevFileMatchChoice[] = [
    "unknown",
    "match",
    "no_match",
    "unknown",
    "match",
    "no_match",
    "unknown",
    "match",
  ],
): JevFileMatchStageResult {
  const answers = Object.fromEntries(
    plan.selection.questionIds.map((id, index) => [id, answer(choices[index % choices.length])]),
  );
  const usage = { input_tokens: 41, output_tokens: 23, cost: -0 };
  const raw = JSON.stringify({
    id: "gen-synthetic-premises",
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    answers,
    usage,
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
      requestId: "gen-synthetic-premises",
      usage,
      latencyMs: -0,
    },
  };
}
function exactLegacy(request: JevRequest, reason: string) {
  const json = JSON.stringify(request);
  const plan = prepareJevFileProcess(request, false);
  expect(plan.format).toBe("legacy");
  expect(plan.selection.reason).toBe(reason);
  expect(plan.original).toEqual({
    request,
    json,
    bytes: Buffer.byteLength(json),
    hash: hash(json),
  });
  expect(plan.match).toBeUndefined();
  expect(plan.maxTranscriptBytes).toBeUndefined();
  expect(plan.original.request.questions).toEqual(request.questions);
  expect(plan.original.request.state).toEqual(request.state);
  expect(state(plan.original.request)).not.toHaveProperty("fileMatch");
  expect(state(plan.original.request)).not.toHaveProperty("fileMatchPremises");
  return plan;
}

describe("flat typed file matching premises", () => {
  it("carries eight literal choices at every original record, row and list coordinate", () => {
    const request = source();
    const original = state(request);
    original.policy.files[0].enabled = false;
    original.policy.files[0].onlyIfExists = true;
    original.policy.files[1].behavior = "off";
    original.policy.files[1].protection = "readOnly";
    original.policy.files[1].allowedPatterns = [];
    const plan = staged(request);
    const actual = receipt(plan);
    const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    expect(state(result.request).fileMatchPremises).toEqual([
      { fileRecordIndex: 0, policyRowIndex: 0, patternList: "patterns", choice: "unknown" },
      { fileRecordIndex: 0, policyRowIndex: 0, patternList: "allowedPatterns", choice: "match" },
      { fileRecordIndex: 0, policyRowIndex: 1, patternList: "patterns", choice: "no_match" },
      { fileRecordIndex: 0, policyRowIndex: 1, patternList: "allowedPatterns", choice: "unknown" },
      { fileRecordIndex: 1, policyRowIndex: 0, patternList: "patterns", choice: "match" },
      { fileRecordIndex: 1, policyRowIndex: 0, patternList: "allowedPatterns", choice: "no_match" },
      { fileRecordIndex: 1, policyRowIndex: 1, patternList: "patterns", choice: "unknown" },
      { fileRecordIndex: 1, policyRowIndex: 1, patternList: "allowedPatterns", choice: "match" },
    ]);
    for (const premise of state(result.request).fileMatchPremises) {
      expect(Object.keys(premise)).toEqual([
        "fileRecordIndex",
        "policyRowIndex",
        "patternList",
        "choice",
      ]);
    }
    expect(state(result.request).facts).toEqual(original.facts);
    expect(state(result.request).policy).toEqual(original.policy);
    const operands = Object.values(plan.match.request.questions).map(
      (question) => question.instructions as Record<string, any>,
    );
    expect(
      operands.map(({ recordOrdinal, rowOrdinal, listName }) => [
        recordOrdinal,
        rowOrdinal,
        listName,
      ]),
    ).toEqual([
      [0, 0, "patterns"],
      [0, 0, "allowedPatterns"],
      [0, 1, "patterns"],
      [0, 1, "allowedPatterns"],
      [1, 0, "patterns"],
      [1, 0, "allowedPatterns"],
      [1, 1, "patterns"],
      [1, 1, "allowedPatterns"],
    ]);
    operands.forEach((operand) => {
      expect(operand.record).toEqual(original.facts.files[operand.recordOrdinal]);
      expect(operand.row).toEqual(original.policy.files[operand.rowOrdinal]);
    });
    expect(restoreJevFileSourceRequest(plan, result.request, actual, TRANSPORT)).toBe(
      JSON.stringify(request),
    );
    expect(Object.keys(actual.answers)).toEqual([
      "f_a",
      "f_b",
      "f_c",
      "f_d",
      "f_e",
      "f_f",
      "f_g",
      "f_h",
    ]);
  });

  it.each(["match", "no_match", "unknown"] as const)(
    "preserves the actual %s label for identical source paths and rows",
    (choice) => {
      const plan = staged(source(1, 1));
      const actual = receipt(plan, [choice]);
      const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
      expect(state(result.request).fileMatchPremises).toEqual([
        { fileRecordIndex: 0, policyRowIndex: 0, patternList: "patterns", choice },
        { fileRecordIndex: 0, policyRowIndex: 0, patternList: "allowedPatterns", choice },
      ]);
      expect(decodeJevFileTranscript(plan, result.transcript, TRANSPORT, actual)).toEqual(actual);
      expect(restoreJevFileSourceRequest(plan, result.request, actual, TRANSPORT)).toBe(
        plan.original.json,
      );
    },
  );

  it("keeps the full prior receipt and signed zero alongside the flat choices", () => {
    const plan = staged();
    const actual = receipt(plan);
    const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    expect(result.transcript).toBe(encodeJevFileTranscript(plan, actual, TRANSPORT));
    expect(state(result.request).fileMatch).toBe(result.transcript);
    const fields = JSON.parse(result.transcript);
    expect(fields).toHaveLength(16);
    expect(fields[13]).toBe("-0");
    expect(fields[14]).toBe("-0");
    expect(fields[15][0]).toEqual(["f_a", 2, "-0", "0", "1", "-0"]);
    const decoded = decodeJevFileTranscript(plan, result.transcript, TRANSPORT, actual);
    expect(Object.is(decoded.answers.f_a.probabilities.match, -0)).toBe(true);
    expect(Object.is(decoded.answers.f_a.confidence, -0)).toBe(true);
    expect(Object.is(decoded.evidence.usage.cost, -0)).toBe(true);
    expect(Object.is(decoded.evidence.latencyMs, -0)).toBe(true);
    expect(state(plan.original.request)).not.toHaveProperty("fileMatchPremises");
  });

  const mutations: [string, (value: Record<string, any>) => void][] = [
    [
      "missing array",
      (value) => {
        delete value.fileMatchPremises;
      },
    ],
    [
      "empty array",
      (value) => {
        value.fileMatchPremises = [];
      },
    ],
    [
      "missing head",
      (value) => {
        value.fileMatchPremises.pop();
      },
    ],
    [
      "extra head",
      (value) => {
        value.fileMatchPremises.push(structuredClone(value.fileMatchPremises[0]));
      },
    ],
    [
      "reordered heads",
      (value) => {
        value.fileMatchPremises.reverse();
      },
    ],
    [
      "swapped heads",
      (value) => {
        [value.fileMatchPremises[0], value.fileMatchPremises[1]] = [
          value.fileMatchPremises[1],
          value.fileMatchPremises[0],
        ];
      },
    ],
    [
      "swapped record",
      (value) => {
        value.fileMatchPremises[0].fileRecordIndex = 1;
      },
    ],
    [
      "swapped row",
      (value) => {
        value.fileMatchPremises[0].policyRowIndex = 1;
      },
    ],
    [
      "swapped list",
      (value) => {
        value.fileMatchPremises[0].patternList = "allowedPatterns";
      },
    ],
    [
      "changed unknown",
      (value) => {
        value.fileMatchPremises[0].choice = "no_match";
      },
    ],
    [
      "invalid choice",
      (value) => {
        value.fileMatchPremises[0].choice = "allow";
      },
    ],
    [
      "missing coordinate",
      (value) => {
        delete value.fileMatchPremises[0].fileRecordIndex;
      },
    ],
    [
      "extra property",
      (value) => {
        value.fileMatchPremises[0].selected = true;
      },
    ],
    [
      "negative coordinate",
      (value) => {
        value.fileMatchPremises[0].policyRowIndex = -1;
      },
    ],
    [
      "fractional coordinate",
      (value) => {
        value.fileMatchPremises[0].fileRecordIndex = 0.5;
      },
    ],
    [
      "object replaces array",
      (value) => {
        value.fileMatchPremises = { first: value.fileMatchPremises[0] };
      },
    ],
    [
      "changed full transcript",
      (value) => {
        value.fileMatch = "[]";
      },
    ],
  ];
  it.each(mutations)("rejects inverse restoration with %s", (_, mutate) => {
    const plan = staged();
    const actual = receipt(plan);
    const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    const altered = structuredClone(result.request);
    mutate(state(altered));
    expect(() => restoreJevFileSourceRequest(plan, altered, actual, TRANSPORT)).toThrow(
      JevClientError,
    );
  });

  it("binds both copies of the choices to the same actual receipt", () => {
    const plan = staged();
    const original = receipt(plan);
    const changed = receipt(plan, ["no_match"]);
    const result = buildJevFilePolicyRequest(plan, changed, TRANSPORT);
    expect(
      state(result.request).fileMatchPremises.every(
        (premise: Record<string, any>) => premise.choice === "no_match",
      ),
    ).toBe(true);
    expect(() => restoreJevFileSourceRequest(plan, result.request, original, TRANSPORT)).toThrow(
      JevClientError,
    );
    expect(restoreJevFileSourceRequest(plan, result.request, changed, TRANSPORT)).toBe(
      plan.original.json,
    );
  });

  it("retains all other source questions and rejects loss from either original operand set", () => {
    const request = source();
    const plan = staged(request);
    const actual = receipt(plan);
    const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    for (const id of Object.keys(request.questions) as (keyof JevRequest["questions"])[]) {
      if (id === "file_policy") continue;
      expect(result.request.questions[id]).toEqual(request.questions[id]);
    }
    for (const operand of ["facts", "policy"] as const) {
      const altered = structuredClone(result.request);
      state(altered)[operand].files.pop();
      expect(() => restoreJevFileSourceRequest(plan, altered, actual, TRANSPORT)).toThrow(
        JevClientError,
      );
    }
    expect(JSON.stringify(request)).toBe(plan.original.json);
  });
});

describe("complete new envelope admission before transport", () => {
  it("admits real depth 32 on each wire request and rejects an invalid original depth 33", () => {
    const request = source(1, 1);
    let nested: unknown = 0;
    for (let index = 0; index < 30; index++) nested = [nested];
    state(request).syntheticAnnotations = nested;
    const depth = (value: unknown): number => {
      if (value === null || typeof value !== "object") return 0;
      return Math.max(0, ...Object.values(value).map((child) => 1 + depth(child)));
    };
    expect(depth(request)).toBe(32);
    const plan = staged(request);
    const actual = receipt(plan);
    const result = buildJevFilePolicyRequest(plan, actual, TRANSPORT);
    expect(depth(plan.match.request)).toBe(32);
    expect(depth(result.request)).toBe(32);
    expect(restoreJevFileSourceRequest(plan, result.request, actual, TRANSPORT)).toBe(
      plan.original.json,
    );
    const invalid = structuredClone(request);
    state(invalid).syntheticAnnotations = [state(invalid).syntheticAnnotations];
    expect(depth(invalid)).toBe(33);
    expect(bytes(invalid)).toBeLessThan(CAP);
    expect(() => prepareJevFileProcess(invalid, false)).toThrow(JevClientError);
  });

  it("selects exact legacy when the added flat array crosses the later body reserve", () => {
    const request = source();
    const small = staged(request);
    const result = buildJevFilePolicyRequest(small, receipt(small, ["no_match"]), TRANSPORT);
    const withoutFlat = structuredClone(result.request);
    delete state(withoutFlat).fileMatchPremises;
    const flatBytes = bytes(result.request) - bytes(withoutFlat);
    expect(flatBytes).toBeGreaterThan(0);
    const padding = CAP + 1 - small.selection.downstreamMaxBytes[0];
    expect(padding).toBeGreaterThan(0);
    const instructions = request.questions.file_policy.instructions as Record<string, any>;
    instructions.rules[0] += "x".repeat(padding);
    expect(bytes(request)).toBeLessThanOrEqual(CAP);
    expect(small.match.bytes).toBeLessThanOrEqual(CAP);
    expect(small.selection.downstreamMaxBytes[0] + padding).toBe(CAP + 1);
    expect(small.selection.downstreamMaxBytes[0] + padding - flatBytes).toBeLessThanOrEqual(CAP);
    const plan = exactLegacy(request, "complete-downstream-reserve-exceeds-cap");
    expect(state(plan.original.request).facts.files).toHaveLength(2);
    expect(state(plan.original.request).policy.files).toHaveLength(2);
  });

  it("selects exact legacy for complete copied match operands that exceed the body cap", () => {
    const request = source(1, 1);
    const record = state(request).facts.files[0];
    for (const key of ["path", "absolutePath", "relativePath", "basename"]) {
      record[key] = "p".repeat(5000);
    }
    expect(bytes(request)).toBeLessThanOrEqual(CAP);
    const plan = exactLegacy(request, "complete-match-body-exceeds-cap");
    expect(state(plan.original.request).facts.files[0]).toEqual(record);
    expect(plan.original.request.questions).toEqual(request.questions);
  });

  it("retains the complete original request when all heads exceed the eight-head cap", () => {
    const request = source(3, 2);
    const plan = exactLegacy(request, "head-count-exceeds-eight");
    expect(state(plan.original.request).facts.files).toHaveLength(3);
    expect(state(plan.original.request).policy.files).toHaveLength(2);
    expect(plan.original.json).toBe(JSON.stringify(request));
  });
});
