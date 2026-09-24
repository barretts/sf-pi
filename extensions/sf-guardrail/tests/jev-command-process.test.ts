/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JevClientError,
  JevStageClientError,
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
} from "../lib/jev-client.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import { buildJevRequest } from "../lib/jev-risk.ts";
import {
  buildJevGroupedCommandRequest,
  jevCommandProcessGate,
  jevCommandRowId,
  JEV_COMMAND_ACTION_INSTRUCTION,
  JEV_COMMAND_PROCESS_PROTOCOL,
  JEV_COMMAND_SYNTAX_TEMPLATES,
  prepareJevCommandProcess,
  restoreJevNonCommandRequest,
  restoreJevOriginalSyntax,
  runJevCommandProcess,
} from "../lib/jev-command-process.ts";
import type {
  CommandGateConfig,
  GuardrailConfig,
  JevChoiceAnswer,
  JevCommandPolicyRequest,
  JevCommandPolicyStageResult,
  JevNonCommandRequest,
  JevNonCommandStageResult,
  JevProcessTransport,
  JevRequest,
  JevSyntaxChoiceAnswer,
  JevSyntaxRequest,
  JevSyntaxStageResult,
} from "../lib/types.ts";

const hash = (value: unknown) =>
  createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
const clone = structuredClone;
function request(
  patterns: string[] = ["git status"],
  overrides: Partial<CommandGateConfig> = {},
): JevRequest {
  const config: GuardrailConfig = {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "TEST_HEADLESS",
    confirmTimeoutMs: 300,
    policies: { rules: [] },
    orgAwareGate: { rules: [] },
    commandGate: {
      allowedPatterns: [],
      autoDenyPatterns: [],
      patterns: patterns.map((pattern, index) => ({
        id: `rule-${index}`,
        pattern,
        behavior: "confirm",
      })),
      ...overrides,
    },
  };
  const command = "git status";
  return buildJevRequest(buildJevMetadata("bash", { command }), {}, config, { command });
}
const state = (request: JevRequest): Record<string, any> => request.state as Record<string, any>;
const allow = (probability = 1): JevChoiceAnswer => ({
  choice: "allow",
  probabilities: { allow: probability, confirm: 1 - probability, block: 0 },
  confidence: 0.812345,
});
const block = (): JevChoiceAnswer => ({
  choice: "block",
  probabilities: { allow: 0, confirm: 0.03, block: 0.97 },
  confidence: 0.954321,
});
const syntax = (
  probability = 1,
  choice: "match" | "no_match" = "no_match",
): JevSyntaxChoiceAnswer => ({
  choice,
  probabilities: {
    match: choice === "match" ? probability : 1 - probability,
    no_match: choice === "no_match" ? probability : 1 - probability,
  },
  confidence: 0.712345,
});
function result(
  stage: "non_command",
  request: JevNonCommandRequest,
  answers?: Record<string, JevChoiceAnswer>,
): JevNonCommandStageResult;
function result(
  stage: "syntax",
  request: JevSyntaxRequest,
  answers?: Record<string, JevSyntaxChoiceAnswer>,
): JevSyntaxStageResult;
function result(
  stage: "command_policy",
  request: JevCommandPolicyRequest,
  answers?: Record<string, JevChoiceAnswer>,
): JevCommandPolicyStageResult;
function result(
  stage: string,
  request: { questions: unknown },
  answers?: Record<string, unknown>,
): JevNonCommandStageResult | JevSyntaxStageResult | JevCommandPolicyStageResult {
  const selected =
    answers ??
    Object.fromEntries(
      Object.keys(request.questions).map((id) => [id, stage === "syntax" ? syntax() : allow()]),
    );
  const raw = JSON.stringify(selected);
  const json = JSON.stringify(request);
  return {
    stage,
    answers: selected,
    evidence: {
      requestedQuestionIds: Object.keys(request.questions),
      requestHash: hash(json),
      responseHash: hash(raw),
      transportHash: hash("test-transport-binding"),
      requestBytes: Buffer.byteLength(json),
      responseBytes: Buffer.byteLength(raw),
      model: JEV_RESOLVED_MODEL,
      provider: JEV_PROVIDER,
      requestId: `test-${stage}`,
      usage: { input_tokens: 34, output_tokens: 13, cost: 0.000123456 },
      latencyMs: 3.25,
    },
  } as JevNonCommandStageResult | JevSyntaxStageResult | JevCommandPolicyStageResult;
}
function transport() {
  return {
    requestNonCommand: vi.fn(async (request: JevNonCommandRequest) =>
      result("non_command", request),
    ),
    requestSyntax: vi.fn(async (request: JevSyntaxRequest) => result("syntax", request)),
    requestCommandPolicy: vi.fn(async (request: JevCommandPolicyRequest) =>
      result("command_policy", request),
    ),
    close: vi.fn(),
  } satisfies JevProcessTransport;
}
function run(
  original = request(),
  selected = transport(),
  deadline = performance.now() + 1400,
  signal?: AbortSignal,
) {
  const createTransport = vi.fn(() => selected);
  return {
    createTransport,
    selected,
    promise: runJevCommandProcess(original, { deadline, signal, createTransport }),
  };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("command stage layout", () => {
  it("keeps exact original facts, operation, other policy, and first question bytes", () => {
    const original = request();
    state(original).facts = { files: [{ path: "src/example.ts", exists: true, kind: "file" }] };
    state(original).policy.files = [
      { id: "source-file", patterns: [{ pattern: "src/**" }], behavior: "confirm" },
    ];
    original.questions.file_policy = clone(original.questions.risk);
    original.questions.disclosure = clone(original.questions.risk);
    const before = JSON.stringify(original);
    const prepared = prepareJevCommandProcess(original);
    expect(prepared.nonCommand.request.state).toEqual(original.state);
    expect(JSON.stringify(prepared.nonCommand.request.state)).toBe(JSON.stringify(original.state));
    expect(Object.keys(prepared.nonCommand.request.questions)).toEqual([
      "risk",
      "file_policy",
      "disclosure",
    ]);
    for (const id of Object.keys(prepared.nonCommand.request.questions))
      expect(JSON.stringify(prepared.nonCommand.request.questions[id])).toBe(
        JSON.stringify(original.questions[id]),
      );
    expect(restoreJevNonCommandRequest(prepared)).toBe(before);
    expect(JSON.stringify(original)).toBe(before);
    expect(Object.isFrozen(prepared.manifest)).toBe(true);
  });
  it.each([1, 64])("keeps all %i active rows without batching", (count) => {
    const prepared = prepareJevCommandProcess(request(Array(count).fill("git status")));
    expect(prepared.manifest).toHaveLength(count);
    expect(Object.keys(prepared.syntax.request.questions)).toHaveLength(count);
    expect(prepared.manifest.map((row) => row.questionId)).toEqual(
      Array.from({ length: count }, (_, index) => jevCommandRowId(index)),
    );
    expect(prepared.manifest.at(-1).ordinal).toBe(count);
    expect(prepared.syntax.bytes).toBeLessThanOrEqual(32768);
  });
  it("rejects 65 active rows before transport construction", async () => {
    const test = run(request(Array(65).fill("git status")));
    const completed = await test.promise;
    expect(completed.gate).toBe("block");
    expect(completed.failure).toEqual({ stage: "prepare", code: "invalid_request" });
    expect(test.createTransport).not.toHaveBeenCalled();
  });
  it("uses separate ordered alpha namespaces", () => {
    expect(jevCommandRowId(0)).toBe("r_a");
    expect(jevCommandRowId(25)).toBe("r_z");
    expect(jevCommandRowId(26)).toBe("r_aa");
    expect(jevCommandRowId(63)).toBe("r_bl");
    expect(jevCommandRowId(63, "u")).toBe("u_bl");
    for (const bad of [-0, -1, 64, 1.1, Infinity])
      expect(() => jevCommandRowId(bad)).toThrow(JevClientError);
  });
  it("retains all nine selector kinds and exact prefix namespaces", () => {
    const patterns = [
      "git status",
      "",
      "dd of=",
      "mkfs.*",
      "remote-script-to-shell",
      "base64-decode-to-shell",
      "pi-auth-credential-output",
      "find -delete",
      "find -exec rm",
    ];
    const original = request(patterns);
    const prepared = prepareJevCommandProcess(original);
    const sourceRows = state(original).policy.commands.patterns;
    prepared.manifest.forEach((row, index) => {
      const { behavior, ...sourceSelector } = sourceRows[index];
      expect(row.selector).toEqual(sourceSelector);
      expect(row.behavior).toBe(behavior);
      expect(row.originalRowHash).toBe(hash(sourceRows[index]));
    });
    expect(prepared.manifest.map((row) => row.selector.kind)).toEqual(
      Object.keys(JEV_COMMAND_PROCESS_PROTOCOL.selectorShapes),
    );
    const posted = state(prepared.syntax.request as JevRequest);
    expect(posted.commandTokens).toEqual(state(original).operation.metadata.commandTokens);
    expect(posted.matchGrammar).toEqual(state(original).policy.commands.matchGrammar);
    expect(
      prepared.manifest.find((row) => row.selector.kind === "dd_output").selector,
    ).toHaveProperty("equalsPrefix");
    expect(prepared.manifest.find((row) => row.selector.kind === "mkfs").selector).toHaveProperty(
      "dotPrefix",
    );
    expect(posted.commandTokens.publicSyntax).toContainEqual(
      expect.objectContaining({ word: "git" }),
    );
  });
  it("restores exact long syntax bytes with selectors inline", () => {
    const original = request(["git status", "dd of=", "find -exec rm"]);
    const prepared = prepareJevCommandProcess(original);
    const questions = Object.fromEntries(
      prepared.manifest.map((row) => [
        row.questionId,
        {
          type: "choice",
          instructions: {
            question: JEV_COMMAND_SYNTAX_TEMPLATES.originalQuestion,
            selector: row.selector,
            rule: JEV_COMMAND_SYNTAX_TEMPLATES.rule,
          },
          criteria: JEV_COMMAND_SYNTAX_TEMPLATES.originalCriteria,
        },
      ]),
    );
    const expected = {
      model: JEV_MODEL,
      provider: original.provider,
      state: {
        version: 31,
        commandTokens: state(original).operation.metadata.commandTokens,
        matchGrammar: state(original).policy.commands.matchGrammar,
      },
      questions,
    };
    expect(restoreJevOriginalSyntax(prepared)).toBe(JSON.stringify(expected));
    for (const row of prepared.manifest)
      expect(
        (prepared.syntax.request.questions[row.questionId].instructions as any).selector,
      ).toEqual(row.selector);
    expect(state(prepared.syntax.request as JevRequest).syntaxInstruction.rule).toBe(
      JEV_COMMAND_SYNTAX_TEMPLATES.rule,
    );
    expect(state(prepared.syntax.request as JevRequest).syntaxInstruction.criteria).toEqual(
      JEV_COMMAND_SYNTAX_TEMPLATES.originalCriteria,
    );
  });
  it("keeps off rows only in the unchanged first state", () => {
    const original = request(["git status"], {
      allowedPatterns: [{ id: "off-allow", pattern: "private-off-allow", behavior: "off" }],
      autoDenyPatterns: [{ id: "off-deny", pattern: "private-off-deny", enabled: false }],
      patterns: [
        { id: "active", pattern: "git status", behavior: "block" },
        { id: "off", pattern: "git diff", behavior: "off" },
      ],
    });
    const prepared = prepareJevCommandProcess(original);
    expect(prepared.manifest).toHaveLength(1);
    expect(
      state(prepared.nonCommand.request as JevRequest).policy.commands.effectWaivers,
    ).toHaveLength(1);
    expect(state(prepared.syntax.request as JevRequest)).not.toHaveProperty("effectWaivers");
    expect(prepared.original.json).not.toContain("private-off-allow");
    expect(prepared.original.json).not.toContain("private-off-deny");
  });
  it("retains source groups, order, declared behavior, and every binary number", () => {
    const original = request([], {
      allowedPatterns: [{ id: "allow", pattern: "git status" }],
      autoDenyPatterns: [{ id: "deny", pattern: "git diff" }],
      patterns: [
        { id: "ask", pattern: "git log", behavior: "confirm" },
        { id: "block", pattern: "git show", behavior: "block" },
      ],
    });
    const prepared = prepareJevCommandProcess(original);
    const first = result("non_command", prepared.nonCommand.request);
    const binary = result(
      "syntax",
      prepared.syntax.request,
      Object.fromEntries(
        prepared.manifest.map((row, index) => [
          row.questionId,
          syntax(index === 3 ? 0.55 : 0.990123, index === 3 ? "match" : "no_match"),
        ]),
      ),
    );
    const posted = buildJevGroupedCommandRequest(prepared, first, binary);
    const current = state(posted.request as JevRequest);
    expect(current.allowedPatterns).toEqual([
      { rowId: "u_a", behavior: "allow", answer: binary.answers.r_a },
    ]);
    expect(current.autoDenyPatterns).toEqual([
      { rowId: "u_b", behavior: "block", answer: binary.answers.r_b },
    ]);
    expect(current.patterns).toEqual([
      { rowId: "u_c", behavior: "confirm", answer: binary.answers.r_c },
      { rowId: "u_d", behavior: "block", answer: binary.answers.r_d },
    ]);
    expect(Object.keys(posted.request.questions)).toEqual(["command_policy"]);
    expect(posted.request.questions.command_policy.instructions).toBe(
      JEV_COMMAND_ACTION_INSTRUCTION,
    );
    for (const omitted of [
      "commandTokens",
      "selector",
      "publicNames",
      "matchGrammar",
      "sourceId",
      "risk",
    ])
      expect(current).not.toHaveProperty(omitted);
    expect(posted.descriptor.rowBindings.map((row) => row.originalRowHash)).toEqual(
      prepared.manifest.map((row) => row.originalRowHash),
    );
    expect(current.patterns[1].answer.probabilities.match).toBe(0.55);
  });
  it.each([
    [
      "unknown token field",
      (value: JevRequest) => {
        state(value).operation.metadata.commandTokens.hidden = [];
      },
    ],
    [
      "duplicate class ID",
      (value: JevRequest) => {
        const tokens = state(value).operation.metadata.commandTokens;
        tokens.classes.push(clone(tokens.classes[0]));
      },
    ],
    [
      "dangling whole ID",
      (value: JevRequest) => {
        state(value).operation.metadata.commandTokens.flat.push(2047);
      },
    ],
    [
      "unknown grammar",
      (value: JevRequest) => {
        state(value).policy.commands.matchGrammar.extra = "No match.";
      },
    ],
    [
      "unknown selector",
      (value: JevRequest) => {
        state(value).policy.commands.patterns[0].kind = "future_kind";
      },
    ],
    [
      "unknown selector field",
      (value: JevRequest) => {
        state(value).policy.commands.patterns[0].hidden = 1;
      },
    ],
    [
      "wrong public name",
      (value: JevRequest) => {
        state(value).policy.commands.patterns[0].publicNames.tokens[0] = "new-vocabulary";
      },
    ],
    [
      "off active row",
      (value: JevRequest) => {
        state(value).policy.commands.patterns[0].behavior = "off";
      },
    ],
    [
      "unknown source list",
      (value: JevRequest) => {
        state(value).policy.commands.hidden = [];
      },
    ],
  ] as const)("fails %s as a gap, never no_match", (_label, mutate) => {
    const original = request();
    mutate(original);
    expect(() => prepareJevCommandProcess(original)).toThrow(JevClientError);
  });
  it("rejects source getters without invoking them", () => {
    const original = request();
    const getter = vi.fn(() => true);
    Object.defineProperty(state(original), "hidden", { enumerable: true, get: getter });
    expect(() => prepareJevCommandProcess(original)).toThrow(JevClientError);
    expect(getter).not.toHaveBeenCalled();
  });
  it("rejects a body overflow before transport construction", async () => {
    const original = request();
    state(original).facts = { omittedFact: "x".repeat(32768) };
    const test = run(original);
    expect((await test.promise).gate).toBe("block");
    expect(test.createTransport).not.toHaveBeenCalled();
  });
  it("rejects short syntax overflow even when the original body fits", async () => {
    const original = request(Array(64).fill("git status"));
    const tokens = state(original).operation.metadata.commandTokens;
    tokens.original[0].args = Array(2650).fill(0);
    tokens.expanded[0].args = Array(2650).fill(0);
    tokens.flat = Array(2651).fill(0);
    expect(Buffer.byteLength(JSON.stringify(original))).toBeLessThan(32768);
    const test = run(original);
    const completed = await test.promise;
    expect(completed.failure).toEqual({ stage: "prepare", code: "invalid_request" });
    expect(test.createTransport).not.toHaveBeenCalled();
  });
  it("rejects changed manifest origin, order, and source bytes", () => {
    const prepared = prepareJevCommandProcess(request(["git status", "git diff"]));
    for (const mutate of [
      (value) => {
        value.manifest[0].questionId = "r_b";
      },
      (value) => {
        value.manifest[0].rowId = "r_b";
      },
      (value) => {
        value.manifest.reverse();
      },
      (value) => {
        value.manifest[0].originalRowHash = hash("wrong-row");
      },
    ]) {
      const changed = clone(prepared);
      mutate(changed);
      expect(() => restoreJevOriginalSyntax(changed)).toThrow(JevClientError);
    }
  });
});

describe("empty active source groups", () => {
  it.each(["empty", "all off"])(
    "uses a declared two-call process for %s active policy",
    async (kind) => {
      const original =
        kind === "empty"
          ? request([])
          : request([], {
              patterns: [{ id: "off-ordinary", pattern: "git status", behavior: "off" }],
              allowedPatterns: [{ id: "off-allow", pattern: "git diff", enabled: false }],
              autoDenyPatterns: [{ id: "off-deny", pattern: "git log", behavior: "off" }],
            });
      const before = JSON.stringify(original);
      const prepared = prepareJevCommandProcess(original);
      expect(prepared.manifest).toEqual([]);
      expect(prepared.syntax).toBeUndefined();
      expect(prepared.syntaxPlan).toEqual({
        requested: false,
        reason: "empty-active-manifest",
        rowCount: 0,
        manifestHash: hash([]),
        sourceGroups: { allowedPatterns: [], autoDenyPatterns: [], patterns: [] },
      });
      expect(restoreJevNonCommandRequest(prepared)).toBe(before);
      expect(() => restoreJevOriginalSyntax(prepared)).toThrow(JevClientError);
      const selected = transport();
      const completed = await run(original, selected).promise;
      expect(completed.completed).toBe(true);
      expect(completed.gate).toBe("allow");
      expect(selected.requestSyntax).not.toHaveBeenCalled();
      expect(completed.stages.map((row) => row.stage)).toEqual(["non_command", "command_policy"]);
      expect(completed.syntaxTranscript).toEqual([]);
      expect(completed.attempts.map((row) => row.stage)).toEqual(["non_command", "command_policy"]);
      expect(state(selected.requestCommandPolicy.mock.calls[0][0] as JevRequest)).toEqual({
        version: 35,
        allowedPatterns: [],
        autoDenyPatterns: [],
        patterns: [],
      });
      expect(completed.origins.command_policy.requestId).toBe("test-command_policy");
      expect(completed).not.toHaveProperty("syntaxRequestId");
      if (kind === "all off")
        expect(
          state(prepared.nonCommand.request as JevRequest).policy.commands.effectWaivers,
        ).toHaveLength(1);
    },
  );
  it("asks Jev for the empty-group action and preserves an actual block", async () => {
    const selected = transport();
    selected.requestCommandPolicy.mockImplementation(async (current) =>
      result("command_policy", current, { command_policy: block() }),
    );
    const completed = await run(request([]), selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("block");
    expect(completed.actualBlocks[0].questionId).toBe("command_policy");
    expect(selected.requestSyntax).not.toHaveBeenCalled();
  });
  it("keeps a first block after an empty-group action error", async () => {
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) =>
      result("non_command", current, { risk: block() }),
    );
    selected.requestCommandPolicy.mockRejectedValue(new JevClientError("http_error"));
    const completed = await run(request([]), selected).promise;
    expect(completed.gate).toBe("block");
    expect(completed.actualBlocks[0].questionId).toBe("risk");
    expect(completed.failure).toEqual({ stage: "command_policy", code: "http_error" });
    expect(selected.requestSyntax).not.toHaveBeenCalled();
  });
  it("rejects an invented binary reply for an empty manifest", () => {
    const prepared = prepareJevCommandProcess(request([]));
    const first = result("non_command", prepared.nonCommand.request);
    const invented = {
      stage: "syntax",
      answers: {},
      evidence: first.evidence,
    } as unknown as JevSyntaxStageResult;
    expect(() => buildJevGroupedCommandRequest(prepared, first, invented)).toThrow(JevClientError);
  });
});

describe("actual head and stage binding", () => {
  it("keeps separate actual risk and command heads and origins", async () => {
    const original = request();
    original.questions.disclosure = clone(original.questions.risk);
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) =>
      result("non_command", current, { risk: allow(0.990123), disclosure: allow(1) }),
    );
    const completed = await run(original, selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("allow");
    expect(completed.stages).toHaveLength(3);
    expect(completed.answers.risk.probabilities.allow).toBe(0.990123);
    expect(completed.answers.risk.confidence).toBe(0.812345);
    expect(completed.origins.risk.stage).toBe("non_command");
    expect(completed.origins.command_policy.stage).toBe("command_policy");
    expect(completed.origins.risk.requestHash).toBe(completed.stages[0].evidence.requestHash);
    expect(completed.syntaxTranscript[0].origin.requestHash).toBe(
      completed.stages[1].evidence.requestHash,
    );
    expect(completed.syntaxTranscript[0].origin.questionId).toBe("r_a");
    expect(completed).not.toHaveProperty("prediction");
    expect(completed.distributionsCombined).toBe(false);
    expect(completed.representsOneProviderReply).toBe(false);
    expect(selected.close).toHaveBeenCalled();
  });
  it("keeps 64 rows across all source groups through one call per stage", async () => {
    const original = request(Array(61).fill("git log"), {
      allowedPatterns: [
        { id: "allow-first", pattern: "git status" },
        { id: "allow-second", pattern: "git diff" },
      ],
      autoDenyPatterns: [{ id: "deny", pattern: "git show" }],
    });
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) =>
      result(
        "syntax",
        current,
        Object.fromEntries(
          Object.keys(current.questions).map((rowId, index) => [
            rowId,
            syntax(index === 63 ? 0.98 : 1, index % 2 ? "match" : "no_match"),
          ]),
        ),
      ),
    );
    const completed = await run(original, selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("confirm");
    expect(completed.syntaxTranscript).toHaveLength(64);
    const posted = state(selected.requestCommandPolicy.mock.calls[0][0] as JevRequest);
    expect(posted.allowedPatterns.map((row) => row.rowId)).toEqual(["u_a", "u_b"]);
    expect(posted.autoDenyPatterns.map((row) => row.rowId)).toEqual(["u_c"]);
    expect(posted.patterns).toHaveLength(61);
    expect(posted.patterns.at(-1).rowId).toBe("u_bl");
    expect(posted.patterns.at(-1).answer).toEqual(completed.syntaxTranscript.at(-1).answer);
    expect(completed.syntaxTranscript.at(-1).origin.questionId).toBe("r_bl");
    for (const name of ["requestNonCommand", "requestSyntax", "requestCommandPolicy"] as const)
      expect(selected[name]).toHaveBeenCalledTimes(1);
    expect(completed.actualBlocks).toEqual([]);
  });
  it("permits .99 selected match probability without a host match calculation", async () => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) =>
      result("syntax", current, { r_a: syntax(0.99, "match") }),
    );
    const completed = await run(request(), selected).promise;
    expect(completed.gate).toBe("allow");
    expect(completed.syntaxTranscript[0].answer.choice).toBe("match");
    expect(completed.answers.command_policy).toEqual(allow());
  });
  it("does not soften a conditional block from low binary confidence", async () => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) =>
      result("syntax", current, { r_a: syntax(0.55, "match") }),
    );
    selected.requestCommandPolicy.mockImplementation(async (current) =>
      result("command_policy", current, { command_policy: block() }),
    );
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("block");
    expect(completed.actualBlocks[0].questionId).toBe("command_policy");
    expect(completed.syntaxTranscript[0].answer.probabilities.match).toBe(0.55);
    expect(
      state(selected.requestCommandPolicy.mock.calls[0][0] as JevRequest).patterns[0].answer,
    ).toEqual(syntax(0.55, "match"));
  });
  it.each([0.98, 0.989999])(
    "requires confirmation for binary P(selected)=%s",
    async (probability) => {
      const selected = transport();
      selected.requestSyntax.mockImplementation(async (current) =>
        result("syntax", current, { r_a: syntax(probability) }),
      );
      expect((await run(request(), selected).promise).gate).toBe("confirm");
    },
  );
  it("uses raw selected probability and no confidence multiplication", async () => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) => {
      const answer = syntax(0.99);
      answer.confidence = 0.01;
      return result("syntax", current, { r_a: answer });
    });
    const completed = await run(request(), selected).promise;
    expect(completed.gate).toBe("allow");
    expect(completed.syntaxTranscript[0].answer.confidence).toBe(0.01);
  });
  it.each(["action probability", "incomplete original context", "confirm head"])(
    "requires confirmation for %s",
    async (kind) => {
      const original = request();
      const selected = transport();
      if (kind === "incomplete original context")
        state(original).observations.contextComplete = false;
      else
        selected.requestNonCommand.mockImplementation(async (current) => {
          const answer =
            kind === "action probability"
              ? allow(0.98)
              : {
                  choice: "confirm" as const,
                  probabilities: { allow: 0.01, confirm: 0.99, block: 0 },
                  confidence: 0.9,
                };
          return result("non_command", current, { risk: answer });
        });
      expect((await run(original, selected).promise).gate).toBe("confirm");
    },
  );
  it("requires confirmation for low actual final command probability", async () => {
    const selected = transport();
    selected.requestCommandPolicy.mockImplementation(async (current) =>
      result("command_policy", current, { command_policy: allow(0.98) }),
    );
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("confirm");
    expect(completed.answers.command_policy.probabilities.allow).toBe(0.98);
  });
  it("keeps raw negative zero from a strict binary answer", async () => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) => {
      const answer = syntax();
      answer.probabilities.match = -0;
      return result("syntax", current, { r_a: answer });
    });
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(true);
    expect(Object.is(completed.syntaxTranscript[0].answer.probabilities.match, -0)).toBe(true);
  });
  it("preserves closed rounded raw vectors without normalizing them", async () => {
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) =>
      result("non_command", current, {
        risk: {
          choice: "allow",
          probabilities: { allow: 0.99, confirm: 0.01, block: 0.01 },
          confidence: 0.81,
        },
      }),
    );
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.answers.risk.probabilities).toEqual({
      allow: 0.99,
      confirm: 0.01,
      block: 0.01,
    });
  });
  it.each([
    [
      "missing row",
      (value) => {
        delete value.answers.r_a;
      },
    ],
    [
      "extra row",
      (value) => {
        value.answers.r_b = syntax();
      },
    ],
    [
      "wrong row ID",
      (value) => {
        value.answers.r_b = value.answers.r_a;
        delete value.answers.r_a;
      },
    ],
    [
      "duplicate row origin",
      (value) => {
        value.evidence.requestedQuestionIds = ["r_a", "r_a"];
      },
    ],
    [
      "wrong request origin",
      (value) => {
        value.evidence.requestHash = hash("another-request");
      },
    ],
    [
      "wrong transport origin",
      (value) => {
        value.evidence.transportHash = hash("another-transport");
      },
    ],
    [
      "wrong model",
      (value) => {
        value.evidence.model = "unverified-model";
      },
    ],
    [
      "wrong provider",
      (value) => {
        value.evidence.provider = "unverified-provider";
      },
    ],
    [
      "bad binary vector",
      (value) => {
        value.answers.r_a.probabilities = { match: 0.4, no_match: 0.4 };
      },
    ],
    [
      "extra binary choice",
      (value) => {
        value.answers.r_a.probabilities.unknown = 0;
      },
    ],
    [
      "wrong argmax",
      (value) => {
        value.answers.r_a.choice = "match";
      },
    ],
    [
      "non-finite confidence",
      (value) => {
        value.answers.r_a.confidence = Infinity;
      },
    ],
  ] as const)("blocks %s and keeps first evidence", async (_label, mutate) => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) => {
      const reply = result("syntax", current);
      mutate(reply as any);
      return reply;
    });
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(false);
    expect(completed.gate).toBe("block");
    expect(completed.failure.stage).toBe("syntax");
    expect(completed.failure.code).toBe("invalid_response");
    expect(completed.stages).toHaveLength(1);
    expect(completed.answers.risk).toEqual(allow());
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
    expect(completed.actualBlocks).toEqual([]);
  });
  it("rejects reordered origin IDs even when all answers exist", async () => {
    const selected = transport();
    selected.requestSyntax.mockImplementation(async (current) => {
      const reply = result("syntax", current);
      reply.evidence.requestedQuestionIds.reverse();
      return reply;
    });
    const completed = await run(request(["git status", "git diff"]), selected).promise;
    expect(completed.gate).toBe("block");
    expect(completed.failure.stage).toBe("syntax");
  });
  it.each(["syntax", "command_policy"])(
    "keeps an actual first block after a %s failure",
    async (stage) => {
      const selected = transport();
      selected.requestNonCommand.mockImplementation(async (current) =>
        result("non_command", current, { risk: block() }),
      );
      if (stage === "syntax")
        selected.requestSyntax.mockRejectedValue(new JevClientError("http_error"));
      else selected.requestCommandPolicy.mockRejectedValue(new JevClientError("invalid_response"));
      const completed = await run(request(), selected).promise;
      expect(completed.gate).toBe("block");
      expect(completed.actualBlocks).toHaveLength(1);
      expect(completed.actualBlocks[0].questionId).toBe("risk");
      expect(completed.answers.risk).toEqual(block());
      expect(completed.failure).toEqual({
        stage,
        code: stage === "syntax" ? "http_error" : "invalid_response",
      });
      expect(completed.stages).toHaveLength(stage === "syntax" ? 1 : 2);
      expect(completed.syntaxTranscript).toHaveLength(stage === "syntax" ? 0 : 1);
    },
  );
  it("continues the complete plan after an actual first block", async () => {
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) =>
      result("non_command", current, { risk: block() }),
    );
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(true);
    expect(completed.gate).toBe("block");
    expect(completed.stages).toHaveLength(3);
  });
  it("blocks a missing last reply and keeps the exact binary transcript", async () => {
    const selected = transport();
    selected.requestCommandPolicy.mockResolvedValue(undefined);
    const completed = await run(request(), selected).promise;
    expect(completed.gate).toBe("block");
    expect(completed.syntaxTranscript[0].answer).toEqual(syntax());
    expect(completed.answers).not.toHaveProperty("command_policy");
    expect(completed.stages).toHaveLength(2);
  });
});

it("retains a bound failed attempt and marks a prefix as incomplete", async () => {
  const selected = transport();
  let retained;
  selected.requestSyntax.mockImplementation(async (current) => {
    const prepared = result("syntax", current).evidence;
    retained = {
      stage: "syntax" as const,
      requestedQuestionIds: prepared.requestedQuestionIds,
      requestHash: prepared.requestHash,
      requestBytes: prepared.requestBytes,
      transportHash: prepared.transportHash,
      latencyMs: 17,
      requestSent: true,
      failure: "transport_error" as const,
      responseComplete: false,
      responsePrefixHash: hash("bounded partial reply"),
      responsePrefixBytes: 21,
    };
    throw new JevStageClientError("transport_error", retained);
  });
  const completed = await run(request(), selected).promise;
  expect(completed.failureEvidence).toEqual(retained);
  expect(completed.failureEvidence.responseComplete).toBe(false);
  expect(completed.failureEvidence).not.toHaveProperty("responseHash");
  expect(completed.stages).toHaveLength(1);
  expect(completed.attempts[1].requestHash).toBe(retained.requestHash);
});
it("rejects a wrong failed-attempt origin without losing first evidence", async () => {
  const selected = transport();
  selected.requestSyntax.mockImplementation(async (current) => {
    const prepared = result("syntax", current).evidence;
    throw new JevStageClientError("http_error", {
      stage: "syntax",
      requestedQuestionIds: prepared.requestedQuestionIds,
      requestHash: hash("wrong-origin"),
      requestBytes: prepared.requestBytes,
      transportHash: prepared.transportHash,
      latencyMs: 17,
      requestSent: true,
      failure: "http_error",
    });
  });
  const completed = await run(request(), selected).promise;
  expect(completed.failure.code).toBe("invalid_response");
  expect(completed.failureEvidence).toBeUndefined();
  expect(completed.stages).toHaveLength(1);
});

it.each([
  [
    "mixed complete and prefix hashes",
    (value) => {
      value.responseComplete = false;
      value.responseHash = hash("misstated whole reply");
      value.responseBytes = 11;
      value.responsePrefixHash = hash("prefix");
      value.responsePrefixBytes = 6;
    },
  ],
  [
    "extra private field",
    (value) => {
      value.extra = "private field text";
    },
  ],
  [
    "non-finite latency",
    (value) => {
      value.latencyMs = Infinity;
    },
  ],
  [
    "unsupported sent state",
    (value) => {
      value.requestSent = "yes";
    },
  ],
  [
    "bad prefix size",
    (value) => {
      value.responseComplete = false;
      value.responsePrefixHash = hash("prefix");
      value.responsePrefixBytes = 65537;
    },
  ],
] as const)("rejects %s in failure evidence", async (_label, mutate) => {
  const selected = transport();
  selected.requestSyntax.mockImplementation(async (current) => {
    const prepared = result("syntax", current).evidence;
    const evidence = {
      stage: "syntax" as const,
      requestedQuestionIds: prepared.requestedQuestionIds,
      requestHash: prepared.requestHash,
      requestBytes: prepared.requestBytes,
      transportHash: prepared.transportHash,
      latencyMs: 17,
      requestSent: true,
      failure: "http_error" as const,
    };
    mutate(evidence as any);
    throw new JevStageClientError("http_error", evidence);
  });
  const completed = await run(request(), selected).promise;
  expect(completed.failure.code).toBe("invalid_response");
  expect(completed.failureEvidence).toBeUndefined();
  expect(completed.stages).toHaveLength(1);
  expect(JSON.stringify(completed)).not.toContain("private field text");
});
it.each(["full", "prefix"])("rejects unsent %s response proof", async (form) => {
  const selected = transport();
  selected.requestSyntax.mockImplementation(async (current) => {
    const prepared = result("syntax", current).evidence;
    const evidence = {
      stage: "syntax" as const,
      requestedQuestionIds: prepared.requestedQuestionIds,
      requestHash: prepared.requestHash,
      requestBytes: prepared.requestBytes,
      transportHash: prepared.transportHash,
      latencyMs: 1,
      requestSent: false,
      failure: "http_error" as const,
      ...(form === "full"
        ? { responseComplete: true, responseHash: hash("reply"), responseBytes: 5 }
        : { responseComplete: false, responsePrefixHash: hash("prefix"), responsePrefixBytes: 6 }),
    };
    throw new JevStageClientError("http_error", evidence);
  });
  const completed = await run(request(), selected).promise;
  expect(completed.failure.code).toBe("invalid_response");
  expect(completed.failureEvidence).toBeUndefined();
  expect(completed.stages).toHaveLength(1);
});
it("keeps pre-preparation failure evidence distinct from the local request plan", async () => {
  const selected = transport();
  selected.requestSyntax.mockImplementation(async (current) => {
    throw new JevStageClientError("cancelled", {
      stage: "syntax",
      requestedQuestionIds: [],
      transportHash: result("syntax", current).evidence.transportHash,
      latencyMs: 1,
      requestSent: false,
      failure: "cancelled",
    });
  });
  const completed = await run(request(), selected).promise;
  expect(completed.failure.code).toBe("cancelled");
  expect(completed.failureEvidence.requestedQuestionIds).toEqual([]);
  expect(completed.failureEvidence).not.toHaveProperty("requestHash");
  expect(completed.attempts[1].requestedQuestionIds).toEqual(["r_a"]);
  expect(completed.attempts[1].requestHash).toMatch(/^[a-f0-9]{64}$/);
});

describe("one absolute total deadline and cancellation", () => {
  it("passes one caller deadline into the transport factory", async () => {
    const deadline = performance.now() + 1300;
    const test = run(request(), transport(), deadline);
    expect((await test.promise).completed).toBe(true);
    expect(test.createTransport).toHaveBeenCalledWith({ deadline, signal: undefined });
  });
  it("rejects an extended or expired deadline before transport", async () => {
    for (const deadline of [performance.now() - 1, performance.now() + 10_001]) {
      const test = run(request(), transport(), deadline);
      expect((await test.promise).gate).toBe("block");
      expect(test.createTransport).not.toHaveBeenCalled();
    }
  });
  it("cancels a pending second stage even if transport ignores cancellation", async () => {
    const controller = new AbortController();
    const selected = transport();
    selected.requestSyntax.mockImplementation(async () => {
      controller.abort();
      return await new Promise(() => {});
    });
    const completed = await run(request(), selected, performance.now() + 1400, controller.signal)
      .promise;
    expect(completed.failure).toEqual({ stage: "syntax", code: "cancelled" });
    expect(completed.stages).toHaveLength(1);
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
    expect(selected.close).toHaveBeenCalled();
  });
  it("uses the remaining total time and blocks a stalled last stage", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const selected = transport();
    selected.requestCommandPolicy.mockImplementation(async () => await new Promise(() => {}));
    const test = run(request(), selected, performance.now() + 40);
    await vi.advanceTimersByTimeAsync(39);
    expect(selected.requestCommandPolicy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const completed = await test.promise;
    expect(completed.failure).toEqual({ stage: "command_policy", code: "timeout" });
    expect(completed.stages).toHaveLength(2);
    expect(completed.latencyMs).toBeLessThan(500);
  });
  it("blocks an already cancelled process before construction", async () => {
    const controller = new AbortController();
    controller.abort();
    const test = run(request(), transport(), performance.now() + 1400, controller.signal);
    expect((await test.promise).failure.code).toBe("cancelled");
    expect(test.createTransport).not.toHaveBeenCalled();
  });
  it("uses time from earlier calls in the same total deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      return result("non_command", current);
    });
    selected.requestSyntax.mockImplementation(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 600));
      return result("syntax", current);
    });
    selected.requestCommandPolicy.mockImplementation(async () => await new Promise(() => {}));
    const test = run(request(), selected, performance.now() + 1400);
    await vi.advanceTimersByTimeAsync(700);
    expect(selected.requestSyntax).toHaveBeenCalledTimes(1);
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(600);
    expect(selected.requestCommandPolicy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(99);
    expect(selected.close).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    const completed = await test.promise;
    expect(completed.failure).toEqual({ stage: "command_policy", code: "timeout" });
    expect(completed.latencyMs).toBe(1400);
    expect(completed.stages).toHaveLength(2);
  });
  it("admits exactly 10,000 ms and rejects an extended total deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const admitted = run(request(), transport(), performance.now() + 10_000);
    expect((await admitted.promise).completed).toBe(true);
    const extended = run(request(), transport(), performance.now() + 10_000.001);
    expect((await extended.promise).failure.code).toBe("invalid_request");
    expect(extended.createTransport).not.toHaveBeenCalled();
  });
  it.each([2_999, 3_000])("uses one 10,000 ms bound with a %s ms last stage", async (lastMs) => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const selected = transport();
    selected.requestNonCommand.mockImplementation(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 4_000));
      return result("non_command", current);
    });
    selected.requestSyntax.mockImplementation(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, 3_000));
      return result("syntax", current);
    });
    selected.requestCommandPolicy.mockImplementation(async (current) => {
      await new Promise((resolve) => setTimeout(resolve, lastMs));
      return result("command_policy", current);
    });
    const test = run(request(), selected, performance.now() + 10_000);
    await vi.advanceTimersByTimeAsync(10_000);
    const completed = await test.promise;
    expect(completed.completed).toBe(lastMs === 2_999);
    expect(completed.gate).toBe(lastMs === 2_999 ? "allow" : "block");
    expect(completed.latencyMs).toBe(7_000 + lastMs);
    expect(completed.stages).toHaveLength(lastMs === 2_999 ? 3 : 2);
    expect(completed.failure).toEqual(
      lastMs === 2_999 ? undefined : { stage: "command_policy", code: "timeout" },
    );
    for (const name of ["requestNonCommand", "requestSyntax", "requestCommandPolicy"] as const)
      expect(selected[name]).toHaveBeenCalledTimes(1);
  });
  it("includes preparation time before transport construction", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const original = request();
    vi.spyOn(globalThis, "structuredClone").mockImplementationOnce((value) => {
      vi.advanceTimersByTime(10_000);
      return clone(value);
    });
    const test = run(original, transport(), performance.now() + 10_000);
    const completed = await test.promise;
    expect(completed.failure).toEqual({ stage: "prepare", code: "timeout" });
    expect(completed.gate).toBe("block");
    expect(completed.latencyMs).toBe(10_000);
    expect(test.createTransport).not.toHaveBeenCalled();
  });
  it("includes the transport factory callback in the same deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const selected = transport();
    const createTransport = vi.fn(() => {
      vi.advanceTimersByTime(10_000);
      return selected;
    });
    const completed = await runJevCommandProcess(request(), {
      deadline: performance.now() + 10_000,
      createTransport,
    });
    expect(completed.failure).toEqual({ stage: "prepare", code: "timeout" });
    expect(completed.gate).toBe("block");
    expect(completed.latencyMs).toBe(10_000);
    expect(createTransport).toHaveBeenCalledTimes(1);
    expect(selected.requestNonCommand).not.toHaveBeenCalled();
    expect(selected.close).toHaveBeenCalledTimes(1);
  });
  it("blocks when final cleanup reaches the deadline and retains all actual heads", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    const selected = transport();
    selected.close.mockImplementation(() => vi.advanceTimersByTime(10_000));
    const completed = await run(request(), selected, performance.now() + 10_000).promise;
    expect(completed.completed).toBe(false);
    expect(completed.gate).toBe("block");
    expect(completed.failure).toEqual({ stage: "command_policy", code: "timeout" });
    expect(completed.stages).toHaveLength(3);
    expect(completed.answers.command_policy).toEqual(allow());
    expect(completed.cleanupFailed).toBe(false);
    expect(completed.latencyMs).toBe(10_000);
    expect(selected.close).toHaveBeenCalledTimes(1);
  });
  it("has no fallback request after a first-stage failure", async () => {
    const selected = transport();
    selected.requestNonCommand.mockRejectedValue(new Error("untrusted remote text"));
    const completed = await run(request(), selected).promise;
    expect(completed.failure).toEqual({ stage: "non_command", code: "transport_error" });
    expect(selected.requestNonCommand).toHaveBeenCalledTimes(1);
    expect(selected.requestSyntax).not.toHaveBeenCalled();
    expect(selected.requestCommandPolicy).not.toHaveBeenCalled();
    expect(JSON.stringify(completed)).not.toContain("untrusted remote text");
  });
  it("blocks a cleanup error and keeps all actual heads and evidence", async () => {
    const selected = transport();
    selected.close.mockImplementation(() => {
      throw new Error("private cleanup text");
    });
    const completed = await run(request(), selected).promise;
    expect(completed.completed).toBe(false);
    expect(completed.gate).toBe("block");
    expect(completed.failure.code).toBe("transport_error");
    expect(completed.cleanupFailed).toBe(true);
    expect(completed.stages).toHaveLength(3);
    expect(completed.answers.command_policy).toEqual(allow());
    expect(JSON.stringify(completed)).not.toContain("private cleanup text");
  });
  it("cancellation does not throw when cleanup also fails", async () => {
    const controller = new AbortController();
    const selected = transport();
    selected.close.mockImplementation(() => {
      throw new Error("private cleanup text");
    });
    selected.requestSyntax.mockImplementation(async () => {
      controller.abort();
      return await new Promise(() => {});
    });
    const completed = await run(request(), selected, performance.now() + 1400, controller.signal)
      .promise;
    expect(completed.gate).toBe("block");
    expect(completed.failure.code).toBe("cancelled");
    expect(completed.cleanupFailed).toBe(true);
    expect(completed.stages).toHaveLength(1);
  });
  it("a release gate cannot allow partial heads or an incomplete process", () => {
    expect(jevCommandProcessGate(true, { risk: allow() }, { r_a: syntax() }, true)).toBe("confirm");
    expect(
      jevCommandProcessGate(
        true,
        { risk: allow(), command_policy: allow() },
        { r_a: syntax() },
        false,
      ),
    ).toBe("block");
  });
});
