/* SPDX-License-Identifier: Apache-2.0 */
/** Real filesystem and browser snapshot store; only Salesforce SDK resolution is mocked. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectSalesforceOptions } from "../../../lib/common/sf-conn/index.ts";
import type { GuardrailConfig, JevToolMetadata } from "../lib/types.ts";

const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({ connectSalesforce: sdk.connect }));

const BODY = "PRIVATE_FILE_BODY_SENTINEL";
const SESSION = "synthetic-facts-session";
const NOW = new Date("2026-09-23T12:00:00.000Z");
let directory: string;
let cwd: string;
let agentDir: string;
let resolveFacts: typeof import("../lib/jev-facts.ts").resolveJevFacts;
let snapshots: typeof import("../../../lib/common/sf-browser-snapshot-state.ts");
let config: GuardrailConfig;
let controller: AbortController;

const session = (overrides: Record<string, unknown> = {}) => ({
  target: {
    targetOrg: "synthetic-default",
    orgType: "sandbox",
    orgId: "synthetic-org-identity",
    username: "synthetic-user",
    instanceUrl: "https://fixture.my.salesforce.com",
    ...overrides,
  },
});
const metadata = (toolName: string, fields: Record<string, unknown> = {}): JevToolMetadata => ({
  toolName,
  metadata: fields,
  omissions: [],
  complete: true,
});
const resolve = (
  toolName: string,
  fields: Record<string, unknown> = {},
  input: Record<string, unknown> = {},
  options: Record<string, unknown> = {},
) =>
  resolveFacts({
    toolName,
    input,
    metadata: metadata(toolName, fields),
    cwd,
    config,
    sessionId: SESSION,
    signal: controller.signal,
    ...options,
  });

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "sf-guardrail-jev-facts-"));
  cwd = join(directory, "project");
  agentDir = join(directory, "agent");
  mkdirSync(cwd);
  mkdirSync(agentDir);
  // The real browser store captures its path at module load. Load after isolating Pi state.
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.resetModules();
  ({ resolveJevFacts: resolveFacts } = await import("../lib/jev-facts.ts"));
  snapshots = await import("../../../lib/common/sf-browser-snapshot-state.ts");
});

beforeEach(() => {
  sdk.connect.mockReset();
  sdk.connect.mockResolvedValue(session());
  controller = new AbortController();
  config = {
    version: 1,
    productionAliases: [],
    headlessEscapeHatchEnv: "SYNTHETIC_HEADLESS",
    confirmTimeoutMs: 1000,
    policies: { rules: [] },
    commandGate: { patterns: [], allowedPatterns: [], autoDenyPatterns: [] },
    orgAwareGate: { rules: [] },
  };
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  rmSync(join(agentDir, "sf-pi", "sf-browser", "snapshots", "latest-refs.json"), { force: true });
});

afterEach(() => {
  vi.useRealTimers();
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});

describe("Jev filesystem facts", () => {
  it("inspects actual paths, follows symlinks, and reports missing paths without disclosing bodies", async () => {
    writeFileSync(join(cwd, "body.txt"), BODY);
    symlinkSync("body.txt", join(cwd, "body-link.txt"));
    const result = await resolve(
      "write",
      { paths: ["body.txt", "body-link.txt", "missing.txt"] },
      { content: BODY },
    );
    const canonical = await realpath(join(cwd, "body.txt"));
    expect(result.facts.files).toEqual([
      { path: "body.txt", exists: true, resolvedPath: canonical },
      { path: "body-link.txt", exists: true, resolvedPath: canonical },
      { path: "missing.txt", exists: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(BODY);
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("can inspect an unreadable file and directory that offer no readable file body", async () => {
    writeFileSync(join(cwd, "unreadable.txt"), BODY);
    chmodSync(join(cwd, "unreadable.txt"), 0);
    mkdirSync(join(cwd, "directory-without-body"));
    try {
      const result = await resolve("read", { paths: ["unreadable.txt", "directory-without-body"] });
      expect(result.facts.files?.map((file) => file.exists)).toEqual([true, true]);
      expect(JSON.stringify(result)).not.toContain(BODY);
    } finally {
      chmodSync(join(cwd, "unreadable.txt"), 0o600);
    }
  });

  it.skipIf(process.platform === "win32")(
    "reports symlink lookup errors as unknown rather than missing or existing",
    async () => {
      symlinkSync("loop-b", join(cwd, "loop-a"));
      symlinkSync("loop-a", join(cwd, "loop-b"));
      expect((await resolve("read", { path: "loop-a" })).facts.files).toEqual([
        { path: "loop-a", exists: "unknown" },
      ]);
    },
  );

  it("reflects a symlink target change in approval-binding facts", async () => {
    writeFileSync(join(cwd, "target-a.txt"), BODY);
    writeFileSync(join(cwd, "target-b.txt"), BODY);
    symlinkSync("target-a.txt", join(cwd, "changing-link"));
    const first = await resolve("read", { path: "changing-link" });
    rmSync(join(cwd, "changing-link"));
    symlinkSync("target-b.txt", join(cwd, "changing-link"));
    const second = await resolve("read", { path: "changing-link" });
    expect(first.facts.files?.[0].resolvedPath).not.toBe(second.facts.files?.[0].resolvedPath);
  });

  it("bounds filesystem lookups before touching an unbounded path population", async () => {
    await expect(
      resolve("read", { paths: Array.from({ length: 33 }, (_, index) => `missing-${index}`) }),
    ).rejects.toThrow("invalid-metadata");
  });
});

describe("fresh Salesforce org facts", () => {
  it.each([
    "sf_apex",
    "sf_soql",
    "agentscript_lifecycle",
    "sf_browser_click",
    "data360_discover",
    "data360_connect",
    "data360_prepare",
    "data360_harmonize",
    "data360_segment",
    "data360_activate",
    "data360_query",
    "data360_semantic",
    "data360_observe",
    "data360_orchestrate",
    "data360_api",
  ])("resolves the unspecified default freshly through SDK for %s", async (name) => {
    if (name.startsWith("sf_browser_"))
      snapshots.writeLatestBrowserSnapshotRefs({
        sessionId: SESSION,
        snapshot: '- button "Save" [ref=e3]',
        url: "https://fixture.lightning.force.com/form",
      });
    const result = await resolve(name, {}, name.startsWith("sf_browser_") ? { ref: "@e3" } : {});
    expect(sdk.connect).toHaveBeenCalledOnce();
    const options = sdk.connect.mock.calls[0][0] as ConnectSalesforceOptions;
    expect(options).toMatchObject({ cwd, targetOrg: undefined, fresh: true, timeoutMs: 400 });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
    expect(result.orgIdentity).toBe("synthetic-org-identity");
    expect(JSON.stringify(result.facts)).not.toContain("synthetic-org-identity");
  });

  it("resolves explicit aliases with the call cwd and uses stable SDK identity", async () => {
    const result = await resolve("sf_apex", {}, { target_org: "synthetic-explicit" });
    expect(sdk.connect.mock.calls[0][0]).toMatchObject({
      cwd,
      targetOrg: "synthetic-explicit",
      fresh: true,
    });
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: true });
    expect(result.orgIdentity).toBe("synthetic-org-identity");
    expect(JSON.stringify(result.facts)).not.toContain("synthetic-explicit");
  });

  it("detects changed default org identity on the next lookup rather than reusing cached facts", async () => {
    const first = await resolve("sf_soql");
    sdk.connect.mockResolvedValueOnce(
      session({
        targetOrg: "synthetic-other-default",
        orgId: "synthetic-other-identity",
        orgType: "production",
      }),
    );
    const second = await resolve("sf_soql");
    expect(sdk.connect).toHaveBeenCalledTimes(2);
    expect(second.orgIdentity).not.toBe(first.orgIdentity);
    expect(second.facts.org).toMatchObject({ type: "production", verified: true, explicit: false });
    for (const [options] of sdk.connect.mock.calls)
      expect(options).toMatchObject({ targetOrg: undefined, fresh: true });
  });

  it("keeps configured protected aliases production for explicit and freshly resolved default targets", async () => {
    config.productionAliases = ["synthetic-protected"];
    expect((await resolve("sf_apex", {}, { target_org: "synthetic-protected" })).facts.org).toEqual(
      { type: "production", verified: true, explicit: true },
    );
    expect(sdk.connect).not.toHaveBeenCalled();
    sdk.connect.mockResolvedValueOnce(
      session({ targetOrg: "synthetic-protected", orgType: "sandbox" }),
    );
    expect((await resolve("sf_apex")).facts.org).toEqual({
      type: "production",
      verified: true,
      explicit: false,
    });
  });

  it.each([{ orgType: "unknown" }, { orgId: undefined, username: undefined }])(
    "leaves incomplete SDK identities or types unknown",
    async (target) => {
      sdk.connect.mockResolvedValueOnce(session(target));
      const result = await resolve("sf_soql");
      expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: false });
      expect(result.orgIdentity).toBeUndefined();
    },
  );

  it("uses username identity only when the fresh SDK omitted an org id", async () => {
    sdk.connect.mockResolvedValueOnce(session({ orgId: undefined }));
    expect((await resolve("sf_soql")).orgIdentity).toBe("synthetic-user");
  });

  it("leaves auth failures unknown instead of verifying an inferred sandbox", async () => {
    sdk.connect.mockRejectedValueOnce(new Error("synthetic-auth-failure"));
    expect((await resolve("data360_query")).facts.org).toEqual({
      type: "unknown",
      verified: false,
      explicit: false,
    });
  });

  it("bounds SDK lookup by deadline and ignores late successful identities", async () => {
    let release: (value: ReturnType<typeof session>) => void;
    sdk.connect.mockImplementationOnce(
      () =>
        new Promise((done) => {
          release = done;
        }),
    );
    const result = await resolve("sf_apex");
    const signal = (sdk.connect.mock.calls[0][0] as ConnectSalesforceOptions).signal;
    expect(signal?.aborted).toBe(true);
    expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: false });
    release!(session());
    await Promise.resolve();
    expect(result.orgIdentity).toBeUndefined();
  });

  it("propagates caller cancellation while SDK lookup is pending", async () => {
    sdk.connect.mockImplementationOnce(() => new Promise(() => {}));
    const pending = resolve("sf_apex");
    await vi.waitFor(() => expect(sdk.connect).toHaveBeenCalledOnce());
    const cancelled = new Error("synthetic-caller-cancelled");
    controller.abort(cancelled);
    await expect(pending).rejects.toBe(cancelled);
    expect((sdk.connect.mock.calls[0][0] as ConnectSalesforceOptions).signal?.aborted).toBe(true);
  });

  it("rejects an already cancelled caller before SDK or file lookups", async () => {
    controller.abort(new Error("synthetic-caller-cancelled"));
    await expect(resolve("sf_apex", { paths: ["body.txt"] })).rejects.toThrow(
      "synthetic-caller-cancelled",
    );
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("leaves multiple CLI targets unknown, including one explicit sandbox followed by a default", async () => {
    const result = await resolve(
      "bash",
      { shell: { commands: [{ executable: "sf" }, { executable: "sf" }] } },
      {},
      { targetOrg: "synthetic-sandbox" },
    );
    expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: true });
    expect(result.orgIdentity).toBeUndefined();
    expect(sdk.connect).not.toHaveBeenCalled();
  });
});

describe("browser snapshot facts and local binding", () => {
  const capture = (
    label = "Save",
    url = `https://fixture.lightning.force.com/form?token=${BODY}`,
  ) =>
    snapshots.writeLatestBrowserSnapshotRefs({
      sessionId: SESSION,
      snapshot: `- button "${label}" [ref=e3] ${BODY}`,
      url,
      fullSnapshotPath: join(cwd, "body.txt"),
    });

  it("uses fresh role/label metadata without page lines, full snapshot files or URLs", async () => {
    capture();
    const result = await resolve("sf_browser_click", {}, { ref: "@e3" });
    expect(result.facts.browser).toEqual({
      status: "fresh",
      role: "button",
      label: "Save",
      ageMs: 0,
    });
    expect(result.browserIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toContain(BODY);
    expect(JSON.stringify(result.facts)).not.toContain("fixture.lightning.force.com");
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
  });

  it.each([
    ["https://fixture.my.salesforce.com/form", true],
    ["https://fixture.lightning.force.com/form", true],
    ["https://other.my.salesforce.com/form", false],
    ["https://example.invalid/form", false],
    ["http://fixture.my.salesforce.com/form", false],
    ["https://fixture.my.salesforce.com:8443/form", false],
    [undefined, false],
  ] as Array<[string | undefined, boolean]>)(
    "verifies browser org identity only when the observed URL matches the fresh SDK instance",
    async (url, verified) => {
      snapshots.writeLatestBrowserSnapshotRefs({
        sessionId: SESSION,
        snapshot: '- button "Save" [ref=e3]',
        url,
      });
      const result = await resolve("sf_browser_click", {}, { ref: "@e3" });
      expect(result.facts.org).toEqual({
        type: verified ? "sandbox" : "unknown",
        verified,
        explicit: false,
      });
      expect(result.orgIdentity).toBe(verified ? "synthetic-org-identity" : undefined);
      expect(JSON.stringify(result.facts)).not.toContain("salesforce.com");
    },
  );

  it("omits stale role/label details and changes binding when a snapshot is invalidated", async () => {
    capture();
    const first = await resolve("sf_browser_click", {}, { ref: "@e3" });
    vi.setSystemTime(new Date(NOW.getTime() + 10));
    snapshots.markLatestBrowserSnapshotStale(SESSION, "Synthetic navigation");
    const stale = await resolve("sf_browser_click", {}, { ref: "@e3" });
    expect(stale.facts.browser).toEqual({ status: "stale", ageMs: 10 });
    expect(stale.browserIdentity).not.toBe(first.browserIdentity);
  });

  it("omits labels after the maximum snapshot age and binds replacement snapshots independently", async () => {
    capture();
    const first = await resolve("sf_browser_click", {}, { ref: "@e3" });
    vi.setSystemTime(new Date(NOW.getTime() + snapshots.BROWSER_SNAPSHOT_REF_MAX_AGE_MS + 1));
    expect((await resolve("sf_browser_click", {}, { ref: "@e3" })).facts.browser?.status).toBe(
      "stale",
    );
    capture();
    const replaced = await resolve("sf_browser_click", {}, { ref: "@e3" });
    expect(replaced.facts.browser?.status).toBe("fresh");
    expect(replaced.browserIdentity).not.toBe(first.browserIdentity);
  });

  it("binds session, ref and snapshot URL identity locally", async () => {
    capture();
    const first = await resolve("sf_browser_click", {}, { ref: "@e3" });
    const otherRef = await resolve("sf_browser_click", {}, { ref: "@e9" });
    const otherSession = await resolve(
      "sf_browser_click",
      {},
      { ref: "@e3" },
      { sessionId: "synthetic-other-session" },
    );
    capture("Save", "https://example.invalid/other-form");
    const otherUrl = await resolve("sf_browser_click", {}, { ref: "@e3" });
    for (const identity of [
      otherRef.browserIdentity,
      otherSession.browserIdentity,
      otherUrl.browserIdentity,
    ])
      expect(identity).not.toBe(first.browserIdentity);
  });

  it.each([`api_key=${BODY}`, `Bearer ${BODY}`, `https://example.invalid/?token=${BODY}`])(
    "withholds credential-bearing observed labels and marks context incomplete",
    async (label) => {
      capture(label);
      const result = await resolve("sf_browser_click", {}, { ref: "@e3" });
      expect(result.facts.browser).toEqual({ status: "incomplete", role: "button", ageMs: 0 });
      expect(JSON.stringify(result)).not.toContain(BODY);
    },
  );
});
