/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import {
  identifyDiagnostics,
  identifyQuickFixes,
  sourceVersionFor,
} from "../lib/diagnostic-identity.ts";
import type { AgentScriptDiagnostic, AgentScriptQuickFix } from "../lib/types.ts";

const range = {
  start: { line: 1, character: 2 },
  end: { line: 1, character: 5 },
};

function diagnostic(overrides: Partial<AgentScriptDiagnostic> = {}): AgentScriptDiagnostic {
  return {
    range,
    severity: 2,
    code: "example",
    message: "Example diagnostic",
    ...overrides,
  };
}

function quickFix(overrides: Partial<AgentScriptQuickFix> = {}): AgentScriptQuickFix {
  return {
    title: "Apply example fix",
    preferred: true,
    diagnosticLine: 1,
    diagnosticCode: "example",
    edits: [{ range, newText: "fixed" }],
    ...overrides,
  };
}

describe("Agent Script diagnostic identities", () => {
  test("source versions are stable for exact bytes and change with the source", () => {
    expect(sourceVersionFor("same")).toBe(sourceVersionFor("same"));
    expect(sourceVersionFor("same")).not.toBe(sourceVersionFor("same\n"));
  });

  test("diagnostic identities include full range and message", () => {
    const sourceVersion = sourceVersionFor("source");
    const identified = identifyDiagnostics(sourceVersion, [
      diagnostic(),
      diagnostic({ range: { ...range, end: { line: 1, character: 6 } } }),
      diagnostic({ message: "Different message" }),
    ]);

    expect(new Set(identified.map((item) => item.diagnosticId)).size).toBe(3);
    expect(identifyDiagnostics(sourceVersion, [diagnostic()])[0].diagnosticId).toBe(
      identified[0].diagnosticId,
    );
  });

  test("action identities bind the diagnostic, source, title, and ordered edits", () => {
    const sourceVersion = sourceVersionFor("source");
    const [identifiedDiagnostic] = identifyDiagnostics(sourceVersion, [diagnostic()]);
    const fixes = identifyQuickFixes(sourceVersion, [
      quickFix({ diagnosticId: identifiedDiagnostic.diagnosticId }),
      quickFix({
        diagnosticId: identifiedDiagnostic.diagnosticId,
        edits: [{ range, newText: "different" }],
      }),
    ]);

    expect(fixes[0].sourceVersion).toBe(sourceVersion);
    expect(fixes[0].diagnosticId).toBe(identifiedDiagnostic.diagnosticId);
    expect(fixes[0].actionId).not.toBe(fixes[1].actionId);
    expect(
      identifyQuickFixes(sourceVersion, [
        quickFix({ diagnosticId: identifiedDiagnostic.diagnosticId }),
      ])[0].actionId,
    ).toBe(fixes[0].actionId);
  });
});
