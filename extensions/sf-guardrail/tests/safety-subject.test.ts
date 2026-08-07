/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Safety Subject normalization tests.
 */
import { describe, expect, it } from "vitest";
import { normalizeSafetySubject } from "../lib/safety-subject.ts";

describe("normalizeSafetySubject", () => {
  it.each(["read", "write", "edit", "grep", "find", "ls"])(
    "normalizes %s path inputs into file subjects",
    (toolName) => {
      expect(normalizeSafetySubject(toolName, { path: ".env" })).toEqual({
        kind: "file",
        toolName,
        path: ".env",
      });
    },
  );

  it("ignores file tools without string paths", () => {
    expect(normalizeSafetySubject("read", {})).toBeUndefined();
    expect(normalizeSafetySubject("read", { path: 123 })).toBeUndefined();
  });

  it("normalizes bash commands into shell command subjects", () => {
    expect(normalizeSafetySubject("bash", { command: "sf org list --all --json" })).toEqual({
      kind: "shellCommand",
      toolName: "bash",
      command: "sf org list --all --json",
    });
  });

  it("normalizes current herdr_pane run commands into shell command subjects", () => {
    expect(
      normalizeSafetySubject("herdr_pane", {
        action: "run",
        pane: "opaque-pane-id",
        command: "npm test",
      }),
    ).toEqual({
      kind: "shellCommand",
      toolName: "herdr_pane",
      command: "npm test",
    });
  });

  it("ignores non-run herdr_pane actions and run actions without string commands", () => {
    expect(
      normalizeSafetySubject("herdr_pane", {
        action: "read",
        pane: "opaque-pane-id",
        command: "rm -rf tmp/",
      }),
    ).toBeUndefined();
    expect(
      normalizeSafetySubject("herdr_pane", { action: "run", pane: "opaque-pane-id" }),
    ).toBeUndefined();
  });

  it("ignores unrelated tool calls", () => {
    expect(normalizeSafetySubject("code_analyzer", { action: "run" })).toBeUndefined();
  });
});
