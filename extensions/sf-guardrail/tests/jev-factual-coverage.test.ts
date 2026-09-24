/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import {
  assertPreparedSoqlArtifactPlan,
  prepareSoqlArtifactPlan,
  registerSoqlArtifactPlanner,
  revokeAllSoqlArtifactPlans,
} from "../../../lib/common/sf-soql-artifact-plan/store.ts";
import { readBundledConfig } from "../lib/config.ts";
import { resolveJevFacts } from "../lib/jev-facts.ts";
import { addJevArtifactPlan, buildJevMetadata } from "../lib/jev-metadata.ts";
import { jevHash } from "../lib/jev-identity.ts";
import {
  buildJevRequest,
  evaluateJevSafety,
  jevContextComplete,
  jevFactBindingHash,
  JEV_PROTOCOL_HASH,
} from "../lib/jev-risk.ts";
import type { JevFacts, JevToolMetadata } from "../lib/types.ts";
import { controlledAllHeadTransport } from "./jev-controlled-transport.ts";

const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({ connectSalesforce: sdk.connect }));

const allow = () => ({
  choice: "allow" as const,
  probabilities: { allow: 1, confirm: 0, block: 0 },
  confidence: 1,
});
const metadata = (fields: Record<string, unknown>): JevToolMetadata => ({
  toolName: "read",
  metadata: fields,
  omissions: [],
  complete: true,
});
const file = (path: string, exists: boolean | "unknown" = true) => ({ path, exists });
const input = (fields: Record<string, unknown> = { path: "expected.txt" }) => ({
  toolName: "read",
  input: fields,
  cwd: process.cwd(),
  config: readBundledConfig(),
});
let artifactSequence = 0;

function withArtifactPlan(
  run: (
    source: ReturnType<typeof input> & {
      sessionId: string;
      toolCallId: string;
      artifactPlan: ReturnType<typeof prepareSoqlArtifactPlan>;
    },
  ) => Promise<void>,
) {
  const source = {
    ...input({ action: "query.run", query: "SELECT Id FROM Sample__c LIMIT 25" }),
    toolName: "sf_soql",
    sessionId: `synthetic-coverage-session-${++artifactSequence}`,
    toolCallId: "synthetic-coverage-call",
  };
  const root = path.join(source.cwd, "synthetic-uncreated-coverage-agent", "sf-pi", "sf-soql");
  const runDirectory = path.join(root, "runs", `jev-${"0".repeat(32)}`);
  const directories: string[] = [];
  for (let directory = runDirectory; ; directory = path.dirname(directory)) {
    directories.unshift(directory);
    if (path.dirname(directory) === directory) break;
  }
  registerSoqlArtifactPlanner(() => ({
    version: 1,
    writerCwd: source.cwd,
    root,
    runDirectory,
    directories,
    files: [
      "query.soql",
      "result.raw.json",
      "result.flattened.json",
      "result.flattened.csv",
      "summary.json",
    ].map((name) => path.join(runDirectory, name)),
  }));
  const artifactPlan = prepareSoqlArtifactPlan({
    toolName: "sf_soql",
    sessionId: source.sessionId,
    toolCallId: source.toolCallId,
    inputHash: jevHash(source.input),
    cwd: source.cwd,
  });
  return run({ ...source, artifactPlan }).finally(revokeAllSoqlArtifactPlans);
}

describe("Jev factual file coverage", () => {
  it.each([
    ["absent", {}],
    ["empty", { files: [] }],
    ["mismatched", { files: [file("other.txt")] }],
    ["alias only", { files: [{ ...file("alias.txt"), resolvedPath: "expected.txt" }] }],
  ] as const)("keeps %s path facts incomplete", (_label, facts) => {
    const operation = metadata({ path: "expected.txt" });
    expect(jevContextComplete(operation, facts as JevFacts)).toBe(false);
    expect(buildJevRequest(operation, facts as JevFacts, readBundledConfig()).state).toMatchObject({
      observations: { contextComplete: false },
    });
  });

  it("requires every selected top-level path and permits extra observations", () => {
    const operation = metadata({ paths: ["first.txt", "second.txt"] });
    expect(jevContextComplete(operation, { files: [file("first.txt")] })).toBe(false);
    expect(
      jevContextComplete(operation, {
        files: [file("second.txt", false), file("first.txt"), file("extra.txt")],
      }),
    ).toBe(true);
  });

  it("uses the exact default resolver paths-array selection before singular path fallback", () => {
    expect(jevContextComplete(metadata({ path: "fallback.txt" }), {})).toBe(false);
    expect(jevContextComplete(metadata({ path: "ignored.txt", paths: [] }), {})).toBe(true);
    expect(
      jevContextComplete(metadata({ path: "ignored.txt", paths: [17, "selected.txt"] }), {
        files: [file("selected.txt")],
      }),
    ).toBe(true);
  });

  it.each([true, false] as const)("accepts observed exists=%s without a kind", (exists) => {
    expect(
      jevContextComplete(metadata({ paths: ["expected.txt"] }), {
        files: [file("expected.txt", exists)],
      }),
    ).toBe(true);
  });

  it("preserves unknown existence, org verification and browser freshness gates", () => {
    const operation = metadata({ paths: ["expected.txt"] });
    const files = [file("expected.txt")];
    expect(jevContextComplete(operation, { files: [file("expected.txt", "unknown")] })).toBe(false);
    expect(jevContextComplete(operation, { files: [...files, file("extra.txt", "unknown")] })).toBe(
      false,
    );
    expect(
      jevContextComplete(operation, {
        files,
        org: { type: "sandbox", verified: false, explicit: true },
      }),
    ).toBe(false);
    expect(jevContextComplete(operation, { files, browser: { status: "stale" } })).toBe(false);
    expect(jevContextComplete({ ...operation, complete: false }, { files })).toBe(false);
  });

  it("preserves no-path operations without inventing file facts", () => {
    expect(jevContextComplete(metadata({}), {})).toBe(true);
    expect(jevContextComplete(buildJevMetadata("bash", { command: "git status" }), {})).toBe(true);
  });

  it("keeps artifact access coverage in addition to selected source paths", () => {
    const operation: JevToolMetadata = {
      ...metadata({ paths: ["source.txt"] }),
      artifactPlan: {
        hash: "a".repeat(64),
        accesses: [
          { path: "generated", access: "mkdir" },
          { path: "generated/result.json", access: "write" },
        ],
      },
    };
    expect(jevContextComplete(operation, { files: [file("source.txt")] })).toBe(false);
    expect(
      jevContextComplete(operation, {
        files: [file("generated", false), file("generated/result.json", false)],
      }),
    ).toBe(false);
    expect(
      jevContextComplete(operation, {
        files: [file("source.txt"), file("generated", false), file("generated/result.json", false)],
      }),
    ).toBe(true);
  });

  it("does not let an optional snapshot erase mandatory source or artifact coverage", () => {
    const operation: JevToolMetadata = {
      ...metadata({ paths: ["source.txt"] }),
      artifactPlan: {
        hash: "a".repeat(64),
        accesses: [{ path: "generated/result.json", access: "write" }],
      },
    };
    expect(jevContextComplete(operation, {}, [])).toBe(false);
    expect(jevContextComplete(operation, { files: [file("source.txt")] }, [])).toBe(false);
    expect(
      buildJevRequest(operation, {}, readBundledConfig(), { requiredFilePaths: [] }).state,
    ).toMatchObject({
      observations: { contextComplete: false },
    });
    expect(jevContextComplete(metadata({}), {}, ["original.txt"])).toBe(false);
  });

  it.each([
    ["read", { file_path: "source.txt" }, ["source.txt"]],
    [
      "write",
      { path: "first.txt", file_path: "second.txt", content: "synthetic" },
      ["first.txt", "second.txt"],
    ],
    ["sf_apex", { action: "diagnose.file", file: "source.cls" }, ["source.cls"]],
    ["agentscript_lifecycle", { action: "publish", agent_file: "source.agent" }, ["source.agent"]],
    ["grep", { pattern: "synthetic" }, ["."]],
    ["find", { pattern: "synthetic" }, ["."]],
    ["ls", {}, ["."]],
  ] as const)("requires the declared path observations for %s", (toolName, fields, paths) => {
    const operation = buildJevMetadata(toolName, fields);
    expect(operation.complete).toBe(true);
    expect(operation.metadata.paths).toEqual(paths);
    expect(jevContextComplete(operation, {})).toBe(false);
    expect(jevContextComplete(operation, { files: paths.map((path) => file(path, false)) })).toBe(
      true,
    );
  });

  it("binds factual coverage semantics into the protocol identity", () => {
    expect(JEV_PROTOCOL_HASH).not.toBe(
      "53b22b9b3279451a147e9147a0e60469f6a897ddc07174c0c09f4f166b7a3588",
    );
  });
});

describe("controlled all-allow results with original path obligations", () => {
  it.each([
    ["absent", { path: "expected.txt" }, {}],
    ["empty", { path: "expected.txt" }, { files: [] }],
    ["mismatched", { path: "expected.txt" }, { files: [file("other.txt")] }],
    [
      "alias only",
      { path: "expected.txt" },
      { files: [{ ...file("alias.txt"), absolutePath: "expected.txt" }] },
    ],
    ["partial", { path: "first.txt", file_path: "second.txt" }, { files: [file("first.txt")] }],
  ] as const)("cannot release %s required facts", async (_label, fields, facts) => {
    const createTransport = controlledAllHeadTransport(allow);
    const decision = await evaluateJevSafety(input(fields), {
      endpoint: "https://decisions.example.test/v1/decisions",
      createTransport,
      resolveFacts: async () => ({ facts: facts as JevFacts }),
    });
    const transport = createTransport.mock.results[0].value;
    expect(transport.requestAllHeads).toHaveBeenCalledOnce();
    expect(decision.action).toBe("confirm");
    expect(transport.requestAllHeads.mock.calls[0][0].state).toMatchObject({
      observations: { contextComplete: false },
    });
    expect(decision.jev?.failure).toBeUndefined();
    expect(
      Object.values(decision.jev?.answers ?? {}).every((answer) => answer?.choice === "allow"),
    ).toBe(true);
    expect(transport.close).toHaveBeenCalledOnce();
  });

  it.each(["remove", "replace", "empty", "partial"] as const)(
    "retains the original path obligations when the resolver can %s metadata paths",
    async (mutation) => {
      const createTransport = controlledAllHeadTransport(allow);
      const decision = await evaluateJevSafety(
        input({ path: "first.txt", file_path: "second.txt" }),
        {
          endpoint: "https://decisions.example.test/v1/decisions",
          createTransport,
          resolveFacts: async ({ metadata: operation }) => {
            delete operation.metadata.path;
            delete operation.metadata.file_path;
            if (mutation === "remove") delete operation.metadata.paths;
            else
              operation.metadata.paths =
                mutation === "replace"
                  ? ["other.txt"]
                  : mutation === "partial"
                    ? ["first.txt"]
                    : [];
            return { facts: { files: [file("first.txt")] } };
          },
        },
      );
      const transport = createTransport.mock.results[0].value;
      expect(transport.requestAllHeads).toHaveBeenCalledOnce();
      expect(decision.action).toBe("confirm");
      expect(transport.requestAllHeads.mock.calls[0][0].state).toMatchObject({
        observations: { contextComplete: false },
      });
      expect(decision.jev?.failure).toBeUndefined();
    },
  );

  it("keeps the original tool and file questions after complete callback metadata mutation", async () => {
    const createTransport = controlledAllHeadTransport(allow);
    const decision = await evaluateJevSafety(input(), {
      endpoint: "https://decisions.example.test/v1/decisions",
      createTransport,
      resolveFacts: async ({ metadata: operation }) => {
        operation.toolName = "sf_browser_press";
        operation.complete = false;
        operation.metadata = {};
        return { facts: { files: [file("expected.txt")] } };
      },
    });
    const transport = createTransport.mock.results[0].value;
    const request = transport.requestAllHeads.mock.calls[0][0];
    expect(request.state).toMatchObject({
      operation: {
        toolName: "read",
        metadata: { path: "expected.txt", paths: ["expected.txt"] },
        complete: true,
      },
      observations: { contextComplete: true },
    });
    expect(Object.keys(request.questions)).toEqual(["risk", "file_policy", "disclosure"]);
    expect(decision.action).toBe("allow");
    expect(decision.jev?.failure).toBeUndefined();
  });

  it("cannot promote original incomplete metadata through callback mutation", async () => {
    const createTransport = controlledAllHeadTransport(allow);
    const decision = await evaluateJevSafety(
      { ...input(), toolName: "synthetic_unknown_tool" },
      {
        endpoint: "https://decisions.example.test/v1/decisions",
        createTransport,
        resolveFacts: async ({ metadata: operation }) => {
          operation.complete = true;
          return { facts: {} };
        },
      },
    );
    const transport = createTransport.mock.results[0].value;
    expect(transport.requestAllHeads.mock.calls[0][0].state).toMatchObject({
      operation: { complete: false },
      observations: { contextComplete: false },
    });
    expect(decision.action).toBe("confirm");
  });

  it.each(["absent", "empty", "mismatched", "partial"] as const)(
    "cannot release %s original artifact facts after callback mutation",
    async (coverage) =>
      withArtifactPlan(async (source) => {
        const original = addJevArtifactPlan(
          buildJevMetadata(source.toolName, source.input),
          source.artifactPlan,
          source,
        );
        const required = original.metadata.paths as string[];
        const createTransport = controlledAllHeadTransport(allow);
        const facts: JevFacts =
          coverage === "absent"
            ? {}
            : {
                files:
                  coverage === "empty"
                    ? []
                    : coverage === "mismatched"
                      ? [file("other.txt")]
                      : required.slice(0, -1).map((value) => file(value, false)),
              };
        const decision = await evaluateJevSafety(source, {
          endpoint: "https://decisions.example.test/v1/decisions",
          createTransport,
          resolveFacts: async (options) => {
            expect((options as typeof options & { artifactPlan: unknown }).artifactPlan).toBe(
              source.artifactPlan,
            );
            options.metadata.metadata.paths = [];
            delete options.metadata.metadata.fileAccesses;
            delete options.metadata.artifactPlan;
            return { facts };
          },
        });
        const transport = createTransport.mock.results[0].value;
        const request = transport.requestAllHeads.mock.calls[0][0];
        expect(decision.action).toBe("confirm");
        expect(decision.jev?.failure).toBeUndefined();
        expect(request.state).toMatchObject({
          operation: {
            metadata: { paths: required, fileAccesses: original.metadata.fileAccesses },
          },
          observations: { contextComplete: false },
        });
        expect(Object.keys(request.questions)).toEqual(["risk", "file_policy", "disclosure"]);
        expect(decision.jev?.factsHash).toBe(
          jevFactBindingHash({ facts, artifactPlan: original.artifactPlan }),
        );
        expect(() => assertPreparedSoqlArtifactPlan(source.artifactPlan)).not.toThrow();
      }),
  );

  it("keeps original artifact access rows and producer identity after callback mutation", async () =>
    withArtifactPlan(async (source) => {
      const original = addJevArtifactPlan(
        buildJevMetadata(source.toolName, source.input),
        source.artifactPlan,
        source,
      );
      const facts = {
        files: (original.metadata.paths as string[]).map((value) => file(value, false)),
      };
      const createTransport = controlledAllHeadTransport(allow);
      const decision = await evaluateJevSafety(source, {
        endpoint: "https://decisions.example.test/v1/decisions",
        createTransport,
        resolveFacts: async (options) => {
          expect((options as typeof options & { artifactPlan: unknown }).artifactPlan).toBe(
            source.artifactPlan,
          );
          const accesses = options.metadata.artifactPlan!.accesses;
          (accesses[0] as { path: string }).path = "changed.txt";
          (options.metadata.metadata.fileAccesses as unknown[]).splice(0);
          options.metadata.metadata.paths = [];
          delete options.metadata.artifactPlan;
          return { facts };
        },
      });
      const request = createTransport.mock.results[0].value.requestAllHeads.mock.calls[0][0];
      expect(request.state).toMatchObject({
        operation: { metadata: { fileAccesses: original.metadata.fileAccesses } },
        observations: { contextComplete: true },
      });
      expect(decision.action).toBe("allow");
      expect(decision.jev?.factsHash).toBe(
        jevFactBindingHash({ facts, artifactPlan: original.artifactPlan }),
      );
      expect(() => assertPreparedSoqlArtifactPlan(source.artifactPlan)).not.toThrow();
    }));

  it("preserves returned artifact binding mismatch rejection", async () =>
    withArtifactPlan(async (source) => {
      const original = addJevArtifactPlan(
        buildJevMetadata(source.toolName, source.input),
        source.artifactPlan,
        source,
      );
      const createTransport = controlledAllHeadTransport(allow);
      const decision = await evaluateJevSafety(source, {
        endpoint: "https://decisions.example.test/v1/decisions",
        createTransport,
        resolveFacts: async () => ({
          facts: {
            files: (original.metadata.paths as string[]).map((value) => file(value, false)),
          },
          artifactPlan: { ...original.artifactPlan!, hash: "b".repeat(64) },
        }),
      });
      expect(decision.action).toBe("block");
      expect(createTransport).not.toHaveBeenCalled();
      expect(decision.jev?.failure).toBeDefined();
    }));

  it.each([
    ["read", { file_path: "extensions/sf-guardrail/tests" }],
    ["write", { path: "synthetic-uncreated-coverage-path.txt", content: "synthetic" }],
    ["grep", { pattern: "synthetic" }],
    ["find", { pattern: "synthetic" }],
    ["ls", {}],
  ] as const)(
    "retains default %s resolver path coverage with controlled answers",
    async (toolName, fields) => {
      const createTransport = controlledAllHeadTransport(allow);
      const decision = await evaluateJevSafety(
        { ...input(fields), toolName },
        {
          endpoint: "https://decisions.example.test/v1/decisions",
          createTransport,
        },
      );
      const transport = createTransport.mock.results[0].value;
      expect(transport.requestAllHeads).toHaveBeenCalledOnce();
      expect(transport.requestAllHeads.mock.calls[0][0].state).toMatchObject({
        observations: { contextComplete: true },
      });
      expect(decision.action).toBe("allow");
      expect(decision.jev?.failure).toBeUndefined();
      expect(sdk.connect).not.toHaveBeenCalled();
    },
  );

  it("keeps the same default resolver array precedence and missing-path observations", async () => {
    const operation = metadata({
      path: "ignored.txt",
      paths: [".", "synthetic-uncreated-coverage-path.txt"],
    });
    const observed = await resolveJevFacts({
      ...input(),
      metadata: operation,
      signal: new AbortController().signal,
    });
    expect(observed.facts.files?.map(({ path, exists }) => ({ path, exists }))).toEqual([
      { path: ".", exists: true },
      { path: "synthetic-uncreated-coverage-path.txt", exists: false },
    ]);
    expect(jevContextComplete(operation, observed.facts)).toBe(true);
    expect(sdk.connect).not.toHaveBeenCalled();
  });
});
