/* SPDX-License-Identifier: Apache-2.0 */
/** Send one bounded request. Keep errors free of remote text and keys. */
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type {
  JevAction,
  JevAllHeadRequest,
  JevAllHeadStageResult,
  JevClientFailureCode,
  JevStageFailureEvidence,
  JevChoiceAnswer,
  JevPrediction,
  JevQuestionId,
  JevRequest,
  JevCommandPolicyRequest,
  JevCommandPolicyStageResult,
  JevNonCommandRequest,
  JevNonCommandStageResult,
  JevDecisionTransport,
  JevFileMatchChoice,
  JevFileMatchChoiceAnswer,
  JevFileMatchFailureEvidence,
  JevFileMatchProcessTransportBinding,
  JevFileMatchRequest,
  JevFileMatchStageResult,
  JevFileMatchTransport,
  JevFileMatchTransportBinding,
  JevSyntaxChoice,
  JevSyntaxChoiceAnswer,
  JevSyntaxRequest,
  JevSyntaxStageResult,
} from "./types.ts";
import { jevHash } from "./jev-identity.ts";

export const JEV_MODEL = "typesafe/jev-1.13";
export const JEV_RESOLVED_MODEL = "typesafe/jev-1.13-20260917";
export const JEV_PROVIDER = "TypeSafe";
export const JEV_TIMEOUT_MS = 1_500;
/** One total limit for the experimental decision adapter and command process. */
export const JEV_COMMAND_PROCESS_TIMEOUT_MS = 10_000;
export const JEV_RESPONSE_VALIDATION_CONTRACT = Object.freeze({
  version: 2,
  exactSumTolerance: 1e-6,
  roundedDecimals: 2,
  centLatticeTolerance: 1e-12,
  roundingIntervals: "clipped-closed-nearest-cent",
  preserveWireProbabilities: true,
} as const);

/** Match the current local approval binding. Keep the endpoint text local. */
export const JEV_TRANSPORT_BINDING_CONTRACT = Object.freeze({
  version: 1,
  endpoint: "explicit-normalized-https-without-credentials-query-or-fragment",
  defaultEndpoint: false,
  requestedModel: JEV_MODEL,
  resolvedModel: JEV_RESOLVED_MODEL,
  provider: JEV_PROVIDER,
  routing: Object.freeze({ only: Object.freeze(["typesafe"]), allow_fallbacks: false }),
} as const);

const MAX_KEY_BYTES = 4_096;
const MAX_ENDPOINT_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 65_536;
const MAX_REQUEST_BYTES = 131_072;
const ACTIONS: JevAction[] = ["allow", "confirm", "block"];
const QUESTIONS: JevQuestionId[] = [
  "risk",
  "file_policy",
  "command_policy",
  "org_policy",
  "disclosure",
  "authority",
];

export class JevClientError extends Error {
  readonly code: JevClientFailureCode;

  constructor(code: JevClientError["code"]) {
    super(`Jev request failed: ${code}.`);
    this.name = "JevClientError";
    this.code = code;
  }
}

/** Retain bounded hashes and failure facts. Keep remote text out of errors. */
export class JevStageClientError extends JevClientError {
  readonly evidence: JevStageFailureEvidence;
  readonly observedResult?:
    | JevNonCommandStageResult
    | JevSyntaxStageResult
    | JevCommandPolicyStageResult
    | JevAllHeadStageResult;

  constructor(
    code: JevClientFailureCode,
    evidence: JevStageFailureEvidence,
    observedResult?: DecisionStageResult,
  ) {
    super(code);
    this.name = "JevStageClientError";
    this.evidence = evidence;
    if (observedResult) {
      Object.defineProperty(this, "observedResult", {
        value: observedResult,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
  }
}

/** Keep the private matching receipt separate from normal action errors. */
export class JevFileMatchClientError extends JevClientError {
  readonly evidence: JevFileMatchFailureEvidence;
  readonly observedResult?: JevFileMatchStageResult;

  constructor(
    code: JevClientFailureCode,
    evidence: JevFileMatchFailureEvidence,
    observedResult?: JevFileMatchStageResult,
  ) {
    super(code);
    this.name = "JevFileMatchClientError";
    this.evidence = evidence;
    if (observedResult) {
      Object.defineProperty(this, "observedResult", {
        value: observedResult,
        enumerable: true,
        writable: false,
        configurable: false,
      });
    }
  }
}

function validateEndpoint(value: unknown): string {
  if (value === undefined) throw new JevClientError("missing_endpoint");
  if (typeof value !== "string") throw new JevClientError("invalid_endpoint");
  if (Buffer.byteLength(value) > MAX_ENDPOINT_BYTES) throw new JevClientError("invalid_endpoint");
  const input = value.trim();
  if (input === "") throw new JevClientError("missing_endpoint");
  if (/[\\\s]/.test(input)) throw new JevClientError("invalid_endpoint");
  try {
    const authority = /^https:\/\/([^/?#]+)/i.exec(input)?.[1];
    const endpoint = new URL(input);
    if (
      !authority ||
      authority.includes("@") ||
      endpoint.protocol !== "https:" ||
      endpoint.username ||
      endpoint.password ||
      input.includes("?") ||
      input.includes("#")
    ) {
      throw new Error();
    }
    return endpoint.href;
  } catch {
    throw new JevClientError("invalid_endpoint");
  }
}

/** Read and check the endpoint before a key is read or a request is sent. */
export function resolveJevEndpoint(value = process.env.SF_GUARDRAIL_JEV_ENDPOINT): string {
  return validateEndpoint(value);
}

/** Check local endpoint settings. Do not return the URL. */
export function jevEndpointStatus(): "ready" | "missing" | "invalid" {
  try {
    resolveJevEndpoint();
    return "ready";
  } catch (error) {
    return error instanceof JevClientError && error.code === "missing_endpoint"
      ? "missing"
      : "invalid";
  }
}

function credential(): { key: string; source: "environment" | "file" } {
  const environmentKey = process.env.SF_GUARDRAIL_JEV_API_KEY;
  if (environmentKey !== undefined && environmentKey !== "") {
    return { key: validateKey(environmentKey), source: "environment" };
  }
  const path = process.env.SF_GUARDRAIL_JEV_API_KEY_FILE;
  if (!path) throw new JevClientError("missing_credentials");
  let descriptor: number | undefined;
  try {
    // NONBLOCK prevents a supplied FIFO/device from hanging before fstat rejects it.
    descriptor = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK);
    const stat = fstatSync(descriptor);
    if (!stat.isFile() || stat.size > MAX_KEY_BYTES) {
      throw new JevClientError("invalid_credentials");
    }
    const buffer = Buffer.alloc(MAX_KEY_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_KEY_BYTES) throw new JevClientError("invalid_credentials");
    return { key: validateKey(buffer.subarray(0, length).toString("utf8")), source: "file" };
  } catch {
    throw new JevClientError("invalid_credentials");
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Cleanup errors must not replace the sanitized credential result/failure.
      }
    }
  }
}

function validateKey(value: string): string {
  const key = value.trim();
  if (!key || key.length > MAX_KEY_BYTES || !/^[!-~]+$/.test(key)) {
    throw new JevClientError("invalid_credentials");
  }
  return key;
}

/** Local readiness only: no startup probe, credential value, or path is returned. */
export function jevCredentialStatus(): string {
  try {
    return `ready (${credential().source})`;
  } catch (error) {
    return error instanceof JevClientError && error.code === "missing_credentials"
      ? "missing"
      : "invalid";
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function probability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function tokenCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function normalizedChoiceProbabilities(probabilities: Record<JevAction, number>): boolean {
  return normalizedProbabilities(ACTIONS.map((action) => probabilities[action]));
}

function normalizedProbabilities(values: number[]): boolean {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) <= JEV_RESPONSE_VALIDATION_CONTRACT.exactSumTolerance) return true;

  // A reply can round probabilities to two decimals.
  // Check clipped, closed half-cent intervals in integer units. Keep each wire value.
  const scale = 10 ** JEV_RESPONSE_VALIDATION_CONTRACT.roundedDecimals;
  const cents = values.map((value) => Math.round(value * scale));
  if (
    values.some(
      (value, index) =>
        Math.abs(value - cents[index] / scale) >
        JEV_RESPONSE_VALIDATION_CONTRACT.centLatticeTolerance,
    )
  ) {
    return false;
  }
  const normalized = 2 * scale;
  const lower = cents.reduce((total, value) => total + Math.max(0, 2 * value - 1), 0);
  const upper = cents.reduce((total, value) => total + Math.min(normalized, 2 * value + 1), 0);
  return lower <= normalized && normalized <= upper;
}

function validateRequest(request: JevRequest): JevQuestionId[] {
  // Structured instructions/criteria must be JSON data. Reject serializers, getters,
  // non-finite values, and cycles instead of silently changing their wire meaning.
  let nodes = 0;
  const active = new Set<object>();
  function json(value: unknown, depth: number): void {
    if (++nodes > 4_096 || depth > 32) throw new JevClientError("invalid_request");
    if (value === null || typeof value === "string" || typeof value === "boolean") return;
    if (typeof value === "number" && Number.isFinite(value)) return;
    if (typeof value !== "object" || !value || active.has(value))
      throw new JevClientError("invalid_request");
    if (
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) !== Object.prototype &&
      Object.getPrototypeOf(value) !== null
    ) {
      throw new JevClientError("invalid_request");
    }
    active.add(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (Array.isArray(value) && Object.keys(descriptors).length !== value.length + 1) {
      throw new JevClientError("invalid_request");
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new JevClientError("invalid_request");
      }
    }
    for (const name of Reflect.ownKeys(descriptors)) {
      if (Array.isArray(value) && name === "length") continue;
      if (typeof name !== "string") throw new JevClientError("invalid_request");
      const descriptor = descriptors[name];
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new JevClientError("invalid_request");
      json(descriptor.value, depth + 1);
    }
    active.delete(value);
  }
  if (!record(request) || request.model !== JEV_MODEL || !record(request.questions)) {
    throw new JevClientError("invalid_request");
  }
  json(request.questions, 0);
  const ids = Object.keys(request.questions);
  if (
    !ids.includes("risk") ||
    ids.length > QUESTIONS.length ||
    !ids.every((id) => QUESTIONS.includes(id as JevQuestionId))
  ) {
    throw new JevClientError("invalid_request");
  }
  for (const id of ids) {
    const question = request.questions[id];
    if (
      !record(question) ||
      question.type !== "choice" ||
      !Object.hasOwn(question, "instructions") ||
      !record(question.criteria) ||
      Object.keys(question.criteria).length !== ACTIONS.length ||
      !ACTIONS.every((action) =>
        Object.hasOwn(question.criteria as Record<string, unknown>, action),
      )
    ) {
      throw new JevClientError("invalid_request");
    }
  }
  if (Object.hasOwn(request, "provider")) {
    const provider = request.provider;
    json(provider, 0);
    if (
      !record(provider) ||
      Object.keys(provider).length !== 2 ||
      !Array.isArray(provider.only) ||
      provider.only.length !== 1 ||
      provider.only[0] !== "typesafe" ||
      provider.allow_fallbacks !== false
    ) {
      throw new JevClientError("invalid_request");
    }
  }
  return ids as JevQuestionId[];
}

function rejectDuplicateKeys(text: string): void {
  // JSON.parse has already validated syntax. Track decoded keys without recursive parsing;
  // otherwise a second model/probability key could silently overwrite the first.
  const containers: Array<Set<string> | null> = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g)) {
    const token = match[0];
    if (token === "{") containers.push(new Set());
    else if (token === "[") containers.push(null);
    else if (token === "}" || token === "]") containers.pop();
    else {
      let next = match.index + token.length;
      while (/\s/.test(text[next] ?? "")) next += 1;
      if (text[next] !== ":") continue;
      const keys = containers.at(-1);
      const key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new JevClientError("invalid_response");
      keys.add(key);
    }
  }
}

function choiceAnswer(answer: unknown): JevChoiceAnswer {
  if (
    !record(answer) ||
    answer.type !== "choice" ||
    !ACTIONS.includes(answer.choice as JevAction) ||
    !record(answer.probabilities) ||
    Object.keys(answer.probabilities).length !== ACTIONS.length ||
    !ACTIONS.every((action) => probability(answer.probabilities[action])) ||
    !probability(answer.confidence)
  ) {
    throw new JevClientError("invalid_response");
  }
  const probabilities = answer.probabilities as Record<JevAction, number>;
  const choice = answer.choice as JevAction;
  if (
    !normalizedChoiceProbabilities(probabilities) ||
    probabilities[choice] < Math.max(...ACTIONS.map((action) => probabilities[action]))
  ) {
    throw new JevClientError("invalid_response");
  }
  return {
    choice,
    probabilities: {
      allow: probabilities.allow,
      confirm: probabilities.confirm,
      block: probabilities.block,
    },
    confidence: answer.confidence,
  };
}

function prediction(value: unknown, key: string, questionIds: JevQuestionId[]): JevPrediction {
  if (!record(value)) throw new JevClientError("invalid_response");
  if (value.model !== JEV_RESOLVED_MODEL || value.provider !== JEV_PROVIDER) {
    throw new JevClientError("identity_mismatch");
  }
  if (
    typeof value.id !== "string" ||
    value.id.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.id) ||
    value.id.includes(key) ||
    !record(value.answers) ||
    Object.keys(value.answers).length !== questionIds.length ||
    !questionIds.every((id) => Object.hasOwn(value.answers as Record<string, unknown>, id)) ||
    !record(value.usage)
  ) {
    throw new JevClientError("invalid_response");
  }
  const answers: Partial<Record<JevQuestionId, JevChoiceAnswer>> = {};
  for (const id of questionIds) answers[id] = choiceAnswer(value.answers[id]);
  const risk = answers.risk;
  if (
    !tokenCount(value.usage.input_tokens) ||
    !tokenCount(value.usage.output_tokens) ||
    (value.usage.cost !== undefined &&
      (typeof value.usage.cost !== "number" ||
        !Number.isFinite(value.usage.cost) ||
        value.usage.cost < 0))
  ) {
    throw new JevClientError("invalid_response");
  }
  return {
    ...risk,
    ...(questionIds.length > 1 ? { answers } : {}),
    model: JEV_RESOLVED_MODEL,
    provider: JEV_PROVIDER,
    requestId: value.id,
    usage: {
      input_tokens: value.usage.input_tokens,
      output_tokens: value.usage.output_tokens,
      ...(value.usage.cost !== undefined ? { cost: value.usage.cost as number } : {}),
    },
  };
}

export async function requestJev(
  request: JevRequest,
  options: { signal?: AbortSignal; fetch?: typeof fetch; endpoint?: string } = {},
): Promise<JevPrediction> {
  const started = performance.now();
  if (options.signal?.aborted) throw new JevClientError("cancelled");
  const configuredEndpoint = options.endpoint;
  const endpoint =
    configuredEndpoint === undefined ? resolveJevEndpoint() : validateEndpoint(configuredEndpoint);
  const controller = new AbortController();
  let abortCode: "cancelled" | "timeout" = "cancelled";
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let responseBody: ReadableStream<Uint8Array> | null;
  const callerAbort = () => {
    abortCode = "cancelled";
    controller.abort();
  };
  options.signal?.addEventListener("abort", callerAbort, { once: true });
  let abortListener: () => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    abortListener = () => reject(new JevClientError(abortCode));
    controller.signal.addEventListener("abort", abortListener, { once: true });
  });
  const timer = setTimeout(() => {
    abortCode = "timeout";
    controller.abort();
  }, JEV_TIMEOUT_MS);
  try {
    const operation = async (): Promise<JevPrediction> => {
      const { key } = credential();
      const questionIds = validateRequest(request);
      let body: string;
      try {
        body = JSON.stringify(request);
        if (Buffer.byteLength(body) > MAX_REQUEST_BYTES || body.includes(key)) throw new Error();
      } catch {
        throw new JevClientError("invalid_request");
      }
      const response = await (options.fetch ?? globalThis.fetch)(endpoint, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body,
        signal: controller.signal,
        redirect: "error",
      });
      responseBody = response.body;
      if (controller.signal.aborted) {
        if (responseBody) void responseBody.cancel().catch(() => {});
        throw new JevClientError(abortCode);
      }
      if (!response.ok) throw new JevClientError("http_error");
      if (!response.body) throw new JevClientError("invalid_response");
      const declaredLength = response.headers.get("content-length");
      if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES) {
        throw new JevClientError("response_too_large");
      }
      reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (!(chunk.value instanceof Uint8Array)) throw new JevClientError("invalid_response");
        length += chunk.value.byteLength;
        if (length > MAX_RESPONSE_BYTES) throw new JevClientError("response_too_large");
        chunks.push(chunk.value);
      }
      let parsed: unknown;
      try {
        const content = Buffer.concat(chunks, length);
        const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
        parsed = JSON.parse(text);
        rejectDuplicateKeys(text);
      } catch {
        throw new JevClientError("invalid_response");
      }
      const result = prediction(parsed, key, questionIds);
      if (performance.now() - started >= JEV_TIMEOUT_MS) throw new JevClientError("timeout");
      if (controller.signal.aborted) throw new JevClientError(abortCode);
      return result;
    };
    return await Promise.race([operation(), aborted]);
  } catch (error) {
    if (controller.signal.aborted) throw new JevClientError(abortCode);
    if (error instanceof JevClientError) throw error;
    throw new JevClientError("transport_error");
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", callerAbort);
    controller.signal.removeEventListener("abort", abortListener);
    controller.abort();
    // A custom fetch/stream can ignore AbortSignal; cancellation must not hold the deadline open.
    if (reader) void reader.cancel().catch(() => {});
    else if (responseBody) void responseBody.cancel().catch(() => {});
  }
}

export const JEV_STAGE_REQUEST_BYTES = 32_768;
export const JEV_SYNTAX_QUESTION_LIMIT = 64;
const SYNTAX_CHOICES: JevSyntaxChoice[] = ["match", "no_match"];
const FILE_MATCH_CHOICES: JevFileMatchChoice[] = ["match", "no_match", "unknown"];
/** Frozen private matching contract. It declares no policy action or release. */
export const JEV_FILE_MATCH_PROTOCOL = Object.freeze({
  version: 1,
  stage: "file_match",
  answerChoices: Object.freeze(["match", "no_match", "unknown"]),
  questionIds: Object.freeze(["f_a", "f_b", "f_c", "f_d", "f_e", "f_f", "f_g", "f_h"]),
  questionLimit: 8,
  expectedQuestionCount: "2 * state.facts.files.length * state.policy.files.length",
  questionOrder: "record-major,row-major,patterns,allowedPatterns",
  ordinalOrigin: 0,
  listOrder: Object.freeze(["patterns", "allowedPatterns"]),
  requestKeys: Object.freeze(["model", "provider", "state", "questions"]),
  instructionKeys: Object.freeze([
    "question",
    "recordOrdinal",
    "rowOrdinal",
    "listName",
    "record",
    "row",
    "boundary",
    "matchingGrammar",
    "scope",
    "empty",
  ]),
  fullOriginalState: true,
  fullOperandCopies: true,
  maxRequestBytes: JEV_STAGE_REQUEST_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
  totalTimeoutMs: JEV_COMMAND_PROCESS_TIMEOUT_MS,
  deadline: "one-caller-absolute-includes-preparation-reads-validation-synchronous-cleanup",
  redirect: "error",
  responseRedirected: false,
  retries: 0,
  fallbacks: false,
  exactResponseQuestionOrder: true,
  selectedChoice: "raw-argmax-with-ties-admitted",
  rawProbabilitiesAndConfidence: true,
  probabilityValidation: JEV_RESPONSE_VALIDATION_CONTRACT,
  transportIdentity: JEV_TRANSPORT_BINDING_CONTRACT,
  bindingFields: Object.freeze(["protocolHash", "diagnosticHash"]),
  policyAction: false,
} as const);
/** Bind the same strict matching stage to the caller's decision process. */
export const JEV_FILE_MATCH_PROCESS_PROTOCOL = Object.freeze({
  ...JEV_FILE_MATCH_PROTOCOL,
  bindingFields: Object.freeze(["protocolHash", "operatingPointHash"]),
  transportBinding: "ordinary-decision-process-binding",
  operatingPoint: "caller-validated-point-bound-by-protocol-and-operating-point-hashes",
} as const);
type Stage = "non_command" | "syntax" | "command_policy" | "all_heads" | "file_match";
type StageRequest =
  | JevNonCommandRequest
  | JevSyntaxRequest
  | JevCommandPolicyRequest
  | JevAllHeadRequest
  | JevFileMatchRequest;
type DecisionStageResult =
  | JevNonCommandStageResult
  | JevSyntaxStageResult
  | JevCommandPolicyStageResult
  | JevAllHeadStageResult;
type StageResult = DecisionStageResult | JevFileMatchStageResult;

function exactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** Check descriptors first. Do not invoke user serializers or accessors. */
function stageJson(value: unknown): unknown {
  let nodes = 0;
  const active = new Set<object>();
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 16_384 || depth > 32) throw new JevClientError("invalid_request");
    if (item === null || typeof item === "string" || typeof item === "boolean") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || !item || active.has(item))
      throw new JevClientError("invalid_request");
    const array = Array.isArray(item);
    if (
      !array &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    ) {
      throw new JevClientError("invalid_request");
    }
    const descriptors = Object.getOwnPropertyDescriptors(item);
    const length = array ? descriptors.length?.value : undefined;
    if (
      array &&
      (!Number.isSafeInteger(length) ||
        length < 0 ||
        Object.keys(descriptors).length !== length + 1)
    )
      throw new JevClientError("invalid_request");
    if (array) {
      for (let index = 0; index < length; index += 1) {
        if (!Object.hasOwn(descriptors, String(index))) throw new JevClientError("invalid_request");
      }
    }
    const result: unknown[] | Record<string, unknown> = array ? [] : Object.create(null);
    active.add(item);
    for (const name of Reflect.ownKeys(descriptors)) {
      if (array && name === "length") continue;
      if (typeof name !== "string") throw new JevClientError("invalid_request");
      const descriptor = descriptors[name];
      if (!descriptor.enumerable || !("value" in descriptor))
        throw new JevClientError("invalid_request");
      result[name] = visit(descriptor.value, depth + 1);
    }
    active.delete(item);
    return result;
  }
  return visit(value, 0);
}

function syntaxQuestionId(index: number): string {
  let suffix = "";
  for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
    suffix = String.fromCharCode(97 + ((value - 1) % 26)) + suffix;
  }
  return `r_${suffix}`;
}

function validFileMatchRequest(request: JevFileMatchRequest, ids: string[]): boolean {
  const state = request.state;
  if (
    !record(state) ||
    !record(state.facts) ||
    !record(state.policy) ||
    !Array.isArray(state.facts.files) ||
    !Array.isArray(state.policy.files)
  )
    return false;
  const records = state.facts.files;
  const rows = state.policy.files;
  const count = 2 * records.length * rows.length;
  if (
    count < 1 ||
    count > JEV_FILE_MATCH_PROTOCOL.questionLimit ||
    ids.length !== count ||
    ids.some((id, index) => id !== JEV_FILE_MATCH_PROTOCOL.questionIds[index])
  )
    return false;
  let index = 0;
  for (const [recordOrdinal, file] of records.entries()) {
    if (!record(file)) return false;
    for (const [rowOrdinal, row] of rows.entries()) {
      if (!record(row)) return false;
      for (const listName of JEV_FILE_MATCH_PROTOCOL.listOrder) {
        const question = request.questions[ids[index++]];
        const instructions = question?.instructions;
        if (
          !record(instructions) ||
          !exactKeys(instructions, [...JEV_FILE_MATCH_PROTOCOL.instructionKeys]) ||
          instructions.recordOrdinal !== recordOrdinal ||
          instructions.rowOrdinal !== rowOrdinal ||
          instructions.listName !== listName ||
          JSON.stringify(instructions.record) !== JSON.stringify(file) ||
          JSON.stringify(instructions.row) !== JSON.stringify(row) ||
          !["question", "boundary", "matchingGrammar", "scope", "empty"].every(
            (name) => typeof instructions[name] === "string" && instructions[name].length > 0,
          )
        )
          return false;
      }
    }
  }
  return true;
}

function stageRequest(stage: Stage, request: StageRequest): { ids: string[]; body: string } {
  request = stageJson(request) as StageRequest;
  if (
    !record(request) ||
    !exactKeys(request, ["model", "provider", "state", "questions"]) ||
    request.model !== JEV_MODEL ||
    !record(request.provider) ||
    !exactKeys(request.provider, ["only", "allow_fallbacks"]) ||
    !Array.isArray(request.provider.only) ||
    request.provider.only.length !== 1 ||
    request.provider.only[0] !== "typesafe" ||
    request.provider.allow_fallbacks !== false ||
    !record(request.questions)
  ) {
    throw new JevClientError("invalid_request");
  }
  const ids = Object.keys(request.questions);
  const validIds =
    stage === "file_match"
      ? validFileMatchRequest(request as JevFileMatchRequest, ids)
      : stage === "all_heads"
        ? ids.includes("risk") &&
          ids.length >= 1 &&
          ids.length <= QUESTIONS.length &&
          ids.every((id) => QUESTIONS.includes(id as JevQuestionId))
        : stage === "non_command"
          ? ids.includes("risk") &&
            ids.length <= QUESTIONS.length - 1 &&
            ids.every((id) => id !== "command_policy" && QUESTIONS.includes(id as JevQuestionId))
          : stage === "command_policy"
            ? ids.length === 1 && ids[0] === "command_policy"
            : ids.length >= 1 &&
              ids.length <= JEV_SYNTAX_QUESTION_LIMIT &&
              ids.every((id, index) => id === syntaxQuestionId(index));
  if (!validIds) throw new JevClientError("invalid_request");
  const choices =
    stage === "syntax" ? SYNTAX_CHOICES : stage === "file_match" ? FILE_MATCH_CHOICES : ACTIONS;
  for (const id of ids) {
    const question: unknown = request.questions[id];
    if (
      !record(question) ||
      !exactKeys(question, ["type", "instructions", "criteria"]) ||
      question.type !== "choice" ||
      !record(question.criteria) ||
      !exactKeys(question.criteria, choices)
    ) {
      throw new JevClientError("invalid_request");
    }
  }
  const body = JSON.stringify(request);
  if (Buffer.byteLength(body) > JEV_STAGE_REQUEST_BYTES)
    throw new JevClientError("invalid_request");
  return { ids, body };
}

function stageChoiceAnswer(answer: unknown): JevChoiceAnswer {
  if (!record(answer) || !exactKeys(answer, ["type", "choice", "probabilities", "confidence"]))
    throw new JevClientError("invalid_response");
  return choiceAnswer(answer);
}

function syntaxAnswer(answer: unknown): JevSyntaxChoiceAnswer {
  if (
    !record(answer) ||
    !exactKeys(answer, ["type", "choice", "probabilities", "confidence"]) ||
    answer.type !== "choice" ||
    !SYNTAX_CHOICES.includes(answer.choice as JevSyntaxChoice) ||
    !record(answer.probabilities) ||
    !exactKeys(answer.probabilities, SYNTAX_CHOICES) ||
    !SYNTAX_CHOICES.every((choice) => probability(answer.probabilities[choice])) ||
    !probability(answer.confidence)
  ) {
    throw new JevClientError("invalid_response");
  }
  const probabilities = answer.probabilities as Record<JevSyntaxChoice, number>;
  const choice = answer.choice as JevSyntaxChoice;
  if (
    !normalizedProbabilities(SYNTAX_CHOICES.map((option) => probabilities[option])) ||
    probabilities[choice] < Math.max(...SYNTAX_CHOICES.map((option) => probabilities[option]))
  ) {
    throw new JevClientError("invalid_response");
  }
  return {
    choice,
    probabilities: { match: probabilities.match, no_match: probabilities.no_match },
    confidence: answer.confidence,
  };
}

function fileMatchAnswer(answer: unknown): JevFileMatchChoiceAnswer {
  if (
    !record(answer) ||
    !exactKeys(answer, ["type", "choice", "probabilities", "confidence"]) ||
    answer.type !== "choice" ||
    !FILE_MATCH_CHOICES.includes(answer.choice as JevFileMatchChoice) ||
    !record(answer.probabilities) ||
    !exactKeys(answer.probabilities, FILE_MATCH_CHOICES) ||
    !FILE_MATCH_CHOICES.every((choice) => probability(answer.probabilities[choice])) ||
    !probability(answer.confidence)
  )
    throw new JevClientError("invalid_response");
  const probabilities = answer.probabilities as Record<JevFileMatchChoice, number>;
  const choice = answer.choice as JevFileMatchChoice;
  if (
    !normalizedProbabilities(FILE_MATCH_CHOICES.map((option) => probabilities[option])) ||
    probabilities[choice] < Math.max(...FILE_MATCH_CHOICES.map((option) => probabilities[option]))
  )
    throw new JevClientError("invalid_response");
  return {
    choice,
    probabilities: {
      match: probabilities.match,
      no_match: probabilities.no_match,
      unknown: probabilities.unknown,
    },
    confidence: answer.confidence,
  };
}

function stagePrediction(stage: Stage, value: unknown, key: string, ids: string[]) {
  if (!record(value)) throw new JevClientError("invalid_response");
  if (value.model !== JEV_RESOLVED_MODEL || value.provider !== JEV_PROVIDER)
    throw new JevClientError("identity_mismatch");
  if (
    typeof value.id !== "string" ||
    value.id.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.id) ||
    value.id.includes(key) ||
    !record(value.answers) ||
    !exactKeys(value.answers, ids) ||
    (stage === "file_match" && Object.keys(value.answers).some((id, index) => id !== ids[index])) ||
    !record(value.usage) ||
    !tokenCount(value.usage.input_tokens) ||
    !tokenCount(value.usage.output_tokens) ||
    (value.usage.cost !== undefined &&
      (typeof value.usage.cost !== "number" ||
        !Number.isFinite(value.usage.cost) ||
        value.usage.cost < 0))
  ) {
    throw new JevClientError("invalid_response");
  }
  const answers = Object.fromEntries(
    ids.map((id) => [
      id,
      stage === "syntax"
        ? syntaxAnswer(value.answers[id])
        : stage === "file_match"
          ? fileMatchAnswer(value.answers[id])
          : stageChoiceAnswer(value.answers[id]),
    ]),
  );
  return {
    answers,
    requestId: value.id,
    usage: {
      input_tokens: value.usage.input_tokens,
      output_tokens: value.usage.output_tokens,
      ...(value.usage.cost !== undefined ? { cost: value.usage.cost as number } : {}),
    },
  };
}

function stageHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Retain only the validated data. Later cleanup cannot change this copy. */
function immutableStageResult(result: StageResult): StageResult {
  const snapshot = stageJson(result) as StageResult;
  function freeze(value: unknown): void {
    if (value === null || typeof value !== "object") return;
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  freeze(snapshot);
  return snapshot;
}

function cancelStageBody(value: { cancel(): Promise<unknown> } | null | undefined): void {
  if (!value) return;
  try {
    void Promise.resolve(value.cancel()).catch(() => {});
  } catch {
    // Cleanup must not replace the bounded result or sanitized failure.
  }
}

/** Use one absolute performance.now() deadline for all stages, including waits.
 * Include response reads and synchronous cleanup work.
 * Start cancellation without awaiting its asynchronous completion.
 * The caller passes its existing deadline. The factory permits at most 10,000 ms.
 * The active experimental adapter uses this process transport.
 * This transport does not select a policy action or combine probabilities.
 */
type StageTransportOptions = {
  deadline: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  endpoint?: string;
  binding?: { protocolHash: string; operatingPointHash: string } | JevFileMatchTransportBinding;
};
function createJevStageTransport(
  options: StageTransportOptions,
  mode: "decision" | "file_match" | "file_match_process",
) {
  const created = performance.now();
  let deadline: number;
  let callerSignal: AbortSignal | undefined;
  let configuredEndpoint: string | undefined;
  let validatedBinding: Record<string, string> | undefined;
  let fetchCall: typeof globalThis.fetch;
  try {
    const configuredBinding = options.binding;
    if (mode !== "decision" && configuredBinding === undefined)
      throw new JevClientError("invalid_request");
    if (configuredBinding !== undefined) {
      const snapshot = stageJson(configuredBinding);
      const bindingField = mode === "file_match" ? "diagnosticHash" : "operatingPointHash";
      if (
        !record(snapshot) ||
        !exactKeys(snapshot, ["protocolHash", bindingField]) ||
        typeof snapshot.protocolHash !== "string" ||
        !/^[a-f0-9]{64}$/.test(snapshot.protocolHash) ||
        typeof snapshot[bindingField] !== "string" ||
        !/^[a-f0-9]{64}$/.test(snapshot[bindingField])
      )
        throw new JevClientError("invalid_request");
      validatedBinding = {
        protocolHash: snapshot.protocolHash,
        [bindingField]: snapshot[bindingField],
      };
    }
    deadline = options.deadline;
    callerSignal = options.signal;
    configuredEndpoint = options.endpoint;
    fetchCall = options.fetch ?? globalThis.fetch;
  } catch {
    throw new JevClientError("invalid_request");
  }
  if (
    (callerSignal !== undefined && !(callerSignal instanceof AbortSignal)) ||
    typeof fetchCall !== "function"
  )
    throw new JevClientError("invalid_request");
  if (callerSignal?.aborted) throw new JevClientError("cancelled");
  if (!Number.isFinite(deadline) || deadline > created + JEV_COMMAND_PROCESS_TIMEOUT_MS)
    throw new JevClientError("invalid_request");
  if (deadline <= created) throw new JevClientError("timeout");
  const endpoint =
    configuredEndpoint === undefined ? resolveJevEndpoint() : validateEndpoint(configuredEndpoint);
  const transportHash =
    mode === "file_match"
      ? jevHash({
          contract: JEV_FILE_MATCH_PROTOCOL,
          endpoint,
          diagnosticBinding: validatedBinding,
        })
      : jevHash({
          contract: JEV_TRANSPORT_BINDING_CONTRACT,
          endpoint,
          ...(validatedBinding ? { processBinding: validatedBinding } : {}),
        });
  if (performance.now() >= deadline) throw new JevClientError("timeout");
  const controller = new AbortController();
  let failure: JevClientError["code"] | undefined;
  let key: string | undefined;
  let busy = false;
  let lastObservedResult: StageResult | undefined;
  const fail = (code: JevClientError["code"]) => {
    failure ??= code;
    controller.abort();
  };
  const callerAbort = () => fail("cancelled");
  callerSignal?.addEventListener("abort", callerAbort, { once: true });
  const timer = setTimeout(() => fail("timeout"), Math.max(0, deadline - performance.now()));
  function guard(): void {
    if (failure) throw new JevClientError(failure);
    if (callerSignal?.aborted) fail("cancelled");
    else if (performance.now() >= deadline) fail("timeout");
    if (failure) throw new JevClientError(failure);
  }
  function close(): void {
    clearTimeout(timer);
    callerSignal?.removeEventListener("abort", callerAbort);
    fail("cancelled");
  }
  async function send(stage: Stage, request: StageRequest): Promise<StageResult> {
    const started = performance.now();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let responseBody: ReadableStream<Uint8Array> | null | undefined;
    let abortListener: (() => void) | undefined;
    let prepared: { ids: string[]; body: string } | undefined;
    let observedResult: StageResult | undefined;
    let requestSent = false;
    let responseComplete = false;
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      guard();
      if (busy) throw new JevClientError("invalid_request");
      busy = true;
      lastObservedResult = undefined;
      // Validate all JSON and bytes before the one credential read.
      prepared = stageRequest(stage, request);
      const { ids, body } = prepared;
      guard();
      key ??= credential().key;
      if (body.includes(key) || body.includes(JSON.stringify(key).slice(1, -1)))
        throw new JevClientError("invalid_request");
      guard();
      const capturedKey = key;
      const aborted = new Promise<never>((_resolve, reject) => {
        abortListener = () => reject(new JevClientError(failure ?? "cancelled"));
        controller.signal.addEventListener("abort", abortListener, { once: true });
      });
      const operation = async (): Promise<StageResult> => {
        requestSent = true;
        const response = await fetchCall(endpoint, {
          method: "POST",
          headers: { Authorization: `Bearer ${capturedKey}`, "Content-Type": "application/json" },
          body,
          signal: controller.signal,
          redirect: "error",
        });
        responseBody = response.body;
        if (controller.signal.aborted) {
          cancelStageBody(responseBody);
          guard();
        }
        guard();
        if (stage === "file_match" && response.redirected !== false)
          throw new JevClientError("invalid_response");
        if (!response.ok) throw new JevClientError("http_error");
        if (!response.body) throw new JevClientError("invalid_response");
        const declaredLength = response.headers.get("content-length");
        if (declaredLength !== null && Number(declaredLength) > MAX_RESPONSE_BYTES)
          throw new JevClientError("response_too_large");
        reader = response.body.getReader();
        while (true) {
          const chunk = await reader.read();
          if (!chunk || typeof chunk.done !== "boolean")
            throw new JevClientError("invalid_response");
          if (chunk.done) responseComplete = true;
          guard();
          if (chunk.done) break;
          if (!(chunk.value instanceof Uint8Array)) throw new JevClientError("invalid_response");
          const retained = chunk.value.subarray(0, MAX_RESPONSE_BYTES - length);
          if (retained.byteLength > 0) chunks.push(Buffer.from(retained));
          length += retained.byteLength;
          if (retained.byteLength !== chunk.value.byteLength)
            throw new JevClientError("response_too_large");
        }
        const content = Buffer.concat(chunks, length);
        let parsed: unknown;
        try {
          const text = new TextDecoder("utf-8", { fatal: true }).decode(content);
          parsed = JSON.parse(text);
          rejectDuplicateKeys(text);
        } catch {
          throw new JevClientError("invalid_response");
        }
        const actual = stagePrediction(stage, parsed, capturedKey, ids);
        const result = {
          stage,
          answers: actual.answers,
          evidence: {
            requestedQuestionIds: ids,
            requestHash: stageHash(body),
            responseHash: stageHash(content),
            transportHash,
            requestBytes: Buffer.byteLength(body),
            responseBytes: length,
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            requestId: actual.requestId,
            usage: actual.usage,
            latencyMs: performance.now() - started,
          },
        } as StageResult;
        observedResult = lastObservedResult = immutableStageResult(result);
        guard();
        result.evidence.latencyMs = performance.now() - started;
        return result;
      };
      const result = await Promise.race([operation(), aborted]);
      cancelStageBody(reader ?? responseBody);
      reader = undefined;
      responseBody = undefined;
      guard();
      result.evidence.latencyMs = performance.now() - started;
      return result;
    } catch (error) {
      const code = failure ?? (error instanceof JevClientError ? error.code : "transport_error");
      fail(code);
      const content = Buffer.concat(chunks, length);
      const evidence = {
        requestedQuestionIds: prepared?.ids ?? [],
        ...(prepared
          ? {
              requestHash: stageHash(prepared.body),
              requestBytes: Buffer.byteLength(prepared.body),
            }
          : {}),
        transportHash,
        latencyMs: Math.max(0, performance.now() - started),
        requestSent,
        failure: code,
        ...(responseComplete
          ? { responseComplete: true, responseHash: stageHash(content), responseBytes: length }
          : length > 0
            ? {
                responseComplete: false,
                responsePrefixHash: stageHash(content),
                responsePrefixBytes: length,
              }
            : {}),
      };
      if (stage === "file_match")
        throw new JevFileMatchClientError(
          code,
          { stage, ...evidence },
          observedResult as JevFileMatchStageResult | undefined,
        );
      throw new JevStageClientError(
        code,
        { stage, ...evidence },
        observedResult as DecisionStageResult | undefined,
      );
    } finally {
      busy = false;
      if (abortListener) controller.signal.removeEventListener("abort", abortListener);
      cancelStageBody(reader ?? responseBody);
      if (failure) {
        clearTimeout(timer);
        callerSignal?.removeEventListener("abort", callerAbort);
      }
    }
  }
  return {
    getObservedResult: () => lastObservedResult,
    send,
    close,
  };
}

export function createJevProcessTransport(options: {
  deadline: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  endpoint?: string;
  binding?: { protocolHash: string; operatingPointHash: string };
}): JevDecisionTransport {
  const transport = createJevStageTransport(options, "decision");
  return {
    getObservedResult: () => transport.getObservedResult() as DecisionStageResult | undefined,
    requestAllHeads: (request) =>
      transport.send("all_heads", request) as Promise<JevAllHeadStageResult>,
    requestNonCommand: (request) =>
      transport.send("non_command", request) as Promise<JevNonCommandStageResult>,
    requestSyntax: (request) => transport.send("syntax", request) as Promise<JevSyntaxStageResult>,
    requestCommandPolicy: (request) =>
      transport.send("command_policy", request) as Promise<JevCommandPolicyStageResult>,
    close: transport.close,
  };
}

/** Use only the private matching contract. Keep its diagnostic binding separate. */
export function createJevFileMatchTransport(options: {
  deadline: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  endpoint?: string;
  binding: JevFileMatchTransportBinding;
}): JevFileMatchTransport {
  const transport = createJevStageTransport(options, "file_match");
  return {
    requestFileMatch: (request) =>
      transport.send("file_match", request) as Promise<JevFileMatchStageResult>,
    getObservedResult: () => transport.getObservedResult() as JevFileMatchStageResult | undefined,
    close: transport.close,
  };
}

/** Use the caller's actual process binding. This stage selects no policy action. */
export function createJevFileMatchProcessTransport(options: {
  deadline: number;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  endpoint?: string;
  binding: JevFileMatchProcessTransportBinding;
}): JevFileMatchTransport {
  const transport = createJevStageTransport(options, "file_match_process");
  return {
    requestFileMatch: (request) =>
      transport.send("file_match", request) as Promise<JevFileMatchStageResult>,
    getObservedResult: () => transport.getObservedResult() as JevFileMatchStageResult | undefined,
    close: transport.close,
  };
}
