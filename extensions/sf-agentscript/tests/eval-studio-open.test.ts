/* SPDX-License-Identifier: Apache-2.0 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openEvalStudio } from "../lib/eval-studio/open.ts";

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Eval Studio public open seam", () => {
  it("mounts the exact Pi custom overlay with top-center responsive options", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "eval-studio-open-"));
    dirs.push(cwd);
    await writeFile(path.join(cwd, "sfdx-project.json"), "{}");
    const setWorkingVisible = vi.fn();
    let overlayOptions: unknown;
    const custom = vi.fn(async (factory, options) => {
      overlayOptions = options.overlayOptions();
      return await new Promise((resolve) => {
        const component = factory(
          { terminal: { rows: 30 }, requestRender: vi.fn() },
          { fg: (_name: string, value: string) => value, bold: (value: string) => value },
          {},
          resolve,
        );
        component.focused = true;
        expect(component.render(100).join("\n")).toContain("Agent Script Eval Studio");
        component.handleInput("q");
      });
    });
    await openEvalStudio(
      { appendEntry: vi.fn() } as never,
      {
        cwd,
        mode: "tui",
        hasUI: true,
        ui: { custom, setWorkingVisible },
      } as never,
    );
    expect(overlayOptions).toEqual({
      anchor: "top-center",
      width: "96%",
      minWidth: 64,
      maxHeight: "92%",
    });
    expect(setWorkingVisible.mock.calls).toEqual([[false], [true]]);
  });

  it("returns a bounded local inventory in non-TUI mode without mounting custom UI", async () => {
    const cwd = await mkdtemp(path.join(tmpdir(), "eval-studio-open-"));
    dirs.push(cwd);
    await writeFile(path.join(cwd, "sfdx-project.json"), "{}");
    await mkdir(path.join(cwd, "tests", "agentforce"), { recursive: true });
    await writeFile(
      path.join(cwd, "tests", "agentforce", "Demo.eval.json"),
      JSON.stringify({ tests: [] }),
    );
    const appendEntry = vi.fn();
    const custom = vi.fn();
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    await openEvalStudio(
      { appendEntry } as never,
      {
        cwd,
        mode: "print",
        hasUI: false,
        ui: { custom },
      } as never,
    );
    expect(custom).not.toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith(
      "sf-agentscript-eval-studio-output",
      expect.objectContaining({ body: expect.stringContaining("Suites: 1") }),
    );
    info.mockRestore();
  });
});
