/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  assignSkillPack,
  normalizeInvocationPolicy,
  resolveInvocationMode,
} from "../lib/invocation/policy.ts";

describe("invocation policy", () => {
  it("assigns longest pack prefix first", () => {
    expect(assignSkillPack("experience-ui-bundle-deploy")).toBe("ui-bundle");
    expect(assignSkillPack("experience-lwc-generate")).toBe("experience");
    expect(assignSkillPack("platform-apex-generate")).toBe("platform");
    expect(assignSkillPack("external-diagram-mermaid-generate")).toBe("other");
  });

  it("resolves skill then pack then default, and author disable wins", () => {
    const policy = normalizeInvocationPolicy({
      default: "manual-only",
      packs: { platform: "agent-invocable" },
      skills: { "platform-apex-generate": "manual-only" },
    });
    expect(resolveInvocationMode({ name: "dx-org-switch", authorDisabled: false, policy })).toBe(
      "manual-only",
    );
    expect(
      resolveInvocationMode({ name: "platform-soql-query", authorDisabled: false, policy }),
    ).toBe("agent-invocable");
    expect(
      resolveInvocationMode({ name: "platform-apex-generate", authorDisabled: false, policy }),
    ).toBe("manual-only");
    expect(
      resolveInvocationMode({ name: "platform-soql-query", authorDisabled: true, policy }),
    ).toBe("manual-only");
    expect(
      resolveInvocationMode({
        name: "agent-browser",
        authorDisabled: false,
        origin: "community",
        policy,
      }),
    ).toBe("agent-invocable");
  });
});
