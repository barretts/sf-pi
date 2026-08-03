/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Regression: every registered sf-agentscript tool's parameter schema must be
 * OpenAI strict-tool-call compatible.
 */
import { createHash } from "node:crypto";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "vitest";
import { registerAuthoringTool } from "../lib/authoring-tool.ts";
import { registerEvalTool } from "../lib/eval-tool.ts";
import { registerLifecycleTool } from "../lib/lifecycle-tool.ts";
import { registerPreviewTool } from "../lib/preview-tool.ts";

interface CapturedTool {
  name: string;
  label?: string;
  description?: string;
  promptSnippet?: string;
  promptGuidelines?: string[];
  parameters: unknown;
  renderCall?: unknown;
  renderResult?: unknown;
}

function captureRegistrations(): {
  pi: { registerTool: (def: CapturedTool) => void };
  tools: CapturedTool[];
} {
  const tools: CapturedTool[] = [];
  const pi = {
    registerTool: (def: CapturedTool) => {
      tools.push(def);
    },
  };
  return { pi, tools };
}

describe("Every sf-agentscript tool emits an OpenAI-strict-compatible schema", () => {
  const { pi, tools } = captureRegistrations();

  const fakePi = pi as unknown as ExtensionAPI;
  registerAuthoringTool(fakePi);
  registerPreviewTool(fakePi);
  registerEvalTool(fakePi);
  registerLifecycleTool(fakePi);

  test("pins the complete family-tool registration contracts", () => {
    const contracts = tools.map((tool) => ({
      name: tool.name,
      label: tool.label,
      description: tool.description,
      promptSnippet: tool.promptSnippet,
      promptGuidelines: tool.promptGuidelines,
      schemaHash: createHash("sha256").update(JSON.stringify(tool.parameters)).digest("hex"),
      hasRenderCall: typeof tool.renderCall === "function",
      hasRenderResult: typeof tool.renderResult === "function",
    }));
    expect(contracts).toMatchSnapshot();
  });

  test("registers exactly the 4 family tools we expect", () => {
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        "agentscript_authoring",
        "agentscript_eval",
        "agentscript_lifecycle",
        "agentscript_preview",
      ].sort(),
    );
  });

  for (const t of tools) {
    test(`${t.name}: root schema has type:"object" with non-empty properties`, () => {
      const s = t.parameters as Record<string, unknown>;
      expect(s).toBeTruthy();
      expect(s.type).toBe("object");
      expect(s.anyOf).toBeUndefined();
      expect(s.oneOf).toBeUndefined();
      const properties = s.properties as Record<string, unknown> | undefined;
      expect(properties).toBeTruthy();
      expect(Object.keys(properties ?? {}).length).toBeGreaterThan(0);
    });

    test(`${t.name}: discriminator (when present) is a string enum`, () => {
      const s = t.parameters as { properties?: Record<string, Record<string, unknown>> };
      const disc = s.properties?.action ?? s.properties?.verb;
      if (!disc) return;
      const isString = disc.type === "string";
      const isUnion =
        Array.isArray(disc.anyOf) &&
        disc.anyOf.every(
          (m: unknown) =>
            typeof m === "object" &&
            m !== null &&
            (m as Record<string, unknown>).const !== undefined,
        );
      expect(
        isString || isUnion,
        `${t.name}: discriminator is neither string nor const-union`,
      ).toBe(true);
    });
  }
});
