/* SPDX-License-Identifier: Apache-2.0 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAdrRecords, renderAdrIndex } from "../lib/adr-lifecycle.mjs";

let adrDir: string;

function writeAdr(id: string, slug: string, metadata: string[], title = `Decision ${id}`): void {
  writeFileSync(
    path.join(adrDir, `${id}-${slug}.md`),
    ["---", `id: "${id}"`, ...metadata, "---", "", `# ${title}`, "", "Body.", ""].join("\n"),
    "utf8",
  );
}

beforeEach(() => {
  adrDir = mkdtempSync(path.join(tmpdir(), "sf-pi-adrs-"));
  mkdirSync(adrDir, { recursive: true });
});

afterEach(() => {
  rmSync(adrDir, { recursive: true, force: true });
});

describe("ADR lifecycle", () => {
  it("loads reciprocal lifecycle metadata and generates grouped views", () => {
    writeAdr("0001", "first", ["status: superseded", "date: 2026-01-01", 'supersededBy: ["0003"]']);
    writeAdr("0002", "proposal", ["status: proposed", "date: 2026-01-02"]);
    writeAdr("0003", "current", ["status: accepted", "date: 2026-01-03", 'supersedes: ["0001"]']);
    writeAdr("0004", "withdrawn", ["status: withdrawn", "date: 2026-01-04"]);

    const records = loadAdrRecords(adrDir);
    const index = renderAdrIndex(records);

    expect(records.map((record: { id: string }) => record.id)).toEqual([
      "0001",
      "0002",
      "0003",
      "0004",
    ]);
    expect(index).toContain("## Current");
    expect(index).toContain("## Proposed");
    expect(index).toContain("## Historical");
    expect(index).toContain("### Superseded");
    expect(index).toContain("### Withdrawn");
    expect(index).toContain("superseded by [ADR 0003](./0003-current.md)");
    for (const id of ["0001", "0002", "0003", "0004"]) {
      expect(index.match(new RegExp(`\\[${id}:`, "g"))).toHaveLength(1);
    }
  });

  it.each([
    ["missing frontmatter", "# Decision\n", "must start with YAML frontmatter"],
    [
      "unknown status",
      '---\nid: "0001"\nstatus: implemented\ndate: 2026-01-01\n---\n\n# Decision\n',
      'invalid status "implemented"',
    ],
    [
      "mismatched id",
      '---\nid: "0099"\nstatus: accepted\ndate: 2026-01-01\n---\n\n# Decision\n',
      'frontmatter id "0099" does not match filename id "0001"',
    ],
    [
      "invalid date",
      '---\nid: "0001"\nstatus: accepted\ndate: yesterday\n---\n\n# Decision\n',
      'invalid date "yesterday"',
    ],
  ])("rejects %s", (_label, source, message) => {
    writeFileSync(path.join(adrDir, "0001-decision.md"), source, "utf8");
    expect(() => loadAdrRecords(adrDir)).toThrow(message);
  });

  it("rejects unresolved and nonreciprocal supersession metadata", () => {
    writeAdr("0001", "first", ["status: superseded", "date: 2026-01-01", 'supersededBy: ["0002"]']);
    writeAdr("0002", "second", ["status: accepted", "date: 2026-01-02"]);

    expect(() => loadAdrRecords(adrDir)).toThrow(
      "ADR 0001 supersededBy 0002 is not reciprocated by ADR 0002 supersedes",
    );
  });

  it("requires superseded records to name their replacement", () => {
    writeAdr("0001", "first", ["status: superseded", "date: 2026-01-01"]);
    expect(() => loadAdrRecords(adrDir)).toThrow(
      "ADR 0001 with status superseded must declare supersededBy",
    );
  });
});
