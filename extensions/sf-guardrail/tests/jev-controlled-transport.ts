/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { vi } from "vitest";
import {
  createJevProcessTransport,
  createJevFileMatchProcessTransport,
  JevClientError,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
  JEV_STAGE_REQUEST_BYTES,
} from "../lib/jev-client.ts";
import { jevOperatingPointHash, resolveJevOperatingPoint } from "../lib/jev-operating-point.ts";
import { jevDecisionTransportBindingHash, jevRuntimeProtocolHash } from "../lib/jev-risk.ts";
import type {
  JevAllHeadStageResult,
  JevChoiceAnswer,
  JevQuestionId,
  JevFileMatchStageResult,
  JevFileMatchChoiceAnswer,
} from "../lib/types.ts";

/** Build fresh controlled receipts. This helper has no provider or credential access. */
export function controlledAllHeadTransport(
  select: (id: JevQuestionId) => JevChoiceAnswer,
  receipt: {
    requestId?: string;
    usage?: JevAllHeadStageResult["evidence"]["usage"];
  } = {},
) {
  return vi.fn<typeof createJevProcessTransport>((options) => {
    const point = ["conservative", "argmax"]
      .map((name) => resolveJevOperatingPoint(name))
      .find(
        (candidate) => jevOperatingPointHash(candidate) === options.binding?.operatingPointHash,
      );
    if (!point || options.binding?.protocolHash !== jevRuntimeProtocolHash(point))
      throw new JevClientError("invalid_request");
    const transportHash = jevDecisionTransportBindingHash(options.endpoint, point);
    return {
      requestAllHeads: vi.fn(async (request): Promise<JevAllHeadStageResult> => {
        const body = JSON.stringify(request);
        const requestBytes = Buffer.byteLength(body);
        if (requestBytes > JEV_STAGE_REQUEST_BYTES) throw new JevClientError("invalid_request");
        const requestedQuestionIds = Object.keys(request.questions) as JevQuestionId[];
        const answers = Object.fromEntries(
          requestedQuestionIds.map((id) => [id, structuredClone(select(id))]),
        ) as JevAllHeadStageResult["answers"];
        const requestId = receipt.requestId ?? "source-controlled-all-head-request";
        const usage = structuredClone(receipt.usage ?? { input_tokens: 20, output_tokens: 30 });
        const raw = JSON.stringify({
          model: JEV_RESOLVED_MODEL,
          provider: JEV_PROVIDER,
          id: requestId,
          answers: Object.fromEntries(
            Object.entries(answers).map(([id, answer]) => [id, { type: "choice", ...answer }]),
          ),
          usage,
        });
        return {
          stage: "all_heads",
          answers,
          evidence: {
            requestedQuestionIds,
            requestHash: createHash("sha256").update(body).digest("hex"),
            responseHash: createHash("sha256").update(raw).digest("hex"),
            transportHash,
            requestBytes,
            responseBytes: Buffer.byteLength(raw),
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            requestId,
            usage,
            latencyMs: 1,
          },
        };
      }),
      requestNonCommand: vi.fn(async () => {
        throw new Error("Unexpected non-command stage.");
      }),
      requestSyntax: vi.fn(async () => {
        throw new Error("Unexpected syntax stage.");
      }),
      requestCommandPolicy: vi.fn(async () => {
        throw new Error("Unexpected command-policy stage.");
      }),
      close: vi.fn(),
    };
  });
}

/** Matching fixtures use a separate typed receipt and never read a key or call fetch. */
export function controlledFileMatchTransport(
  select: (id: string) => JevFileMatchChoiceAnswer = () => ({
    choice: "no_match",
    probabilities: { match: 0, no_match: 1, unknown: 0 },
    confidence: 0.37,
  }),
) {
  return vi.fn<typeof createJevFileMatchProcessTransport>((options) => {
    const point = ["conservative", "argmax"]
      .map((name) => resolveJevOperatingPoint(name))
      .find(
        (candidate) => jevOperatingPointHash(candidate) === options.binding?.operatingPointHash,
      );
    if (!point || options.binding?.protocolHash !== jevRuntimeProtocolHash(point))
      throw new JevClientError("invalid_request");
    const transportHash = jevDecisionTransportBindingHash(options.endpoint, point);
    let observed: JevFileMatchStageResult | undefined;
    return {
      requestFileMatch: vi.fn(async (request): Promise<JevFileMatchStageResult> => {
        const body = JSON.stringify(request);
        const requestBytes = Buffer.byteLength(body);
        if (requestBytes > JEV_STAGE_REQUEST_BYTES) throw new JevClientError("invalid_request");
        const requestedQuestionIds = Object.keys(
          request.questions,
        ) as JevFileMatchStageResult["evidence"]["requestedQuestionIds"];
        const answers = Object.fromEntries(
          requestedQuestionIds.map((id) => [id, structuredClone(select(id))]),
        );
        const requestId = "source-controlled-file-match-request";
        const usage = { input_tokens: 11, output_tokens: 5, cost: 0.00002 };
        const raw = JSON.stringify({
          model: JEV_RESOLVED_MODEL,
          provider: JEV_PROVIDER,
          id: requestId,
          answers: Object.fromEntries(
            Object.entries(answers).map(([id, answer]) => [id, { type: "choice", ...answer }]),
          ),
          usage,
        });
        const result: JevFileMatchStageResult = {
          stage: "file_match",
          answers,
          evidence: {
            requestedQuestionIds,
            requestHash: createHash("sha256").update(body).digest("hex"),
            responseHash: createHash("sha256").update(raw).digest("hex"),
            transportHash,
            requestBytes,
            responseBytes: Buffer.byteLength(raw),
            model: JEV_RESOLVED_MODEL,
            provider: JEV_PROVIDER,
            requestId,
            usage,
            latencyMs: 1,
          },
        };
        observed = result;
        return result;
      }),
      getObservedResult: vi.fn(() => observed),
      close: vi.fn(),
    };
  });
}
