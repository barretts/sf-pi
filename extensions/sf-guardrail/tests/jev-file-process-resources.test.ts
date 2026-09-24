/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import { buildJevRequest, evaluateJevSafety } from "../lib/jev-risk.ts";
import {
  createJevFileMatchProcessTransport,
  createJevProcessTransport,
  JevClientError,
  JEV_PROVIDER,
  JEV_RESOLVED_MODEL,
} from "../lib/jev-client.ts";
import { JEV_FILE_PROCESS_PROTOCOL, prepareJevFileProcess } from "../lib/jev-file-process.ts";
import { snapshotJevStageResult } from "../lib/jev-command-process.ts";
import type { JevFacts, JevRequest } from "../lib/types.ts";

const injection = vi.hoisted(() => ({ failure: null as Error | null, wires: [] as unknown[] }));
vi.mock("../lib/jev-command-process.ts", async (original) => {
  const actual = await original<typeof import("../lib/jev-command-process.ts")>();
  return {
    ...actual,
    snapshotJevStageResult: <T>(value: T): T => {
      const wire = value as JevRequest;
      if (wire?.model && wire.questions) {
        injection.wires.push(value);
        if ((wire.state as Record<string, unknown>)?.fileMatch && injection.failure)
          throw injection.failure;
      }
      return actual.snapshotJevStageResult(value);
    },
  };
});
const config = () => {
  const result = readBundledConfig();
  result.policies.rules = result.policies.rules.slice(0, 1);
  return result;
};
const facts = (padding: unknown): JevFacts =>
  ({ files: [{ path: "notes.txt", exists: false }], padding }) as JevFacts;
const source = (padding: unknown = []) =>
  buildJevRequest(
    buildJevMetadata("write", { path: "notes.txt", content: "Local authored data." }),
    facts(padding),
    config(),
  );
function stats(value: unknown) {
  let nodes = 0,
    depth = 0;
  const visit = (item: unknown, current: number) => {
    nodes++;
    depth = Math.max(depth, current);
    if (item && typeof item === "object")
      Object.values(item).forEach((child) => visit(child, current + 1));
  };
  visit(value, 0);
  return { nodes, depth, bytes: Buffer.byteLength(JSON.stringify(value)) };
}
function nested(depth: number): unknown {
  let result: unknown = 0;
  for (let index = 0; index < depth; index++) result = { next: result };
  return result;
}
function frozen(value: unknown): void {
  if (value && typeof value === "object") {
    expect(Object.isFrozen(value)).toBe(true);
    Object.values(value).forEach(frozen);
  }
}
let forbiddenFetch: ReturnType<typeof vi.fn>;
beforeEach(() => {
  injection.failure = null;
  injection.wires = [];
  forbiddenFetch = vi.fn(() => {
    throw new Error("Uncontrolled network is prohibited.");
  });
  vi.stubGlobal("fetch", forbiddenFetch);
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY", "synthetic-resource-control-key");
  vi.stubEnv("SF_GUARDRAIL_JEV_API_KEY_FILE", "");
  vi.stubEnv("SF_GUARDRAIL_JEV_OPERATING_POINT", "conservative");
});
afterEach(() => {
  expect(forbiddenFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("independent wire trees and immutable host plans", () => {
  it("admits two individually bounded requests without a duplicate aggregate cap", () => {
    const input = source(Array(9000).fill(0));
    const plan = prepareJevFileProcess(input, false);
    expect(plan.format).toBe("file_match_then_policy");
    expect(stats(input).nodes).toBeGreaterThan(9000);
    expect(stats({ original: plan.original, match: plan.match }).nodes).toBeGreaterThan(16384);
    for (const wire of injection.wires) {
      const measured = stats(wire);
      expect(measured.nodes).toBeLessThanOrEqual(16384);
      expect(measured.depth).toBeLessThanOrEqual(32);
      expect(measured.bytes).toBeLessThanOrEqual(32768);
    }
    expect(
      injection.wires.some((wire) => Object.hasOwn((wire as JevRequest).questions, "f_a")),
    ).toBe(true);
    expect(
      injection.wires.some((wire) => (wire as JevRequest).state && (wire as any).state.fileMatch),
    ).toBe(true);
    expect(plan.original.json).toBe(JSON.stringify(input));
    frozen(plan);
    (input.state as any).facts.padding[0] = 1;
    expect((plan.original.request.state as any).facts.padding[0]).toBe(0);
    expect((plan.match!.request.state as any).facts.padding[0]).toBe(0);
  });
  it("preserves a valid depth32 legacy request without wrapper depth cost", () => {
    const input = source(nested(29));
    (input.state as any).policy.files = [];
    expect(stats(input).depth).toBe(32);
    const plan = prepareJevFileProcess(input, false);
    expect(plan.format).toBe("legacy");
    expect(plan.original.json).toBe(JSON.stringify(input));
    expect(plan.match).toBeUndefined();
    frozen(plan);
  });
  it("keeps a depth32 staged state at its exact original depth", () => {
    const input = source(nested(29));
    const plan = prepareJevFileProcess(input, false);
    expect(plan.format).toBe("file_match_then_policy");
    expect(stats(plan.original.request).depth).toBe(32);
    expect(stats(plan.match!.request).depth).toBe(32);
    expect(injection.wires.filter((wire) => (wire as any).state?.fileMatch).map(stats)).toEqual([
      expect.objectContaining({ depth: 32 }),
    ]);
  });
  it("retains the original request depth and node limits", () => {
    expect(() => prepareJevFileProcess(source(nested(30)), false)).toThrow(JevClientError);
    expect(() => snapshotJevStageResult(Array(16384).fill(0))).toThrow(JevClientError);
    expect(() => snapshotJevStageResult(Array(16383).fill(0))).not.toThrow();
  });
  it("selects exact legacy before transport when the new later tree is not admitted", () => {
    const input = source();
    injection.failure = new JevClientError("invalid_response");
    const plan = prepareJevFileProcess(input, false);
    expect(plan.format).toBe("legacy");
    expect(plan.selection.reason).toBe("complete-downstream-tree-not-admitted");
    expect(plan.original.json).toBe(JSON.stringify(input));
    expect(plan.match).toBeUndefined();
    frozen(plan);
  });
  it("does not treat an arbitrary source error as envelope admission", () => {
    injection.failure = new Error("Authored program failure.");
    expect(() => prepareJevFileProcess(source(), false)).toThrow("Authored program failure.");
  });
  it("declares and deeply freezes separate request limits and local plan rules", () => {
    expect(JEV_FILE_PROCESS_PROTOCOL.version).toBe(3);
    expect(JEV_FILE_PROCESS_PROTOCOL.requestTrees).toContain("no aggregate wire tree cap");
    frozen(JEV_FILE_PROCESS_PROTOCOL);
  });
  it("runs the admitted supplied-facts boundary through both real client schemas with synthetic transport only", async () => {
    const supplied = facts(Array(9000).fill(0));
    const bodies: JevRequest[] = [];
    const controlledFetch = vi.fn<typeof globalThis.fetch>(async (_url, init) => {
      const body = JSON.parse(init!.body as string) as JevRequest;
      bodies.push(body);
      const ids = Object.keys(body.questions);
      const match = ids[0].startsWith("f_");
      const answers = Object.fromEntries(
        ids.map((id) => [
          id,
          {
            type: "choice",
            choice: match ? "no_match" : "allow",
            probabilities: match
              ? { match: 0, no_match: 1, unknown: 0 }
              : { allow: 1, confirm: 0, block: 0 },
            confidence: 1,
          },
        ]),
      );
      return new Response(
        JSON.stringify({
          model: JEV_RESOLVED_MODEL,
          provider: JEV_PROVIDER,
          id: `synthetic-resource-${bodies.length}`,
          answers,
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );
    });
    const result = await evaluateJevSafety(
      {
        engine: "jev",
        toolName: "write",
        input: { path: "notes.txt", content: "Local authored data." },
        cwd: "/synthetic-work",
        config: config(),
      },
      {
        endpoint: "https://resource-control.example.test/v1/decisions",
        resolveFacts: async () => ({ facts: structuredClone(supplied) }),
        createFileTransport: (options) =>
          createJevFileMatchProcessTransport({ ...options, fetch: controlledFetch }),
        createTransport: (options) =>
          createJevProcessTransport({ ...options, fetch: controlledFetch }),
      },
    );
    expect(result.action, JSON.stringify(result)).toBe("allow");
    expect(controlledFetch).toHaveBeenCalledTimes(2);
    expect(bodies.every((body) => stats(body).bytes <= 32768 && stats(body).nodes <= 16384)).toBe(
      true,
    );
    expect((bodies[0].state as any).facts).toEqual(supplied);
    expect((bodies[1].state as any).facts).toEqual(supplied);
    expect(result.jev!.process!.fileStage!.match!.evidence.requestHash).toBe(
      createHash("sha256").update(JSON.stringify(bodies[0])).digest("hex"),
    );
  });
});
