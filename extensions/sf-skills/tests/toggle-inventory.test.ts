/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import {
  buildToggleInventory,
  classifySkillOrigin,
  modeForToggleSkill,
  scannedSkillsForToggle,
} from "../lib/invocation/inventory.ts";
import { buildToggleRows } from "../lib/toggle-view.ts";
import type { EffectiveSkillRecord } from "../lib/invocation/effective-tree.ts";
import type { SkillInvocationPolicy } from "../lib/invocation/types.ts";

const policy: SkillInvocationPolicy = {
  default: "manual-only",
  packs: { platform: "agent-invocable" },
  skills: {},
};

function managed(name: string): EffectiveSkillRecord {
  return {
    name,
    relativeDir: name,
    cloneFile: `/tmp/clone/skills/${name}/SKILL.md`,
    effectiveFile: `/Users/x/.pi/agent/sf-skills/effective/skills/${name}/SKILL.md`,
    description: `${name} desc`,
    authorDisabled: false,
    currentMode: "manual-only",
    desiredMode: "manual-only",
  };
}

describe("toggle inventory", () => {
  it("drops gated-off sources when flattening gather results", () => {
    const scanned = scannedSkillsForToggle([
      {
        gate: "off",
        skills: [{ name: "hidden", filePath: "/tmp/hidden/SKILL.md" }],
      },
      {
        gate: "seen",
        skills: [{ name: "visible", filePath: "/tmp/visible/SKILL.md", description: "ok" }],
      },
    ]);
    expect(scanned.map((skill) => skill.name)).toEqual(["visible"]);
  });
  it("classifies managed effective/clone paths as Salesforce", () => {
    expect(classifySkillOrigin("/Users/x/.pi/agent/sf-skills/effective/skills/a/SKILL.md")).toBe(
      "salesforce",
    );
    expect(classifySkillOrigin("/Users/x/.pi/agent/skills/agent-browser/SKILL.md")).toBe(
      "community",
    );
  });

  it("keeps community skills agent-invocable unless overridden", () => {
    const skills = buildToggleInventory(
      [managed("platform-apex-generate")],
      [
        {
          name: "agent-browser",
          description: "browse",
          filePath: "/Users/x/.pi/agent/skills/agent-browser/SKILL.md",
          disableModelInvocation: false,
        },
      ],
    );
    const community = skills.find((skill) => skill.name === "agent-browser");
    expect(community?.origin).toBe("community");
    expect(modeForToggleSkill(community!, policy)).toBe("agent-invocable");
    expect(
      modeForToggleSkill(
        skills.find((skill) => skill.name === "platform-apex-generate")!,
        policy,
      ),
    ).toBe("agent-invocable");
  });

  it("shows pack rows and individual skills when expanded", () => {
    const skills = buildToggleInventory(
      [managed("platform-apex-generate"), managed("dx-org-switch")],
      [
        {
          name: "obsidian",
          description: "notes",
          filePath: "/Users/x/.pi/agent/skills/obsidian/SKILL.md",
          disableModelInvocation: false,
        },
      ],
    );
    const rows = buildToggleRows(skills, policy, new Set(["platform", "dx", "community"]), "");
    expect(rows.some((row) => row.kind === "pack" && row.id === "platform")).toBe(true);
    expect(rows.some((row) => row.kind === "skill" && row.id === "platform-apex-generate")).toBe(
      true,
    );
    expect(rows.some((row) => row.kind === "skill" && row.origin === "Community")).toBe(true);
    const collapsed = buildToggleRows(skills, policy, new Set(), "");
    expect(collapsed.every((row) => row.kind === "pack")).toBe(true);
  });
});
