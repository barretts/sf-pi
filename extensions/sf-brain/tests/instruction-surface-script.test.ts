/* SPDX-License-Identifier: Apache-2.0 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const script = path.join(repoRoot, "scripts", "instruction-surface-report.mjs");
const tempDirs: string[] = [];

function tempDir(prefix: string): string {
  const value = mkdtempSync(path.join(tmpdir(), prefix));
  tempDirs.push(value);
  return value;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("instruction-surface contributor script", () => {
  it("writes sanitized JSON and Markdown without a model or org call", () => {
    const output = tempDir("sf-brain-report-");
    const agentDir = tempDir("sf-brain-agent-");
    const result = spawnSync(process.execPath, [script, "--output", output], {
      cwd: repoRoot,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
      encoding: "utf8",
      timeout: 30_000,
    });

    expect(result.status, result.stderr).toBe(0);
    const jsonPath = path.join(output, "report.json");
    const markdownPath = path.join(output, "report.md");
    expect(existsSync(jsonPath)).toBe(true);
    expect(existsSync(markdownPath)).toBe(true);
    const report = JSON.parse(readFileSync(jsonPath, "utf8")) as Record<string, unknown>;
    expect(report).toMatchObject({ schema_version: 1, mode: "current_session" });
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(repoRoot);
    expect(readFileSync(markdownPath, "utf8")).toContain("# Instruction Surface Report");
  }, 30_000);
});
