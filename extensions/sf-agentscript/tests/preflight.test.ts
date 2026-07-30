/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the publish pre-flight module.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkActionTargets, checkBundleType, extractActionTargets } from "../lib/preflight.ts";
import type { ComponentSummary } from "../lib/inspect.ts";

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(path.join(tmpdir(), "sf-agentscript-preflight-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

// ─── checkBundleType ──────────────────────────────────────────────────────────

describe("checkBundleType", () => {
  it("passes a bundle XML that has both <AiAuthoringBundle> and <bundleType>", async () => {
    const p = path.join(workDir, "ok.bundle-meta.xml");
    await writeFile(
      p,
      `<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n  <bundleType>AGENT</bundleType>\n</AiAuthoringBundle>\n`,
    );
    const out = await checkBundleType(p);
    expect(out.ok).toBe(true);
  });

  it("fails on missing <bundleType>", async () => {
    const p = path.join(workDir, "no-type.bundle-meta.xml");
    await writeFile(
      p,
      `<?xml version="1.0" encoding="UTF-8"?>\n<AiAuthoringBundle xmlns="http://soap.sforce.com/2006/04/metadata">\n</AiAuthoringBundle>\n`,
    );
    const out = await checkBundleType(p);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("missing_bundle_type");
    expect(out.detail).toMatch(/bundleType/);
  });

  it("fails on wrong root element", async () => {
    const p = path.join(workDir, "wrong-root.bundle-meta.xml");
    await writeFile(p, `<?xml version="1.0"?>\n<NotABundle/>\n`);
    const out = await checkBundleType(p);
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("wrong_root");
  });

  it("fails on missing file with a clear detail", async () => {
    const out = await checkBundleType(path.join(workDir, "does-not-exist.bundle-meta.xml"));
    expect(out.ok).toBe(false);
    expect(out.reason).toBe("missing_file");
  });
});

// ─── extractActionTargets ─────────────────────────────────────────────────────

describe("extractActionTargets", () => {
  const make = (xs: Array<{ name: string; target?: string }>): ComponentSummary[] =>
    xs.map((x) => ({ name: x.name, target: x.target }));

  it("parses flow:// and apex:// schemes", () => {
    const out = extractActionTargets(
      make([
        { name: "log", target: "flow://LogEvent" },
        { name: "classify", target: "apex://IssueClassifier" },
      ]),
    );
    expect(out).toEqual([
      { name: "log", target: "flow://LogEvent", scheme: "flow", ref_name: "LogEvent" },
      {
        name: "classify",
        target: "apex://IssueClassifier",
        scheme: "apex",
        ref_name: "IssueClassifier",
      },
    ]);
  });

  it("parses generatePromptResponse:// scheme", () => {
    const out = extractActionTargets(
      make([{ name: "draft", target: "generatePromptResponse://Generate_Schedule" }]),
    );
    expect(out).toHaveLength(1);
    expect(out[0].scheme).toBe("generatePromptResponse");
    expect(out[0].ref_name).toBe("Generate_Schedule");
  });

  it("skips entries without a target", () => {
    const out = extractActionTargets(make([{ name: "no_target" }]));
    expect(out).toEqual([]);
  });

  it("ignores malformed targets", () => {
    const out = extractActionTargets(make([{ name: "bad", target: "no-scheme-here" }]));
    expect(out).toEqual([]);
  });
});

// ─── checkActionTargets ───────────────────────────────────────────────────────

describe("checkActionTargets", () => {
  function fakeConn(records: { sobject: string; rows: Array<Record<string, unknown>> }[]) {
    // Mock connRequest by replacing the module's request helper. Easiest:
    // construct a Connection-like stub whose only required attribute is
    // `request` (used by connRequest under the hood).
    const handler = vi.fn((options: { url: string }) => {
      const url = decodeURIComponent(options.url);
      if (url.includes("/actions/custom/apex/")) {
        const name = url.split("/").at(-1) ?? "";
        const action = records
          .find((entry) => entry.sobject === "ApexAction")
          ?.rows.find((row) => row.name === name);
        if (!action) return Promise.reject(new Error(`No Apex action ${name}`));
        return Promise.resolve(action);
      }
      const found = records.find((entry) => url.includes(`FROM ${entry.sobject}`));
      return Promise.resolve({ records: found?.rows ?? [] });
    });
    return { request: handler } as unknown as Parameters<typeof checkActionTargets>[0];
  }

  it("returns ok when all flows + apex classes resolve", async () => {
    const conn = fakeConn([
      { sobject: "Flow", rows: [{ Definition: { DeveloperName: "LogEvent" }, Metadata: {} }] },
      {
        sobject: "ApexAction",
        rows: [{ name: "IssueClassifier", inputs: [], outputs: [] }],
      },
    ]);
    const result = await checkActionTargets(conn, [
      { name: "log", target: "flow://LogEvent" },
      { name: "classify", target: "apex://IssueClassifier" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(true);
    expect(result.resolved).toBe(2);
    expect(result.missing).toBe(0);
    for (const t of result.targets) expect(t.status).toBe("ok");
  });

  it("separates connected-agent existence from active runtime readiness", async () => {
    const conn = fakeConn([
      {
        sobject: "BotDefinition",
        rows: [
          {
            DeveloperName: "Refund_Agent",
            BotVersions: {
              records: [{ DeveloperName: "v2", VersionNumber: 2, Status: "Active" }],
            },
          },
          { DeveloperName: "Draft_Agent", BotVersions: { records: [] } },
        ],
      },
    ]);
    const result = await checkActionTargets(conn, [
      { name: "refunds", target: "agent://Refund_Agent" },
      { name: "draft", target: "agentforce://Draft_Agent" },
      { name: "missing", target: "agentforce://Missing_Agent" },
    ] as ComponentSummary[]);
    expect(result.resolved).toBe(2);
    expect(result.missing).toBe(1);
    expect(result.targets).toEqual([
      expect.objectContaining({
        name: "refunds",
        status: "ok",
        runtime_readiness: "ready",
        runtime_detail: "Active version v2 is available for connected-agent invocation.",
      }),
      expect.objectContaining({
        name: "draft",
        status: "ok",
        runtime_readiness: "not_ready",
      }),
      expect.objectContaining({ name: "missing", status: "missing" }),
    ]);
    expect(result.targets[1].runtime_detail).toMatch(/activate/i);
  });

  it("flags missing targets and continues", async () => {
    const conn = fakeConn([
      { sobject: "Flow", rows: [{ Definition: { DeveloperName: "Found" }, Metadata: {} }] },
      { sobject: "ApexAction", rows: [] },
    ]);
    const result = await checkActionTargets(conn, [
      { name: "ok", target: "flow://Found" },
      { name: "miss_flow", target: "flow://NotThere" },
      { name: "miss_apex", target: "apex://Missing" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(false);
    expect(result.resolved).toBe(1);
    expect(result.missing).toBe(1);
    expect(result.unverifiable).toBe(1);
    const missingNames = result.targets.filter((t) => t.status === "missing").map((t) => t.name);
    expect(missingNames).toEqual(["miss_flow"]);
    const byName = new Map(result.targets.map((t) => [t.name, t]));
    expect(byName.get("miss_flow")?.detail).toMatch(/active Flow/);
    expect(byName.get("miss_apex")?.status).toBe("unverifiable");
    expect(byName.get("miss_apex")?.detail).toMatch(/could not be described/);
  });

  it("reports unverifiable schemes that have no resolver registered", async () => {
    const conn = fakeConn([]);
    const result = await checkActionTargets(conn, [
      // 'somenovelcheme' isn't in the registry
      { name: "x", target: "somenovelcheme://Foo" },
    ] as ComponentSummary[]);
    expect(result.ok).toBe(true);
    expect(result.unverifiable).toBe(1);
    expect(result.targets[0].status).toBe("unverifiable");
    expect(result.targets[0].detail).toMatch(/no resolver registered/);
  });

  it("returns empty result when no action declarations have targets", async () => {
    const conn = fakeConn([]);
    const result = await checkActionTargets(conn, [{ name: "no_target" }] as ComponentSummary[]);
    expect(result.ok).toBe(true);
    expect(result.total).toBe(0);
    expect(result.targets).toEqual([]);
  });
});
