/* SPDX-License-Identifier: Apache-2.0 */
/** Build and bind command stages. Jev alone selects matches and policy actions. */
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  JEV_MODEL,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_RESPONSE_VALIDATION_CONTRACT,
  JEV_COMMAND_PROCESS_TIMEOUT_MS,
  JevClientError,
  JevStageClientError,
} from "./jev-client.ts";
import type {
  JevChoiceAnswer,
  JevCommandPolicyRequest,
  JevCommandPolicyStageResult,
  JevNonCommandRequest,
  JevNonCommandStageResult,
  JevProcessTransport,
  JevQuestionId,
  JevRequest,
  JevStageEvidence,
  JevStageFailureEvidence,
  JevSyntaxChoiceAnswer,
  JevSyntaxQuestionId,
  JevSyntaxRequest,
  JevSyntaxStageResult,
} from "./types.ts";

const GROUPS = ["allowedPatterns", "autoDenyPatterns", "patterns"] as const;
const ACTIONS = ["allow", "confirm", "block"] as const;
const BINARY = ["match", "no_match"] as const;
const QUESTION_IDS = [
  "risk",
  "file_policy",
  "command_policy",
  "org_policy",
  "disclosure",
  "authority",
];
const SHAPES = {
  tokens: ["tokens"],
  empty: [],
  dd_output: ["head", "equalsPrefix"],
  mkfs: ["exact", "dotPrefix"],
  remote_script_to_shell: ["downloaders", "shells"],
  base64_decode_to_shell: ["head", "decodeArgs", "shells"],
  pi_credential_output: ["auth", "check", "credentials", "printActions"],
  find_delete: ["head", "arg"],
  find_exec_rm: ["head", "exec", "rm"],
} as const;
const ARRAYS = new Set(["tokens", "downloaders", "shells", "decodeArgs", "printActions"]);
const PREFIXES = new Set(["equalsPrefix", "dotPrefix"]);
const GRAMMAR_HASH = "175e2cd3710728e2918006af078066b690ba007fad00937de24e08cb809f566c";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const keys = (value: unknown, names: readonly string[]): value is Record<string, unknown> =>
  object(value) &&
  Object.keys(value).length === names.length &&
  names.every((name) => Object.hasOwn(value, name));
function fail(): never {
  throw new JevClientError("invalid_request");
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export const JEV_COMMAND_PROCESS_LIMITS = freeze({
  totalTimeoutMs: JEV_COMMAND_PROCESS_TIMEOUT_MS,
  maxRows: 64,
  maxRequestBytes: 32_768,
  maxViews: 256,
  maxTokens: 4096,
  maxClasses: 2048,
  maxPublicNames: 256,
  maxJsonNodes: 16_384,
  maxDepth: 32,
  automaticAllowProbability: 0.99,
});
export const JEV_COMMAND_SYNTAX_TEMPLATES = freeze({
  originalQuestion: "Does this exact syntax selector match?",
  rule: "Use the exact shared matchGrammar and commandTokens. Compare the required token IDs and namespaces. Missing spelling is not missing token context. Match only this selector. Do not infer a match from an operation effect.",
  originalCriteria: {
    match: "The exact selector matches the shared commandTokens under matchGrammar.",
    no_match: "The exact selector does not match the shared commandTokens under matchGrammar.",
  },
  sharedQuestion: "Does the selector in this question match?",
  inlineQuestion: "Does this selector match?",
  inlineCriteria: { match: "Exact match.", no_match: "No exact match." },
});
export const JEV_COMMAND_ACTION_INSTRUCTION =
  "Choose the command policy action from all three source groups. Every row contains its own binary model answer. Its selected match or no_match choice is the only syntax signal available here. For this diagnostic, take these selected choices as conditional syntax premises. Apply source order and declared behavior to those premises. The choices remain fallible model evidence. They are not authoritative host facts. Selectors and command tokens are absent. Do not invent a syntax match or redo syntax. Binary vectors and confidence are fallible estimates. They are not another match vote or action probabilities. Low binary confidence must not change a selected declared block behavior into confirm. Jev alone applies policy order. First inspect all allowedPatterns rows. If any row selects match, choose allow. Otherwise inspect all autoDenyPatterns rows. If any row selects match, choose block. Otherwise inspect patterns rows in their array order. Use the declared behavior of the FIRST row that selects match. If no patterns row selects match, choose allow. Keep every row, including shadowed matches. Effect waivers are outside these active source groups. Produce your own actual allow/confirm/block distribution conditional on the selected premises. Do not scale, multiply, or convert binary vectors into action probabilities.";
export const JEV_COMMAND_ACTION_CRITERIA = freeze({
  allow:
    "Any allowedPatterns row selects match. Otherwise, no autoDenyPatterns row selects match and the first patterns row that selects match declares allow. If every row selects no_match, choose allow.",
  confirm:
    "Neither priority group selects match. The first patterns row that selects match declares confirm.",
  block:
    "No allowedPatterns row selects match. Any autoDenyPatterns row selects match. Otherwise, the first patterns row that selects match declares block.",
});
export const JEV_COMMAND_PROCESS_PROTOCOL = freeze({
  operatingPoint: "prospective-experimental-command-process",
  deadline:
    "One absolute performance.now() deadline includes preparation, all stages, waits, response reads, validation, and synchronous cleanup work. Cancellation starts without awaiting asynchronous cleanup completion. The total limit is 10,000 ms. No per-stage reset. The current hook and one-call limit stay at 1,500 ms.",
  stages: ["non_command", "syntax", "command_policy"],
  emptyManifestStages: ["non_command", "command_policy"],
  emptyManifest:
    "Do not request syntax. Jev receives all three empty active source groups. No synthetic syntax reply. The selected binary confidence condition is vacuous only for this branch.",
  groups: GROUPS,
  selectorShapes: SHAPES,
  syntaxStateVersion: 37,
  originalSyntaxStateVersion: 31,
  commandStateVersion: 35,
  syntaxId: "ordered-alphabetic-r_a-through-r_bl",
  groupedRowId: "ordered-alphabetic-u_a-through-u_bl",
  grammarHash: GRAMMAR_HASH,
  syntaxTemplates: JEV_COMMAND_SYNTAX_TEMPLATES,
  actionInstruction: JEV_COMMAND_ACTION_INSTRUCTION,
  actionCriteria: JEV_COMMAND_ACTION_CRITERIA,
  limits: JEV_COMMAND_PROCESS_LIMITS,
  automaticAllow:
    "Complete original context; every actual action head allows with raw P(allow)>=.99; every actual binary head has raw P(selected choice)>=.99. No joint calibration claim.",
  failure:
    "Any error blocks. Preserve all completed stage evidence and actual blocks. No retry or fallback.",
});

function jsonCopy<T>(value: T): T {
  let nodes = 0;
  const active = new Set<object>();
  function inspect(item: unknown, depth: number): void {
    if (
      ++nodes > JEV_COMMAND_PROCESS_LIMITS.maxJsonNodes ||
      depth > JEV_COMMAND_PROCESS_LIMITS.maxDepth
    )
      fail();
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number" && Number.isFinite(item)) return;
    if (!item || typeof item !== "object" || active.has(item)) fail();
    if (!Array.isArray(item) && ![Object.prototype, null].includes(Object.getPrototypeOf(item)))
      fail();
    active.add(item);
    const fields = Object.getOwnPropertyDescriptors(item);
    if (Array.isArray(item)) {
      if (Object.keys(fields).length !== item.length + 1) fail();
      for (let index = 0; index < item.length; index++)
        if (!Object.hasOwn(fields, String(index))) fail();
    }
    for (const name of Reflect.ownKeys(fields)) {
      if (Array.isArray(item) && name === "length") continue;
      if (typeof name !== "string") fail();
      const field = fields[name];
      if (!field.enumerable || !("value" in field)) fail();
      inspect(field.value, depth + 1);
    }
    active.delete(item);
  }
  inspect(value, 0);
  return structuredClone(value);
}
function replyCopy<T>(value: T): T {
  try {
    return jsonCopy(value);
  } catch {
    throw new JevClientError("invalid_response");
  }
}

function body<T>(request: T) {
  const json = JSON.stringify(request);
  const bytes = Buffer.byteLength(json);
  if (bytes > JEV_COMMAND_PROCESS_LIMITS.maxRequestBytes) fail();
  return freeze({ request, json, bytes, hash: hash(json) });
}
export function jevCommandRowId(
  index: number,
  prefix: "r" | "u" = "r",
): JevSyntaxQuestionId | `u_${string}` {
  if (
    !Number.isSafeInteger(index) ||
    Object.is(index, -0) ||
    index < 0 ||
    index >= JEV_COMMAND_PROCESS_LIMITS.maxRows
  )
    fail();
  let cursor = index + 1;
  let suffix = "";
  while (cursor) {
    suffix = String.fromCharCode(97 + ((cursor - 1) % 26)) + suffix;
    cursor = Math.floor((cursor - 1) / 26);
  }
  return `${prefix}_${suffix}`;
}
function id(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    !Object.is(value, -0) &&
    value >= 0 &&
    value < JEV_COMMAND_PROCESS_LIMITS.maxClasses
  );
}
function boundedArray(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail();
  return value;
}
function boundTokens(tokens: unknown) {
  if (
    !keys(tokens, [
      "version",
      "original",
      "expanded",
      "flat",
      "classes",
      "piArgs",
      "publicSyntax",
    ]) ||
    tokens.version !== 2
  )
    fail();
  const wholeIds = new Set<number>();
  for (const entry of boundedArray(tokens.classes, JEV_COMMAND_PROCESS_LIMITS.maxClasses)) {
    if (
      !object(entry) ||
      !Object.hasOwn(entry, "id") ||
      Object.keys(entry).some(
        (key) => !["id", "equalsPrefix", "dotPrefix", "versionPrefix"].includes(key),
      ) ||
      !Object.values(entry).every(id) ||
      wholeIds.has(entry.id as number)
    )
      fail();
    wholeIds.add(entry.id as number);
  }
  const whole = (value: unknown): value is number => id(value) && wholeIds.has(value);
  for (const name of ["original", "expanded"]) {
    let positions = 0;
    for (const view of boundedArray(tokens[name], JEV_COMMAND_PROCESS_LIMITS.maxViews)) {
      if (!keys(view, ["head", "args"]) || !whole(view.head)) fail();
      positions++;
      const args = boundedArray(view.args, JEV_COMMAND_PROCESS_LIMITS.maxTokens);
      if (!args.every(whole)) fail();
      positions += args.length;
    }
    if (positions > JEV_COMMAND_PROCESS_LIMITS.maxTokens) fail();
  }
  if (!boundedArray(tokens.flat, JEV_COMMAND_PROCESS_LIMITS.maxTokens).every(whole)) fail();
  let positions = 0;
  for (const sequence of boundedArray(tokens.piArgs, JEV_COMMAND_PROCESS_LIMITS.maxViews)) {
    const args = boundedArray(sequence, JEV_COMMAND_PROCESS_LIMITS.maxTokens);
    if (!args.every(whole)) fail();
    positions += args.length;
  }
  if (positions > JEV_COMMAND_PROCESS_LIMITS.maxTokens) fail();
  const names = new Map<number, string>();
  const words = new Set<string>();
  for (const entry of boundedArray(
    tokens.publicSyntax,
    JEV_COMMAND_PROCESS_LIMITS.maxPublicNames,
  )) {
    if (
      !keys(entry, ["word", "id"]) ||
      typeof entry.word !== "string" ||
      entry.word.length > 128 ||
      !/^[a-zA-Z0-9_.:-]+$/.test(entry.word) ||
      !whole(entry.id) ||
      names.has(entry.id) ||
      words.has(entry.word)
    )
      fail();
    names.set(entry.id, entry.word);
    words.add(entry.word);
  }
  return { tokens, wholeIds, names };
}
function selectorFromRow(row: unknown, tokens: ReturnType<typeof boundTokens>, waiver = false) {
  if (
    !object(row) ||
    !Object.hasOwn(SHAPES, String(row.kind)) ||
    (waiver ? row.behavior !== "off" : !ACTIONS.includes(row.behavior as never))
  )
    fail();
  const fields: readonly string[] = SHAPES[row.kind as keyof typeof SHAPES];
  if (!keys(row, ["behavior", "kind", ...fields, "publicNames"])) fail();
  const selector: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(row))
    if (field !== "behavior") selector[field] = jsonCopy(value);
  const names: Record<string, unknown> = {};
  for (const field of fields) {
    const value = selector[field];
    const valid = (item: unknown) => id(item) && (PREFIXES.has(field) || tokens.wholeIds.has(item));
    if (ARRAYS.has(field)) {
      if (
        !Array.isArray(value) ||
        !value.length ||
        value.length > JEV_COMMAND_PROCESS_LIMITS.maxTokens ||
        !value.every(valid)
      )
        fail();
    } else if (!valid(value)) fail();
    if (!PREFIXES.has(field))
      names[field] = Array.isArray(value)
        ? value.map((item) => tokens.names.get(item) ?? null)
        : (tokens.names.get(value as number) ?? null);
  }
  if (!isDeepStrictEqual(names, selector.publicNames)) fail();
  return {
    selector,
    behavior: row.behavior as "allow" | "confirm" | "block",
    originalRowHash: hash(JSON.stringify(row)),
  };
}

/** This projection changes no original operation, facts, policy, or non-command question. */
export function prepareJevCommandProcess(request: JevRequest) {
  const original = jsonCopy(request);
  const originalBody = body(original);
  if (
    !keys(original, ["model", "provider", "state", "questions"]) ||
    original.model !== JEV_MODEL ||
    !isDeepStrictEqual(original.provider, { only: ["typesafe"], allow_fallbacks: false }) ||
    !object(original.questions)
  )
    fail();
  const originalIds = Object.keys(original.questions);
  if (
    !originalIds.includes("risk") ||
    !originalIds.includes("command_policy") ||
    originalIds.some((key) => !QUESTION_IDS.includes(key))
  )
    fail();
  for (const question of Object.values(original.questions))
    if (
      !keys(question, ["type", "instructions", "criteria"]) ||
      question.type !== "choice" ||
      !keys(question.criteria, ACTIONS)
    )
      fail();
  const state = original.state;
  if (
    !object(state) ||
    !object(state.operation) ||
    !object(state.operation.metadata) ||
    !object(state.policy) ||
    !object(state.observations) ||
    typeof state.observations.contextComplete !== "boolean"
  )
    fail();
  const commands = state.policy.commands;
  if (
    !keys(commands, [...GROUPS, "effectWaivers", "matchGrammar"]) ||
    hash(JSON.stringify(commands.matchGrammar)) !== GRAMMAR_HASH
  )
    fail();
  const context = boundTokens(state.operation.metadata.commandTokens);
  for (const row of boundedArray(commands.effectWaivers, 256)) selectorFromRow(row, context, true);
  const nonCommand = jsonCopy(original);
  delete nonCommand.questions.command_policy;
  const first = body(nonCommand as JevNonCommandRequest);
  const removedCommandQuestion = JSON.stringify(original.questions.command_policy);
  const manifest: Array<{
    rowId: JevSyntaxQuestionId;
    questionId: JevSyntaxQuestionId;
    group: (typeof GROUPS)[number];
    ordinal: number;
    behavior: "allow" | "confirm" | "block";
    projectedRow: unknown;
    selector: Record<string, unknown>;
    originalRowHash: string;
  }> = [];
  const questions: JevSyntaxRequest["questions"] = {};
  for (const group of GROUPS) {
    for (const [index, row] of boundedArray(
      commands[group],
      JEV_COMMAND_PROCESS_LIMITS.maxRows,
    ).entries()) {
      const selected = selectorFromRow(row, context);
      const rowId = jevCommandRowId(manifest.length) as JevSyntaxQuestionId;
      manifest.push({
        rowId,
        questionId: rowId,
        group,
        ordinal: index + 1,
        ...selected,
        projectedRow: jsonCopy(row),
      });
      questions[rowId] = {
        type: "choice",
        instructions: {
          question: JEV_COMMAND_SYNTAX_TEMPLATES.inlineQuestion,
          selector: selected.selector,
        },
        criteria: jsonCopy(JEV_COMMAND_SYNTAX_TEMPLATES.inlineCriteria),
      };
    }
  }
  const syntax = manifest.length
    ? body<JevSyntaxRequest>({
        model: original.model,
        provider: jsonCopy(original.provider),
        state: {
          version: 37,
          commandTokens: jsonCopy(context.tokens),
          matchGrammar: jsonCopy(commands.matchGrammar),
          syntaxInstruction: {
            question: JEV_COMMAND_SYNTAX_TEMPLATES.sharedQuestion,
            rule: JEV_COMMAND_SYNTAX_TEMPLATES.rule,
            criteria: jsonCopy(JEV_COMMAND_SYNTAX_TEMPLATES.originalCriteria),
          },
        },
        questions,
      })
    : undefined;
  // Bound the final body before transport creation. Finite JSON numbers use at most 24 bytes.
  const reserve = manifest.length * 4 * 24 + 512;
  const skeleton = groupedBody(
    original,
    manifest,
    Object.fromEntries(
      manifest.map((row) => [
        row.questionId,
        { choice: "no_match", probabilities: { match: 0, no_match: 1 }, confidence: 1 },
      ]),
    ) as Record<JevSyntaxQuestionId, JevSyntaxChoiceAnswer>,
  );
  if (
    Buffer.byteLength(JSON.stringify(skeleton)) + reserve >
    JEV_COMMAND_PROCESS_LIMITS.maxRequestBytes
  )
    fail();
  return freeze({
    original: originalBody,
    nonCommand: first,
    syntax,
    syntaxPlan: manifest.length
      ? { requested: true as const, rowCount: manifest.length }
      : {
          requested: false as const,
          reason: "empty-active-manifest" as const,
          rowCount: 0,
          manifestHash: hash(JSON.stringify(manifest)),
          sourceGroups: { allowedPatterns: [], autoDenyPatterns: [], patterns: [] },
        },
    manifest,
    manifestHash: hash(JSON.stringify(manifest)),
    originalQuestionIds: originalIds as JevQuestionId[],
    removedCommandQuestion,
    contextComplete: state.observations.contextComplete,
    tokenContextHash: hash(JSON.stringify(context.tokens)),
    grammarHash: GRAMMAR_HASH,
  });
}
export function restoreJevNonCommandRequest(
  prepared: ReturnType<typeof prepareJevCommandProcess>,
): string {
  const rebuilt = prepareJevCommandProcess(prepared.original.request);
  if (!isDeepStrictEqual(prepared, rebuilt)) fail();
  const restored = jsonCopy(prepared.nonCommand.request);
  restored.questions = Object.fromEntries(
    prepared.originalQuestionIds.map((key) => [
      key,
      key === "command_policy"
        ? JSON.parse(prepared.removedCommandQuestion)
        : restored.questions[key],
    ]),
  ) as JevNonCommandRequest["questions"];
  const json = JSON.stringify(restored);
  if (json !== prepared.original.json) fail();
  return json;
}
/** Restore the exact long syntax body. This inverse makes no model match. */
export function restoreJevOriginalSyntax(
  prepared: ReturnType<typeof prepareJevCommandProcess>,
): string {
  const rebuilt = prepareJevCommandProcess(prepared.original.request);
  if (!isDeepStrictEqual(prepared, rebuilt)) fail();
  if (!prepared.syntax) fail();
  const request = jsonCopy(prepared.syntax.request);
  const state = request.state as Record<string, unknown>;
  delete state.syntaxInstruction;
  state.version = 31;
  for (const row of prepared.manifest)
    request.questions[row.questionId] = {
      type: "choice",
      instructions: {
        question: JEV_COMMAND_SYNTAX_TEMPLATES.originalQuestion,
        selector: jsonCopy(row.selector),
        rule: JEV_COMMAND_SYNTAX_TEMPLATES.rule,
      },
      criteria: jsonCopy(JEV_COMMAND_SYNTAX_TEMPLATES.originalCriteria),
    };
  return JSON.stringify(request);
}
function groupedBody(
  original: JevRequest,
  manifest: ReturnType<typeof prepareJevCommandProcess>["manifest"],
  answers: Record<JevSyntaxQuestionId, JevSyntaxChoiceAnswer>,
): JevCommandPolicyRequest {
  const state = { version: 35, allowedPatterns: [], autoDenyPatterns: [], patterns: [] };
  manifest.forEach((row, index) =>
    state[row.group].push({
      rowId: jevCommandRowId(index, "u"),
      behavior: row.behavior,
      answer: jsonCopy(answers[row.questionId]),
    }),
  );
  return {
    model: original.model,
    provider: jsonCopy(original.provider),
    state,
    questions: {
      command_policy: {
        type: "choice",
        instructions: JEV_COMMAND_ACTION_INSTRUCTION,
        criteria: jsonCopy(JEV_COMMAND_ACTION_CRITERIA),
      },
    },
  };
}
function normalized(values: number[]): boolean {
  const contract = JEV_RESPONSE_VALIDATION_CONTRACT;
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) <= contract.exactSumTolerance) return true;
  const scale = 10 ** contract.roundedDecimals;
  const cents = values.map((value) => Math.round(value * scale));
  if (
    values.some(
      (value, index) => Math.abs(value - cents[index] / scale) > contract.centLatticeTolerance,
    )
  )
    return false;
  const lower = cents.reduce((total, value) => total + Math.max(0, 2 * value - 1), 0);
  const upper = cents.reduce((total, value) => total + Math.min(2 * scale, 2 * value + 1), 0);
  return lower <= 2 * scale && 2 * scale <= upper;
}
function validAnswer(answer: unknown, choices: readonly string[]): boolean {
  if (
    !keys(answer, ["choice", "probabilities", "confidence"]) ||
    !choices.includes(answer.choice as string) ||
    !keys(answer.probabilities, choices)
  )
    return false;
  const values = choices.map((key) => answer.probabilities[key]);
  return (
    [...values, answer.confidence].every(
      (value) => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1,
    ) &&
    normalized(values as number[]) &&
    (answer.probabilities[answer.choice as string] as number) >= Math.max(...(values as number[]))
  );
}
function validateStage(
  stage: string,
  reply: unknown,
  request: { hash: string; bytes: number; request: { questions: unknown } },
  transportHash?: string,
) {
  if (
    !keys(reply, ["stage", "answers", "evidence"]) ||
    reply.stage !== stage ||
    !keys(reply.answers, Object.keys(request.request.questions))
  )
    throw new JevClientError("invalid_response");
  const evidence = reply.evidence;
  if (
    !keys(evidence, [
      "requestedQuestionIds",
      "requestHash",
      "responseHash",
      "transportHash",
      "requestBytes",
      "responseBytes",
      "model",
      "provider",
      "requestId",
      "usage",
      "latencyMs",
    ]) ||
    !isDeepStrictEqual(evidence.requestedQuestionIds, Object.keys(request.request.questions)) ||
    evidence.requestHash !== request.hash ||
    evidence.requestBytes !== request.bytes ||
    ![evidence.responseHash, evidence.transportHash].every(
      (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value),
    ) ||
    (transportHash !== undefined && evidence.transportHash !== transportHash) ||
    evidence.model !== JEV_RESOLVED_MODEL ||
    evidence.provider !== JEV_PROVIDER ||
    typeof evidence.requestId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(evidence.requestId) ||
    !Number.isSafeInteger(evidence.responseBytes) ||
    (evidence.responseBytes as number) < 1 ||
    (evidence.responseBytes as number) > 65_536 ||
    typeof evidence.latencyMs !== "number" ||
    !Number.isFinite(evidence.latencyMs) ||
    evidence.latencyMs < 0 ||
    !object(evidence.usage) ||
    Object.keys(evidence.usage).some(
      (key) => !["input_tokens", "output_tokens", "cost"].includes(key),
    ) ||
    ![evidence.usage.input_tokens, evidence.usage.output_tokens].every(
      (value) => Number.isSafeInteger(value) && (value as number) >= 0,
    ) ||
    (Object.hasOwn(evidence.usage, "cost") &&
      (typeof evidence.usage.cost !== "number" ||
        !Number.isFinite(evidence.usage.cost) ||
        evidence.usage.cost < 0)) ||
    !Object.values(reply.answers).every((answer) =>
      validAnswer(answer, stage === "syntax" ? BINARY : ACTIONS),
    )
  )
    throw new JevClientError("invalid_response");
}
export function buildJevGroupedCommandRequest(
  prepared: ReturnType<typeof prepareJevCommandProcess>,
  first: JevNonCommandStageResult,
  binary?: JevSyntaxStageResult,
) {
  if (!isDeepStrictEqual(prepared, prepareJevCommandProcess(prepared.original.request))) fail();
  validateStage("non_command", first, prepared.nonCommand);
  if (prepared.syntax)
    validateStage("syntax", binary, prepared.syntax, first.evidence.transportHash);
  else if (binary !== undefined) fail();
  const posted = body(
    groupedBody(prepared.original.request, prepared.manifest, binary?.answers ?? {}),
  );
  const rowBindings = prepared.manifest.map((row, index) => ({
    isolatedRowId: jevCommandRowId(index, "u"),
    syntaxRowId: row.rowId,
    syntaxQuestionId: row.questionId,
    group: row.group,
    order: row.ordinal,
    behavior: row.behavior,
    originalRowHash: row.originalRowHash,
  }));
  return freeze({
    ...posted,
    descriptor: {
      originalHash: prepared.original.hash,
      firstRequestHash: first.evidence.requestHash,
      firstResponseHash: first.evidence.responseHash,
      syntaxRequestHash: binary?.evidence.requestHash,
      syntaxResponseHash: binary?.evidence.responseHash,
      syntaxRequested: prepared.syntaxPlan.requested,
      manifestHash: prepared.manifestHash,
      rowBindings,
      rowBindingsHash: hash(JSON.stringify(rowBindings)),
      groupedStateHash: hash(JSON.stringify(posted.request.state)),
    },
  });
}

function validFailedResponseBinding(evidence: JevStageFailureEvidence): boolean {
  const digest = (value: unknown) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const size = (value: unknown) =>
    Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= 65_536;
  const full = Object.hasOwn(evidence, "responseHash") || Object.hasOwn(evidence, "responseBytes");
  const prefix =
    Object.hasOwn(evidence, "responsePrefixHash") || Object.hasOwn(evidence, "responsePrefixBytes");
  if (evidence.responseComplete === true)
    return (
      full &&
      !prefix &&
      digest(evidence.responseHash) &&
      Number.isSafeInteger(evidence.responseBytes) &&
      evidence.responseBytes >= 0 &&
      evidence.responseBytes <= 65_536
    );
  if (evidence.responseComplete === false)
    return (
      !full && prefix && digest(evidence.responsePrefixHash) && size(evidence.responsePrefixBytes)
    );
  return evidence.responseComplete === undefined && !full && !prefix;
}

/** This is a release gate. It is not a model reply or a joint probability. */
export function jevCommandProcessGate(
  contextComplete: boolean,
  answers: Partial<Record<JevQuestionId, JevChoiceAnswer>>,
  binary: Record<JevSyntaxQuestionId, JevSyntaxChoiceAnswer>,
  completed: boolean,
  emptyManifest = false,
): "allow" | "confirm" | "block" {
  if (Object.values(answers).some((answer) => answer.choice === "block")) return "block";
  if (!completed) return "block";
  return contextComplete &&
    Object.hasOwn(answers, "risk") &&
    Object.hasOwn(answers, "command_policy") &&
    Object.values(answers).every(
      (answer) => answer.choice === "allow" && answer.probabilities.allow >= 0.99,
    ) &&
    (emptyManifest ? Object.values(binary).length === 0 : Object.values(binary).length > 0) &&
    Object.values(binary).every((answer) => answer.probabilities[answer.choice] >= 0.99)
    ? "allow"
    : "confirm";
}

/** All construction, calls, and validation share the caller's absolute deadline.
 * Include synchronous cleanup work. Do not wait for asynchronous cancellation completion.
 */
export async function runJevCommandProcess(
  request: JevRequest,
  options: {
    deadline: number;
    signal?: AbortSignal;
    createTransport: (options: { deadline: number; signal?: AbortSignal }) => JevProcessTransport;
  },
) {
  const started = performance.now();
  const deadline = options.deadline;
  const answers: Partial<Record<JevQuestionId, JevChoiceAnswer>> = {};
  const origins: Partial<
    Record<
      JevQuestionId,
      JevStageEvidence<string> & {
        stage: "non_command" | "command_policy";
        questionId: JevQuestionId;
      }
    >
  > = {};
  const stages: Array<
    JevNonCommandStageResult | JevSyntaxStageResult | JevCommandPolicyStageResult
  > = [];
  const syntaxTranscript: Array<{
    rowId: JevSyntaxQuestionId;
    group: (typeof GROUPS)[number];
    order: number;
    behavior: string;
    originalRowHash: string;
    answer: JevSyntaxChoiceAnswer;
    origin: JevStageEvidence<JevSyntaxQuestionId> & { questionId: JevSyntaxQuestionId };
  }> = [];
  let prepared: ReturnType<typeof prepareJevCommandProcess>;
  let transport: JevProcessTransport;
  let activeStage: "prepare" | "non_command" | "syntax" | "command_policy" = "prepare";
  let failure: string;
  let failureEvidence: JevStageFailureEvidence;
  const attempts: Array<{
    stage: "non_command" | "syntax" | "command_policy";
    requestedQuestionIds: string[];
    requestHash: string;
    requestBytes: number;
  }> = [];
  let completed = false;
  let cleanupFailed = false;
  const closeTransport = () => {
    try {
      transport?.close();
    } catch {
      cleanupFailed = true;
    }
  };
  let interruption: JevClientError;
  let rejectInterrupt: (error: JevClientError) => void;
  let timer: ReturnType<typeof setTimeout>;
  const interrupted = new Promise<never>((_resolve, reject) => {
    rejectInterrupt = reject;
  });
  // A rejection can precede the first awaited call. Keep it observed during construction.
  void interrupted.catch(() => {});
  const stop = (code: "timeout" | "cancelled") => {
    interruption ??= new JevClientError(code);
    rejectInterrupt(interruption);
    closeTransport();
  };
  const onAbort = () => stop("cancelled");
  const guard = () => {
    if (interruption) throw interruption;
    if (options.signal?.aborted) throw new JevClientError("cancelled");
    if (performance.now() >= deadline) throw new JevClientError("timeout");
  };
  try {
    if (!Number.isFinite(deadline) || deadline > started + JEV_COMMAND_PROCESS_TIMEOUT_MS) fail();
    guard();
    timer = setTimeout(() => stop("timeout"), Math.max(0, deadline - performance.now()));
    timer.unref?.();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    prepared = prepareJevCommandProcess(request);
    guard();
    transport = options.createTransport({ deadline, signal: options.signal });
    guard();
    activeStage = "non_command";
    attempts.push({
      stage: activeStage,
      requestedQuestionIds: Object.keys(prepared.nonCommand.request.questions),
      requestHash: prepared.nonCommand.hash,
      requestBytes: prepared.nonCommand.bytes,
    });
    const first = replyCopy(
      await Promise.race([transport.requestNonCommand(prepared.nonCommand.request), interrupted]),
    );
    validateStage(activeStage, first, prepared.nonCommand);
    stages.push(freeze(first));
    for (const [key, answer] of Object.entries(first.answers)) {
      answers[key] = answer;
      origins[key] = freeze({ ...first.evidence, stage: "non_command", questionId: key });
    }
    guard();
    let binary: JevSyntaxStageResult;
    if (prepared.syntax) {
      activeStage = "syntax";
      attempts.push({
        stage: activeStage,
        requestedQuestionIds: Object.keys(prepared.syntax.request.questions),
        requestHash: prepared.syntax.hash,
        requestBytes: prepared.syntax.bytes,
      });
      binary = replyCopy(
        await Promise.race([transport.requestSyntax(prepared.syntax.request), interrupted]),
      );
      validateStage(activeStage, binary, prepared.syntax, first.evidence.transportHash);
      stages.push(freeze(binary));
      for (const row of prepared.manifest)
        syntaxTranscript.push(
          freeze({
            rowId: row.rowId,
            group: row.group,
            order: row.ordinal,
            behavior: row.behavior,
            originalRowHash: row.originalRowHash,
            answer: binary.answers[row.questionId],
            origin: { ...binary.evidence, questionId: row.questionId },
          }),
        );
    }
    guard();
    activeStage = "command_policy";
    const posted = buildJevGroupedCommandRequest(prepared, first, binary);
    guard();
    attempts.push({
      stage: activeStage,
      requestedQuestionIds: Object.keys(posted.request.questions),
      requestHash: posted.hash,
      requestBytes: posted.bytes,
    });
    const action = replyCopy(
      await Promise.race([transport.requestCommandPolicy(posted.request), interrupted]),
    );
    validateStage(activeStage, action, posted, first.evidence.transportHash);
    stages.push(freeze(action));
    answers.command_policy = action.answers.command_policy;
    origins.command_policy = freeze({
      ...action.evidence,
      stage: "command_policy",
      questionId: "command_policy",
    });
    guard();
    completed = true;
  } catch (error) {
    failure = error instanceof JevClientError ? error.code : "transport_error";
    if (error instanceof JevStageClientError) {
      try {
        const evidence = jsonCopy(error.evidence);
        const attempt = attempts.at(-1);
        if (
          !attempt ||
          evidence.stage !== attempt.stage ||
          evidence.failure !== failure ||
          !(
            (evidence.requestHash === undefined &&
              evidence.requestBytes === undefined &&
              isDeepStrictEqual(evidence.requestedQuestionIds, []) &&
              evidence.requestSent === false) ||
            (isDeepStrictEqual(evidence.requestedQuestionIds, attempt.requestedQuestionIds) &&
              evidence.requestHash === attempt.requestHash &&
              evidence.requestBytes === attempt.requestBytes)
          ) ||
          Object.keys(evidence).some(
            (key) =>
              ![
                "stage",
                "requestedQuestionIds",
                "requestHash",
                "requestBytes",
                "transportHash",
                "latencyMs",
                "requestSent",
                "failure",
                "responseComplete",
                "responseHash",
                "responseBytes",
                "responsePrefixHash",
                "responsePrefixBytes",
              ].includes(key),
          ) ||
          typeof evidence.requestSent !== "boolean" ||
          (!evidence.requestSent &&
            [
              "responseComplete",
              "responseHash",
              "responseBytes",
              "responsePrefixHash",
              "responsePrefixBytes",
            ].some((key) => Object.hasOwn(evidence, key))) ||
          typeof evidence.latencyMs !== "number" ||
          !Number.isFinite(evidence.latencyMs) ||
          evidence.latencyMs < 0 ||
          !validFailedResponseBinding(evidence) ||
          typeof evidence.transportHash !== "string" ||
          !/^[a-f0-9]{64}$/.test(evidence.transportHash) ||
          (stages.length && evidence.transportHash !== stages[0].evidence.transportHash)
        )
          throw new JevClientError("invalid_response");
        failureEvidence = freeze(evidence);
      } catch {
        failure = "invalid_response";
      }
    }
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    closeTransport();
  }
  try {
    guard();
  } catch (error) {
    completed = false;
    failure ??= error instanceof JevClientError ? error.code : "transport_error";
  }
  if (cleanupFailed) {
    completed = false;
    failure ??= "transport_error";
  }
  const binaryAnswers = Object.fromEntries(syntaxTranscript.map((row) => [row.rowId, row.answer]));
  const gate = jevCommandProcessGate(
    prepared?.contextComplete ?? false,
    answers,
    binaryAnswers,
    completed,
    prepared?.manifest.length === 0,
  );
  return freeze({
    completed,
    gate,
    cleanupFailed,
    failure: failure ? { stage: activeStage, code: failure } : undefined,
    answers,
    origins,
    stages,
    attempts,
    failureEvidence,
    syntaxPlan: prepared?.syntaxPlan,
    syntaxTranscript,
    actualBlocks: Object.entries(answers)
      .filter(([, answer]) => answer.choice === "block")
      .map(([questionId, answer]) => ({ questionId, answer, origin: origins[questionId] })),
    contextComplete: prepared?.contextComplete ?? false,
    originalRequestHash: prepared?.original.hash,
    manifestHash: prepared?.manifestHash,
    tokenContextHash: prepared?.tokenContextHash,
    deadline,
    latencyMs: performance.now() - started,
    distributionsCombined: false as const,
    representsOneProviderReply: false as const,
  });
}
