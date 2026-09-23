/* SPDX-License-Identifier: Apache-2.0 */
/** One bounded, pinned OpenRouter request. Failures never retain remote text or credentials. */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import type {
  JevAction,
  JevChoiceAnswer,
  JevPrediction,
  JevQuestionId,
  JevRequest,
} from "./types.ts";

export const JEV_MODEL = "typesafe/jev-1.13";
export const JEV_RESOLVED_MODEL = "typesafe/jev-1.13-20260917";
export const JEV_PROVIDER = "TypeSafe";
export const JEV_TIMEOUT_MS = 1_500;
export const JEV_RESPONSE_VALIDATION_CONTRACT = Object.freeze({
  version: 2,
  exactSumTolerance: 1e-6,
  roundedDecimals: 2,
  centLatticeTolerance: 1e-12,
  roundingIntervals: "clipped-closed-nearest-cent",
  preserveWireProbabilities: true,
} as const);

const ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const MAX_KEY_BYTES = 4_096;
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
  readonly code:
    | "missing_credentials"
    | "invalid_credentials"
    | "invalid_request"
    | "cancelled"
    | "timeout"
    | "transport_error"
    | "http_error"
    | "response_too_large"
    | "invalid_response"
    | "identity_mismatch";

  constructor(code: JevClientError["code"]) {
    super(`Jev request failed: ${code}.`);
    this.name = "JevClientError";
    this.code = code;
  }
}

function credential(): { key: string; source: "environment" | "file" } {
  const environmentKey = process.env.OPENROUTER_API_KEY;
  if (environmentKey !== undefined && environmentKey !== "") {
    return { key: validateKey(environmentKey), source: "environment" };
  }
  const path = process.env.OPENROUTER_API_KEY_FILE;
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
  const values = ACTIONS.map((action) => probabilities[action]);
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) <= JEV_RESPONSE_VALIDATION_CONTRACT.exactSumTolerance) return true;

  // OpenRouter rounds Decisions probabilities to two decimals:
  // https://github.com/OpenRouterTeam/ai-sdk-provider#evaluation-jev-with-ai-sdk-through-openrouter
  // Test clipped, closed half-cent intervals using integer units; retain every wire value.
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
  options: { signal?: AbortSignal; fetch?: typeof fetch } = {},
): Promise<JevPrediction> {
  const started = performance.now();
  if (options.signal?.aborted) throw new JevClientError("cancelled");
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
      const response = await (options.fetch ?? globalThis.fetch)(ENDPOINT, {
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
