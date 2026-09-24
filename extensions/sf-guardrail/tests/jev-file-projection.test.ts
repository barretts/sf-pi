/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { readBundledConfig } from "../lib/config.ts";
import { buildJevMetadata } from "../lib/jev-metadata.ts";
import {
  buildJevRequest,
  evaluateJevSafety,
  jevContextComplete,
  jevPolicyContext,
} from "../lib/jev-risk.ts";
import type { JevAction, JevFacts, PolicyRule } from "../lib/types.ts";
import { controlledAllHeadTransport } from "./jev-controlled-transport.ts";

const observations = [
  ["read", "read", "file_content"],
  ["grep", "read", "file_content"],
  ["find", "read", "paths"],
  ["ls", "read", "entry_names"],
  ["write", "write", "mutation_status"],
  ["edit", "write", "mutation_status"],
] as const;
const access = { noAccess: ["read", "write", "shell"], readOnly: ["write"], none: [] };

function fileInput(toolName: string, path = "source/unit.ts") {
  if (toolName === "grep" || toolName === "find") return { path, pattern: "PRIVATE_SELECTOR" };
  if (toolName === "write") return { path, content: "PRIVATE_BODY" };
  if (toolName === "edit") return { path, oldText: "PRIVATE_OLD", newText: "PRIVATE_NEW" };
  return { path };
}

function answer(choice: JevAction = "allow") {
  return {
    choice,
    probabilities: {
      allow: choice === "allow" ? 1 : 0,
      confirm: choice === "confirm" ? 1 : 0,
      block: choice === "block" ? 1 : 0,
    },
    confidence: 1,
  };
}

describe("Jev file projection", () => {
  it.each(observations)(
    "projects %s runner access and output without changing source facts",
    (toolName, fileAccess, outputShape) => {
      const metadata = buildJevMetadata(toolName, fileInput(toolName));
      const facts: JevFacts = {
        files: [{ path: "source/unit.ts", exists: true, kind: "file" }],
      };
      const config = readBundledConfig();
      const before = JSON.stringify({ metadata, facts, config });
      const request = buildJevRequest(metadata, facts, config);
      expect(request.state).toMatchObject({
        version: 6,
        operation: {
          ...metadata,
          metadata: {
            ...metadata.metadata,
            fileAccess,
            outputShape,
            selectedDescendantsObserved: false,
          },
        },
        facts,
        observations: { contextComplete: jevContextComplete(metadata, facts) },
      });
      const rows = (request.state as { policy: { files: Record<string, unknown>[] } }).policy.files;
      expect(rows).toEqual(
        (jevPolicyContext(config).files as Array<{ protection: keyof typeof access }>).map(
          (row) => ({ ...row, restrictedAccess: access[row.protection] }),
        ),
      );
      expect(Object.keys(request.questions)).toEqual(
        toolName === "write" || toolName === "edit"
          ? ["risk", "file_policy"]
          : ["risk", "file_policy", "disclosure"],
      );
      expect(JSON.stringify(request)).not.toContain("PRIVATE_");
      expect(JSON.stringify({ metadata, facts, config })).toBe(before);
    },
  );

  it("preserves fresh policy variants and row order without selecting a match", () => {
    const rows: PolicyRule[] = [
      {
        id: "fresh-lock",
        description: "Fresh lock",
        patterns: [{ pattern: "**/vault-*.data" }],
        allowedPatterns: [{ pattern: "sandbox-only", regex: true }],
        protection: "noAccess",
        behavior: "block",
        enabled: false,
        onlyIfExists: true,
      },
      {
        id: "fresh-off",
        description: "Fresh off",
        patterns: [{ pattern: "unrelated-unit", regex: true }],
        protection: "readOnly",
        behavior: "off",
        onlyIfExists: false,
      },
      {
        id: "fresh-open",
        description: "Fresh open",
        patterns: [{ pattern: "**/*" }],
        protection: "none",
        behavior: "confirm",
      },
    ];
    const config = readBundledConfig();
    config.policies.rules = rows;
    const before = JSON.stringify(config);
    const policyRows = jevPolicyContext(config).files as Array<{
      protection: keyof typeof access;
    }>;
    const requests = ["source/unit.ts", "vault-new.data", "sandbox-only"].map((path) =>
      buildJevRequest(
        buildJevMetadata("read", { path }),
        { files: [{ path, exists: path !== "vault-new.data", kind: "unknown" }] },
        config,
      ),
    );
    for (const request of requests) {
      expect((request.state as { policy: unknown }).policy).toEqual({
        files: policyRows.map((row) => ({ ...row, restrictedAccess: access[row.protection] })),
      });
      expect(JSON.stringify(request.state)).not.toMatch(/"(?:winner|matched|sensitivity|outcome)"/);
    }
    expect(JSON.stringify(config)).toBe(before);
  });

  it("leaves a future tool and native query outside the file projection", () => {
    for (const toolName of ["future_file_search", "sf_soql"]) {
      const metadata = buildJevMetadata(
        toolName,
        toolName === "sf_soql"
          ? { action: "query.run", query: "SELECT Id FROM Sample__c LIMIT 8" }
          : { path: "source/unit.ts", pattern: "PRIVATE_SELECTOR" },
      );
      const request = buildJevRequest(
        metadata,
        { files: [{ path: "source/unit.ts", exists: true }] },
        readBundledConfig(),
      );
      const state = request.state as {
        operation: { metadata: Record<string, unknown> };
        policy: { files: Record<string, unknown>[] };
      };
      for (const key of ["fileAccess", "outputShape", "selectedDescendantsObserved"])
        expect(state.operation.metadata).not.toHaveProperty(key);
      expect(state.policy.files.every((row) => !Object.hasOwn(row, "restrictedAccess"))).toBe(true);
      expect(JSON.stringify(request.questions.file_policy?.instructions)).toContain(
        "readOnly restricts ONLY write/edit",
      );
      expect(request.questions.file_policy?.criteria.allow).toMatchObject({
        when: expect.stringContaining("does not restrict operation.toolName"),
      });
      expect(JSON.stringify(request.questions.disclosure?.instructions)).not.toContain(
        "Never copy an access-policy outcome",
      );
      expect(metadata.complete).toBe(false);
      expect(JSON.stringify(request)).not.toContain("PRIVATE_SELECTOR");
    }
  });

  it.each(["directory", "unknown", undefined] as const)(
    "keeps secret directory selection unobserved with supplied kind %s",
    (kind) => {
      const metadata = buildJevMetadata("grep", {
        path: ".env",
        pattern: "PRIVATE_SELECTOR",
        glob: "PRIVATE_GLOB",
        limit: 2,
      });
      const facts: JevFacts = {
        files: [{ path: ".env", exists: true, ...(kind ? { kind } : {}) }],
      };
      const request = buildJevRequest(metadata, facts, readBundledConfig());
      expect(request.state).toMatchObject({
        operation: {
          metadata: {
            path: ".env",
            limit: 2,
            fileAccess: "read",
            outputShape: "file_content",
            selectedDescendantsObserved: false,
          },
          omissions: expect.arrayContaining([
            "search_pattern_data_withheld",
            "search_glob_data_withheld",
          ]),
        },
        facts,
        observations: { contextComplete: true },
      });
      expect(JSON.stringify(request)).not.toMatch(/PRIVATE_|"sensitivity"|"outputBound"/);
      expect(request.questions.disclosure?.criteria.confirm).toMatchObject({
        when: expect.stringContaining(
          "A directory grep with unobserved selected descendants and unresolved sensitivity confirms",
        ),
      });
      expect(request.questions.disclosure?.criteria.allow).toMatchObject({
        exclude: expect.stringContaining("credential-like source contents"),
      });
      expect(JSON.stringify(request.questions.disclosure?.instructions)).toContain(
        "Absent kind and lookup failure mean unknown",
      );
    },
  );

  it("keeps full eligibility and scoped disclosure in exact independent questions", () => {
    const request = buildJevRequest(
      buildJevMetadata("grep", fileInput("grep")),
      { files: [{ path: "source/unit.ts", exists: "unknown", kind: "unknown" }] },
      readBundledConfig(),
    );
    const fileRules = (request.questions.file_policy?.instructions as { rules: string[] }).rules;
    expect(fileRules).toHaveLength(6);
    expect(fileRules[2]).toContain("enabled=true AND");
    expect(fileRules[2]).toContain("THAT SAME ROW");
    expect(fileRules[3]).toContain("allowedPatterns against the same supplied path variants");
    expect(fileRules[3]).toContain("Continue every other row and every other path");
    expect(fileRules[4]).toContain("noAccess>readOnly>none, first row on equal protection");
    expect(fileRules[4]).toContain("off winner suppresses weaker rows");
    expect(fileRules[5]).toContain("member of winner.restrictedAccess");
    expect(request.questions.file_policy?.criteria.block).toMatchObject({
      exclude: expect.stringContaining("stronger or first-tie winner"),
    });
    const disclosureRules = (request.questions.disclosure?.instructions as { rules: string[] })
      .rules;
    expect(disclosureRules).toHaveLength(6);
    expect(disclosureRules[1]).toContain("Neither returns file bodies");
    expect(disclosureRules[2]).toContain("Missing body or withheld selector spelling alone");
    expect(disclosureRules[3]).toContain("status text, not the authored file body");
    expect(disclosureRules[5]).toContain("Never copy an access-policy outcome");
    expect(request.questions.disclosure?.criteria.block).toMatchObject({
      when: expect.stringContaining("This condition has priority over allow and confirm"),
      exclude: expect.stringContaining("restrictedAccess membership"),
    });
    expect(request.state).toMatchObject({ observations: { contextComplete: false } });
    for (const [id, expectedHash] of [
      ["file_policy", "fe82c320fa888370ecae30871876f49c40da0f6a060cb8592f1fe4bc11ddb6fb"],
      ["disclosure", "151555ab2749419ca2c956cab7835daf0e1ea48562a6c15805f050c50bf530b1"],
    ] as const)
      expect(createHash("sha256").update(JSON.stringify(request.questions[id])).digest("hex")).toBe(
        expectedHash,
      );
  });

  it("uses the model answers once without turning access policy into disclosure", async () => {
    const createTransport = controlledAllHeadTransport((id) =>
      answer(id === "file_policy" ? "block" : id === "disclosure" ? "confirm" : "allow"),
    );
    const decision = await evaluateJevSafety(
      {
        toolName: "grep",
        input: { path: ".env", pattern: "PRIVATE_SELECTOR" },
        cwd: "/synthetic/unit",
        config: readBundledConfig(),
      },
      {
        endpoint: "https://decisions.example.test/v1/decisions",
        createTransport,
        resolveFacts: async () => ({
          facts: { files: [{ path: ".env", exists: true, kind: "directory" }] },
        }),
      },
    );
    expect(createTransport).toHaveBeenCalledOnce();
    const request = vi.mocked(createTransport.mock.results[0].value.requestAllHeads);
    expect(request).toHaveBeenCalledOnce();
    expect(decision.action).toBe("block");
    expect(decision.jev?.answers).toMatchObject({
      file_policy: { choice: "block" },
      disclosure: { choice: "confirm" },
    });
    expect(decision.jev?.probabilities).toEqual(answer().probabilities);
    expect(JSON.stringify(request.mock.calls)).not.toContain("PRIVATE_SELECTOR");
  });
});
