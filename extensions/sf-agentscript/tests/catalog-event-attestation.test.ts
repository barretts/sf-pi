/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

describe("Agent Script catalog event attestation", () => {
  it("matches manifest events to handlers registered by the real extension factory", async () => {
    const manifest = JSON.parse(
      readFileSync("extensions/sf-agentscript/manifest.json", "utf8"),
    ) as { events?: string[] };
    const registered = new Set<string>();
    const mod = await import("../index.ts");
    const pi = {
      events: { on: vi.fn(), emit: vi.fn() },
      on: vi.fn((event: string) => registered.add(event)),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
      registerEntryRenderer: vi.fn(),
    };

    mod.default(pi as never);

    const expected = [...(manifest.events ?? [])].sort();
    const catalog = JSON.parse(readFileSync("catalog/index.json", "utf8")) as Array<{
      id: string;
      events?: string[];
    }>;
    expect([...registered].sort()).toEqual(expected);
    expect(catalog.find((extension) => extension.id === "sf-agentscript")?.events?.sort()).toEqual(
      expected,
    );
  });
});
