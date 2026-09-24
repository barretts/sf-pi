/* SPDX-License-Identifier: Apache-2.0 */
/** Real filesystem and browser store. Lookup faults and Salesforce SDK resolution are mocked. */
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectSalesforceOptions } from "../../../lib/common/sf-conn/index.ts";
import type { GuardrailConfig, JevToolMetadata } from "../lib/types.ts";

const sdk = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock("../../../lib/common/sf-conn/index.ts", () => ({ connectSalesforce: sdk.connect }));
const lookups = vi.hoisted(() => ({ stat: vi.fn(), realpath: vi.fn() }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    stat: lookups.stat.mockImplementation(actual.stat),
    realpath: lookups.realpath.mockImplementation(actual.realpath),
  };
});

const BODY = "PRIVATE_FILE_BODY_SENTINEL";
const SESSION = "synthetic-facts-session";
const NOW = new Date("2026-09-23T12:00:00.000Z");
let directory: string;
let cwd: string;
let homeDirectory: string;
let agentDir: string;
let resolveFacts: typeof import("../lib/jev-facts.ts").resolveJevFacts;
let resolveFileFacts: typeof import("../lib/jev-facts.ts").resolveJevFileFacts;
let targetIndependentPress: typeof import("../lib/jev-facts.ts").isJevTargetIndependentBrowserPress;
let contextComplete: typeof import("../lib/jev-risk.ts").jevContextComplete;
let factBindingHash: typeof import("../lib/jev-risk.ts").jevFactBindingHash;
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
  homeDirectory = join(directory, "home");
  agentDir = join(directory, "agent");
  mkdirSync(cwd);
  mkdirSync(homeDirectory);
  mkdirSync(agentDir);
  // The real browser store captures its path at module load. Load after isolating Pi state.
  vi.stubEnv("PI_CODING_AGENT_DIR", agentDir);
  vi.stubEnv("HOME", homeDirectory);
  vi.resetModules();
  ({
    resolveJevFacts: resolveFacts,
    resolveJevFileFacts: resolveFileFacts,
    isJevTargetIndependentBrowserPress: targetIndependentPress,
  } = await import("../lib/jev-facts.ts"));
  ({ jevContextComplete: contextComplete, jevFactBindingHash: factBindingHash } =
    await import("../lib/jev-risk.ts"));
  snapshots = await import("../../../lib/common/sf-browser-snapshot-state.ts");
});

beforeEach(() => {
  sdk.connect.mockReset();
  sdk.connect.mockResolvedValue(session());
  lookups.stat.mockClear();
  lookups.realpath.mockClear();
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
      {
        path: "body.txt",
        absolutePath: join(cwd, "body.txt"),
        relativePath: "body.txt",
        basename: "body.txt",
        exists: true,
        kind: "file",
        resolvedPath: canonical,
      },
      {
        path: "body-link.txt",
        absolutePath: join(cwd, "body-link.txt"),
        relativePath: "body-link.txt",
        basename: "body-link.txt",
        exists: true,
        kind: "file",
        resolvedPath: canonical,
      },
      {
        path: "missing.txt",
        absolutePath: join(cwd, "missing.txt"),
        relativePath: "missing.txt",
        basename: "missing.txt",
        exists: false,
        kind: "unknown",
      },
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
      expect(result.facts.files?.map((file) => file.kind)).toEqual(["file", "directory"]);
      expect(JSON.stringify(result)).not.toContain(BODY);
    } finally {
      chmodSync(join(cwd, "unreadable.txt"), 0o600);
    }
  });

  it("observes directory kinds through symlinks without using a file suffix or inspecting descendants", async () => {
    mkdirSync(join(cwd, "selected.txt"));
    writeFileSync(join(cwd, "selected.txt", "private-child.txt"), BODY);
    symlinkSync("selected.txt", join(cwd, "selected-link.txt"));
    const files = await resolveFileFacts(["selected.txt", "selected-link.txt"], cwd);
    expect(files.map((file) => ({ exists: file.exists, kind: file.kind }))).toEqual([
      { exists: true, kind: "directory" },
      { exists: true, kind: "directory" },
    ]);
    expect(files[0].resolvedPath).toBe(files[1].resolvedPath);
    expect(lookups.stat.mock.calls).toEqual([
      [join(cwd, "selected.txt")],
      [join(cwd, "selected-link.txt")],
    ]);
    expect(lookups.realpath.mock.calls).toEqual(lookups.stat.mock.calls);
    expect(JSON.stringify(files)).not.toContain("private-child.txt");
    expect(JSON.stringify(files)).not.toContain(BODY);
  });

  it.skipIf(process.platform === "win32")(
    "keeps a special file kind separate from regular files and directories",
    async () => {
      symlinkSync("/dev/null", join(cwd, "special-file.txt"));
      const [file] = await resolveFileFacts(["special-file.txt"], cwd);
      expect(file).toMatchObject({ exists: true, kind: "other", resolvedPath: "/dev/null" });
    },
  );

  it("keeps missing creation paths complete and reports a missing symlink target as unknown kind", async () => {
    symlinkSync("absent-target.txt", join(cwd, "dangling-link.txt"));
    const result = await resolve("write", { paths: ["new-creation.txt", "dangling-link.txt"] });
    expect(result.facts.files?.map((file) => ({ exists: file.exists, kind: file.kind }))).toEqual([
      { exists: false, kind: "unknown" },
      { exists: false, kind: "unknown" },
    ]);
    for (const file of result.facts.files ?? []) expect(file).not.toHaveProperty("resolvedPath");
    expect(lookups.realpath).not.toHaveBeenCalled();
    expect(contextComplete(metadata("write", { paths: ["new-creation.txt"] }), result.facts)).toBe(
      true,
    );
  });

  it("keeps failed stat observations unknown and incomplete", async () => {
    writeFileSync(join(cwd, "stat-error.txt"), BODY);
    lookups.stat.mockRejectedValueOnce(
      Object.assign(new Error("Synthetic lookup fault"), { code: "EACCES" }),
    );
    const result = await resolve("read", { path: "stat-error.txt" });
    expect(result.facts.files?.[0]).toMatchObject({ exists: "unknown", kind: "unknown" });
    expect(result.facts.files?.[0]).not.toHaveProperty("resolvedPath");
    expect(lookups.realpath).not.toHaveBeenCalled();
    expect(contextComplete(metadata("read", { path: "stat-error.txt" }), result.facts)).toBe(false);
    expect(JSON.stringify(result)).not.toContain(BODY);
  });

  it.each([
    ["EACCES", "unknown", false],
    ["ENOENT", false, true],
  ] as const)(
    "keeps current existence and completeness on realpath failure %s",
    async (code, exists, complete) => {
      const name = `realpath-error-${code}.txt`;
      writeFileSync(join(cwd, name), BODY);
      lookups.realpath.mockRejectedValueOnce(
        Object.assign(new Error("Synthetic lookup fault"), { code }),
      );
      const result = await resolve("read", { path: name });
      expect(result.facts.files?.[0]).toMatchObject({ exists, kind: "unknown" });
      expect(result.facts.files?.[0]).not.toHaveProperty("resolvedPath");
      expect(lookups.stat).toHaveBeenCalledOnce();
      expect(lookups.realpath).toHaveBeenCalledOnce();
      expect(contextComplete(metadata("read", { path: name }), result.facts)).toBe(complete);
      expect(JSON.stringify(result)).not.toContain(BODY);
    },
  );

  it.skipIf(process.platform === "win32")(
    "reports symlink lookup errors as unknown rather than missing or existing",
    async () => {
      symlinkSync("loop-b", join(cwd, "loop-a"));
      symlinkSync("loop-a", join(cwd, "loop-b"));
      expect((await resolve("read", { path: "loop-a" })).facts.files).toEqual([
        {
          path: "loop-a",
          absolutePath: join(cwd, "loop-a"),
          relativePath: "loop-a",
          basename: "loop-a",
          exists: "unknown",
          kind: "unknown",
        },
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

  it("changes the approval binding when a file becomes a directory at the same path", async () => {
    const name = "changing-kind.txt";
    writeFileSync(join(cwd, name), BODY);
    const first = await resolve("read", { path: name });
    rmSync(join(cwd, name));
    mkdirSync(join(cwd, name));
    const second = await resolve("read", { path: name });
    expect(first.facts.files?.[0].resolvedPath).toBe(second.facts.files?.[0].resolvedPath);
    expect(first.facts.files?.[0]).toMatchObject({ exists: true, kind: "file" });
    expect(second.facts.files?.[0]).toMatchObject({ exists: true, kind: "directory" });
    expect(factBindingHash(first)).not.toBe(factBindingHash(second));
  });

  it("provides the same logical variants for absolute and normalized relative inputs", async () => {
    const absolute = join(cwd, "nested", "new-file.ts");
    const files = await resolveFileFacts([absolute, "nested/../nested/new-file.ts"], cwd);
    expect(files).toEqual([
      {
        path: absolute,
        absolutePath: absolute,
        relativePath: join("nested", "new-file.ts"),
        basename: "new-file.ts",
        exists: false,
        kind: "unknown",
      },
      {
        path: "nested/../nested/new-file.ts",
        absolutePath: absolute,
        relativePath: join("nested", "new-file.ts"),
        basename: "new-file.ts",
        exists: false,
        kind: "unknown",
      },
    ]);
  });

  it("observes home-relative paths equivalently and supplies variants even for missing files", async () => {
    mkdirSync(join(homeDirectory, ".sf"));
    const absolute = join(homeDirectory, ".sf", "fixture.json");
    writeFileSync(absolute, BODY);
    const files = await resolveFileFacts(
      [absolute, "~/.sf/fixture.json", "../home/.sf/fixture.json", "~/.sfdx/new.json", "~"],
      cwd,
    );
    const canonical = await realpath(absolute);
    for (const file of files.slice(0, 3))
      expect(file).toMatchObject({
        absolutePath: absolute,
        relativePath: join("..", "home", ".sf", "fixture.json"),
        basename: "fixture.json",
        homeRelativePath: "~/.sf/fixture.json",
        exists: true,
        kind: "file",
        resolvedPath: canonical,
      });
    expect(files[3]).toEqual({
      path: "~/.sfdx/new.json",
      absolutePath: join(homeDirectory, ".sfdx", "new.json"),
      relativePath: join("..", "home", ".sfdx", "new.json"),
      basename: "new.json",
      homeRelativePath: "~/.sfdx/new.json",
      exists: false,
      kind: "unknown",
    });
    expect(files[4]).toMatchObject({
      path: "~",
      absolutePath: homeDirectory,
      relativePath: join("..", "home"),
      basename: "home",
      homeRelativePath: "~",
      exists: true,
      kind: "directory",
    });
    expect(JSON.stringify(files)).not.toContain(BODY);
  });

  it("does not label sibling directories or traversal outside HOME as home-relative", async () => {
    const files = await resolveFileFacts(
      [join(directory, "home-extra", "new.json"), "~/../outside/new.json"],
      cwd,
    );
    expect(files.map((file) => file.absolutePath)).toEqual([
      join(directory, "home-extra", "new.json"),
      join(directory, "outside", "new.json"),
    ]);
    for (const file of files) expect(file).not.toHaveProperty("homeRelativePath");
  });

  it("keeps the logical link variants and the actual target as separate observations", async () => {
    const target = join(homeDirectory, "linked-target.txt");
    writeFileSync(target, BODY);
    symlinkSync(target, join(cwd, "home-target-link"));
    const [file] = await resolveFileFacts(["home-target-link"], cwd);
    expect(file).toEqual({
      path: "home-target-link",
      absolutePath: join(cwd, "home-target-link"),
      relativePath: "home-target-link",
      basename: "home-target-link",
      exists: true,
      kind: "file",
      resolvedPath: await realpath(target),
    });
    expect(JSON.stringify(file)).not.toContain(BODY);
  });

  it("bounds filesystem lookups before touching an unbounded path population", async () => {
    await expect(
      resolve("read", { paths: Array.from({ length: 33 }, (_, index) => `missing-${index}`) }),
    ).rejects.toThrow("invalid-metadata");
  });

  it("rejects invalid direct helper inputs before filesystem lookup", async () => {
    await expect(resolveFileFacts(["valid.txt", 3] as unknown as string[], cwd)).rejects.toThrow(
      "invalid-metadata",
    );
    await expect(resolveFileFacts("invalid" as unknown as string[], cwd)).rejects.toThrow(
      "invalid-metadata",
    );
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

  const customOrgRule = (cmd = "git") => ({
    id: "synthetic-custom-org-rule",
    match: { tool: "bash" as const, ast: { cmd, subCmd: ["status"] } },
    whenOrgType: ["production" as const],
    action: "block" as const,
    behavior: "block" as const,
  });

  it.each(["production", "sandbox"])(
    "resolves a fresh %s default for a retained custom non-SF org policy",
    async (orgType) => {
      config.orgAwareGate.rules = [customOrgRule()];
      sdk.connect.mockResolvedValueOnce(session({ orgType }));
      const result = await resolve("bash", {
        shell: { commands: [{ executable: "git", subcommands: ["status"] }] },
      });
      expect(result.facts.org).toEqual({ type: orgType, verified: true, explicit: false });
      expect(sdk.connect).toHaveBeenCalledOnce();
      expect(sdk.connect.mock.calls[0][0]).toMatchObject({
        cwd,
        targetOrg: undefined,
        fresh: true,
        timeoutMs: 400,
      });
      expect(result.orgIdentity).toBe("synthetic-org-identity");
      expect(JSON.stringify(result.facts)).not.toContain("synthetic-org-identity");
    },
  );

  it("keeps failed custom-policy org resolution unknown and incomplete", async () => {
    config.orgAwareGate.rules = [customOrgRule()];
    sdk.connect.mockRejectedValueOnce(new Error("synthetic-auth-failure"));
    const fields = { shell: { commands: [{ executable: "git", subcommands: ["status"] }] } };
    const result = await resolve("bash", fields);
    expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: false });
    expect(result.orgIdentity).toBeUndefined();
    expect(contextComplete(metadata("bash", fields), result.facts)).toBe(false);
  });

  it("gathers org facts by executable applicability without matching subcommands or severity", async () => {
    config.orgAwareGate.rules = [
      {
        ...customOrgRule(),
        match: {
          tool: "bash",
          ast: { cmd: "git", subCmd: ["push"], flagIn: { "--force": ["true"] } },
        },
        enabled: false,
        behavior: "off",
      },
    ];
    const result = await resolve("bash", {
      shell: { commands: [{ executable: "git", subcommands: ["status"] }] },
    });
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
    expect(sdk.connect).toHaveBeenCalledOnce();
  });

  it("includes wrapper heads when gathering custom-policy org facts", async () => {
    config.orgAwareGate.rules = [customOrgRule("env")];
    const result = await resolve("bash", {
      shell: { commands: [{ executable: "git", wrappers: [{ executable: "env" }] }] },
    });
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
    expect(sdk.connect).toHaveBeenCalledOnce();
  });

  it.each([
    { shell: { commands: [{ executable: "unknown" }] } },
    { shell: { commands: [{ executable: "git" }], policyTokens: "comments_withheld" } },
    { shell: { commands: [] } },
  ])("retains org fact requirements for opaque or absent shell heads", async (fields) => {
    config.orgAwareGate.rules = [customOrgRule("terraform")];
    const result = await resolve("bash", fields);
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
    expect(sdk.connect).toHaveBeenCalledOnce();
  });

  it("retains org fact requirements when complete head filtering is unavailable", async () => {
    config.orgAwareGate.rules = [customOrgRule("terraform")];
    const fields = { shell: { commands: [{ executable: "git" }] } };
    const result = await resolve(
      "bash",
      fields,
      {},
      {
        metadata: { ...metadata("bash", fields), complete: false },
      },
    );
    expect(result.facts.org).toEqual({ type: "sandbox", verified: true, explicit: false });
    expect(sdk.connect).toHaveBeenCalledOnce();
  });

  it("avoids org lookup when all configured policy heads are structurally excluded", async () => {
    config.orgAwareGate.rules = [customOrgRule("terraform")];
    const result = await resolve("bash", {
      shell: { commands: [{ executable: "git", subcommands: ["status"] }] },
    });
    expect(result.facts).toEqual({});
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it("keeps exact Escape target-independent in the presence of custom shell org policy", async () => {
    config.orgAwareGate.rules = [customOrgRule()];
    const result = await resolve("sf_browser_press", { key: "Escape" }, { key: "Escape" });
    expect(result.facts).toEqual({});
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

  it("omits irrelevant target and org facts for exact Escape without claiming a fresh target", async () => {
    const result = await resolve(
      "sf_browser_press",
      { key: "Escape" },
      { key: "Escape", reason: `Cancel ${BODY}` },
    );
    expect(result.facts).toEqual({});
    expect(result.orgIdentity).toBeUndefined();
    expect(result.browserIdentity).toMatch(/^[0-9a-f]{64}$/);
    expect(sdk.connect).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain(BODY);
  });

  it("binds actual page observations locally for Escape without claiming the probe is a target", async () => {
    const escape = () => resolve("sf_browser_press", { key: "Escape" }, { key: "Escape" });
    const missing = await escape();
    snapshots.writeLatestBrowserSnapshotRefs({
      sessionId: SESSION,
      snapshot: `- button "Save ${BODY}" [ref=e0]`,
      url: `https://fixture.lightning.force.com/form?token=${BODY}`,
    });
    const observed = await escape();
    snapshots.markLatestBrowserSnapshotStale(SESSION, "Synthetic page change");
    const invalidated = await escape();
    snapshots.writeLatestBrowserSnapshotRefs({
      sessionId: SESSION,
      snapshot: `- button "Delete ${BODY}" [ref=e0]`,
      url: `https://other.lightning.force.com/form?token=${BODY}`,
    });
    const replaced = await escape();
    expect(missing.browserIdentity).not.toBe(observed.browserIdentity);
    expect(observed.browserIdentity).not.toBe(invalidated.browserIdentity);
    expect(invalidated.browserIdentity).not.toBe(replaced.browserIdentity);
    for (const result of [missing, observed, invalidated, replaced]) {
      expect(result.facts).toEqual({});
      expect(result.orgIdentity).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(BODY);
      expect(JSON.stringify(result)).not.toContain("lightning.force.com");
    }
    expect(sdk.connect).not.toHaveBeenCalled();
  });

  it.each(["Enter", "NumpadEnter", "Tab", "escape", "Control+Escape", "Shift+Escape"])(
    "retains missing focus and org verification requirements for %s",
    async (key) => {
      capture();
      const result = await resolve("sf_browser_press", { key }, { key });
      expect(result.facts.browser).toEqual({ status: "missing-ref" });
      expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: false });
      expect(sdk.connect).toHaveBeenCalledOnce();
    },
  );

  it("does not apply target independence to mismatched metadata or another browser tool", async () => {
    capture();
    expect(
      targetIndependentPress(
        "sf_browser_press",
        { key: "Escape" },
        metadata("sf_browser_press", { key: "Enter" }),
      ),
    ).toBe(false);
    expect(
      targetIndependentPress(
        "sf_browser_press",
        { key: "Escape" },
        metadata("sf_browser_click", { key: "Escape" }),
      ),
    ).toBe(false);
    const mismatch = await resolve("sf_browser_press", { key: "Enter" }, { key: "Escape" });
    const click = await resolve("sf_browser_click", { key: "Escape" }, { key: "Escape" });
    for (const result of [mismatch, click]) {
      expect(result.facts.browser).toEqual({ status: "missing-ref" });
      expect(result.facts.org).toEqual({ type: "unknown", verified: false, explicit: false });
    }
    expect(sdk.connect).toHaveBeenCalledTimes(2);
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
