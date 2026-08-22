/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  applyInvocationMode,
  classifyInvocationMode,
  hasDisableModelInvocation,
  parseFrontmatter,
} from "../lib/invocation/frontmatter.ts";

describe("invocation frontmatter", () => {
  it("classifies missing key as agent-invocable", () => {
    const raw = "---\nname: demo\ndescription: demo\n---\nbody\n";
    expect(classifyInvocationMode(raw)).toBe("agent-invocable");
    expect(hasDisableModelInvocation(parseFrontmatter(raw))).toBe(false);
  });

  it("stamps disable-model-invocation without rewriting the body", () => {
    const raw = "---\nname: demo\ndescription: demo\n---\nkeep this\n";
    const next = applyInvocationMode(raw, "manual-only");
    expect(next).toContain("disable-model-invocation: true");
    expect(next).toContain("keep this");
    expect(classifyInvocationMode(next)).toBe("manual-only");
  });

  it("removes the key to restore agent-invocable and collapses duplicates", () => {
    const raw =
      "---\nname: demo\ndisable-model-invocation: true\ndisable-model-invocation: true\n---\nbody\n";
    const next = applyInvocationMode(raw, "agent-invocable");
    expect(next).not.toMatch(/disable-model-invocation/);
    expect(classifyInvocationMode(next)).toBe("agent-invocable");
  });
});
