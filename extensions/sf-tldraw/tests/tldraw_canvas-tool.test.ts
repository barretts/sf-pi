/* SPDX-License-Identifier: Apache-2.0 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import { registerTldrawCanvasTool } from "../lib/tldraw_canvas-tool.ts";

describe("tldraw_canvas family tool", () => {
  function registeredTool() {
    const registerTool = vi.fn();
    registerTldrawCanvasTool({ registerTool } as unknown as ExtensionAPI);
    expect(registerTool).toHaveBeenCalledTimes(1);
    return registerTool.mock.calls[0]![0];
  }

  it("registers one family tool with grounding and readiness guidance", () => {
    const tool = registeredTool();
    expect(tool.name).toBe("tldraw_canvas");
    expect(tool.promptGuidelines.join("\n")).toMatch(/Never infer or fabricate Salesforce facts/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/readiness/i);
    expect(tool.promptGuidelines.join("\n")).toMatch(/OS automation/i);
  });

  it("exposes the data-model card-fill override", () => {
    const tool = registeredTool();
    const schema = JSON.stringify(tool.parameters);
    expect(schema).toContain('"card_fill"');
    expect(schema).toContain('"transparent"');
    expect(schema).toContain('"family"');
  });

  it("loads the cheatsheet lazily without contacting the runtime", async () => {
    const tool = registeredTool();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const result = await tool.execute("id", { action: "cheatsheet" }, undefined, undefined, {
      cwd: process.cwd(),
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.content[0].text).toContain("# `tldraw_canvas` cheatsheet");
    vi.unstubAllGlobals();
  });

  it("requires explicit acknowledgement for raw canvas execution", async () => {
    const tool = registeredTool();
    const result = await tool.execute(
      "id",
      { action: "execute", document_id: "doc", script: "return true" },
      undefined,
      undefined,
      { cwd: process.cwd() },
    );
    expect(result.details.sfTldraw).toMatchObject({
      ok: false,
      action: "execute",
      reason: "acknowledgement_required",
    });
  });

  it("fails closed without an interactive user confirmation even when the model supplies acknowledgement", async () => {
    const tool = registeredTool();
    const result = await tool.execute(
      "id",
      {
        action: "execute",
        document_id: "doc",
        script: "return true",
        acknowledge_raw_canvas: true,
      },
      undefined,
      undefined,
      { cwd: process.cwd(), hasUI: false },
    );
    expect(result.details.sfTldraw).toMatchObject({
      ok: false,
      action: "execute",
      reason: "user_confirmation_required",
    });
  });
});
