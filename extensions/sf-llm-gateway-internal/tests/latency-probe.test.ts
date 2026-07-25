/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for latency-probe argument parsing and report formatting. */
import { describe, expect, it } from "vitest";
import {
  RESPONSES_LATENCY_PROBE_MAX_OUTPUT_TOKENS,
  buildOpenAiResponsesBody,
  formatGatewayLatencyProbe,
  parseLatencyProbeArgs,
  shouldRunLegacyOpus47BedrockProbe,
} from "../lib/latency-probe.ts";

describe("parseLatencyProbeArgs", () => {
  it("defaults to the current/default model", () => {
    expect(parseLatencyProbeArgs([], "claude-opus-4-7")).toEqual({
      modelId: "claude-opus-4-7",
      includeLarge: false,
      includeBedrock: false,
    });
  });

  it("parses model and flags", () => {
    expect(parseLatencyProbeArgs(["gpt-5.5", "--large", "--bedrock"], "gpt-5")).toEqual({
      modelId: "gpt-5.5",
      includeLarge: true,
      includeBedrock: true,
    });
  });
});

describe("legacy direct-Bedrock probe routing", () => {
  it("stays scoped to Opus 4.7 instead of probing the wrong model for Opus 5", () => {
    expect(shouldRunLegacyOpus47BedrockProbe("claude-opus-4-7")).toBe(true);
    expect(shouldRunLegacyOpus47BedrockProbe("claude-opus-4-7-v1")).toBe(true);
    expect(shouldRunLegacyOpus47BedrockProbe("claude-opus-4-8")).toBe(false);
    expect(shouldRunLegacyOpus47BedrockProbe("claude-opus-5")).toBe(false);
  });
});

describe("buildOpenAiResponsesBody", () => {
  it("uses the smallest Responses max_output_tokens value accepted by GPT-5 routes", () => {
    const body = buildOpenAiResponsesBody("gpt-5.4-bedrock", 0);
    expect(body.max_output_tokens).toBe(RESPONSES_LATENCY_PROBE_MAX_OUTPUT_TOKENS);
    expect(body.max_output_tokens).toBe(16);
  });
});

describe("formatGatewayLatencyProbe", () => {
  it("renders timing and usage summaries without payload details", () => {
    const output = formatGatewayLatencyProbe({
      ok: true,
      modelId: "claude-opus-4-7",
      generatedAt: "2026-05-18T00:00:00.000Z",
      notes: ["example note"],
      probes: [
        {
          label: "small generation",
          ok: true,
          status: 200,
          durationMs: 1234,
          firstTextMs: 800,
          usage: { input_tokens: 10, output_tokens: 1, ignored: "nope" },
        },
      ],
    });

    expect(output).toContain("Gateway latency probe for claude-opus-4-7");
    expect(output).toContain("small generation");
    expect(output).toContain("firstText=800ms");
    expect(output).toContain("input_tokens=10");
    expect(output).not.toContain("ignored");
  });
});
