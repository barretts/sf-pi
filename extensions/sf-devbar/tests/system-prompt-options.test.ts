/* SPDX-License-Identifier: Apache-2.0 */
/** Source contract for compact Salesforce environment context injection. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const devbarSource = readFileSync(
  path.resolve(fileURLToPath(import.meta.url), "../../index.ts"),
  "utf-8",
);

describe("sf-devbar environment context wiring", () => {
  it("injects environment facts without tool or skill routing metadata", () => {
    expect(devbarSource).toContain("formatAgentContext(env)");
    expect(devbarSource).not.toContain("systemPromptOptions.skills");
    expect(devbarSource).not.toContain("activeSkills:");
    expect(devbarSource).toMatch(/pi\.on\("before_agent_start",\s*async\s*\(_event,/);
  });

  it("dedupes the env injection so context is written once and on real change", () => {
    expect(devbarSource).toContain("shouldInjectOnce");
    expect(devbarSource).toContain("registerLatestContextProjection");
    expect(devbarSource).toContain("SF_ORG_CONTEXT_ENTRY_TYPE");
    expect(devbarSource).not.toContain("ctx.sessionManager.getEntries()");
    expect(devbarSource).toMatch(/entry\.content === context/);
  });
});
