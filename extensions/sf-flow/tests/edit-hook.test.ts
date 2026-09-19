/* SPDX-License-Identifier: Apache-2.0 */

import { describe, expect, it, vi } from "vitest";

describe("SF Flow edit feedback", () => {
  it("adds local findings after a successful Flow write without contacting an org", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) => {
        handlers.set(event, handler);
      }),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    const updated = (await handlers.get("tool_result")?.(
      {
        toolName: "write",
        isError: false,
        input: { path: "extensions/sf-flow/tests/fixtures/broken.flow" },
        content: [{ type: "text", text: "wrote file" }],
        details: {},
      },
      { cwd: process.cwd() },
    )) as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };

    expect(updated.content?.at(-1)?.text).toContain("SF Flow diagnostics");
    expect(updated.details?.sf_flow_diagnostics).toBeDefined();
  });

  it("stops repair guidance when the actionable signature repeats", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);
    const event = {
      toolName: "edit",
      isError: false,
      input: { path: "extensions/sf-flow/tests/fixtures/broken.flow" },
      content: [{ type: "text", text: "edited file" }],
      details: {},
    };
    await handlers.get("tool_result")?.(event, { cwd: process.cwd() });
    const repeated = (await handlers.get("tool_result")?.(event, {
      cwd: process.cwd(),
    })) as { content?: Array<{ text?: string }>; details?: Record<string, unknown> };

    expect(repeated.content?.at(-1)?.text).toContain("finding signature did not change");
    expect(repeated.details?.sf_flow_repair_loop).toMatchObject({
      status: "stopped",
      reason: "repeated-signature",
    });
  });

  it("keeps low-only generation findings human-only after edits", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    expect(
      await handlers.get("tool_result")?.(
        {
          toolName: "write",
          isError: false,
          input: { path: "extensions/sf-flow/tests/fixtures/Screen_Example.flow-meta.xml" },
          content: [],
          details: {},
        },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();
  });

  it("stays silent for non-Flow writes", async () => {
    const mod = await import("../index.ts");
    const handlers = new Map<string, (event: unknown, ctx: unknown) => Promise<unknown>>();
    const pi = {
      on: vi.fn((event: string, handler: (event: unknown, ctx: unknown) => Promise<unknown>) =>
        handlers.set(event, handler),
      ),
      registerCommand: vi.fn(),
      registerTool: vi.fn(),
    };
    mod.default(pi as never);

    expect(
      await handlers.get("tool_result")?.(
        {
          toolName: "write",
          isError: false,
          input: { path: "README.md" },
          content: [],
          details: {},
        },
        { cwd: process.cwd() },
      ),
    ).toBeUndefined();
  });
});
