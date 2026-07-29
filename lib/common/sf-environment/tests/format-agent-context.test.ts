/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Tests for the agent context and detailed status formatters.
 *
 * Covers: formatAgentContext, formatDetailedStatus
 *
 * These are pure functions: SfEnvironment in, string out.
 */
import { describe, it, expect } from "vitest";
import { formatAgentContext, formatDetailedStatus } from "../format-agent-context.ts";
import type { SfEnvironment } from "../types.ts";

// -------------------------------------------------------------------------------------------------
// Factory helper
// -------------------------------------------------------------------------------------------------

function makeEnv(
  overrides: Partial<{
    cliInstalled: boolean;
    cliVersion: string;
    projectDetected: boolean;
    projectName: string;
    sourceApiVersion: string;
    hasTargetOrg: boolean;
    targetOrg: string;
    configLocation: "Local" | "Global";
    orgDetected: boolean;
    orgAlias: string;
    orgType: SfEnvironment["org"]["orgType"];
    orgConnected: string;
    orgInstanceUrl: string;
    orgApiVersion: string;
    orgError: string;
    detectedAt: number;
  }>,
): SfEnvironment {
  return {
    cli: {
      installed: overrides.cliInstalled ?? true,
      version: overrides.cliVersion ?? "2.130.9",
    },
    project: {
      detected: overrides.projectDetected ?? false,
      name: overrides.projectName,
      sourceApiVersion: overrides.sourceApiVersion,
    },
    config: {
      hasTargetOrg: overrides.hasTargetOrg ?? false,
      targetOrg: overrides.targetOrg,
      location: overrides.configLocation,
    },
    org: {
      detected: overrides.orgDetected ?? false,
      alias: overrides.orgAlias,
      orgType: overrides.orgType ?? "unknown",
      connectedStatus: overrides.orgConnected,
      instanceUrl: overrides.orgInstanceUrl,
      apiVersion: overrides.orgApiVersion,
      error: overrides.orgError,
    },
    detectedAt: overrides.detectedAt ?? Date.now(),
  };
}

// -------------------------------------------------------------------------------------------------
// formatAgentContext
// -------------------------------------------------------------------------------------------------

describe("formatAgentContext", () => {
  it("returns undefined when CLI not installed", () => {
    const env = makeEnv({ cliInstalled: false });
    expect(formatAgentContext(env)).toBeUndefined();
  });

  it("returns undefined when no project and no org", () => {
    const env = makeEnv({});
    expect(formatAgentContext(env)).toBeUndefined();
  });

  it("includes project info", () => {
    const env = makeEnv({
      projectDetected: true,
      projectName: "my-app",
      sourceApiVersion: "66.0",
    });
    const ctx = formatAgentContext(env)!;
    expect(ctx).toContain("<sf_environment>");
    expect(ctx).toContain("</sf_environment>");
    expect(ctx).toContain("Project: my-app (API 66.0)");
  });

  it("includes org info", () => {
    const env = makeEnv({
      hasTargetOrg: true,
      targetOrg: "MyOrg",
      orgDetected: true,
      orgAlias: "MyOrg",
      orgType: "sandbox",
      orgConnected: "Connected",
      orgInstanceUrl: "https://test.sandbox.my.salesforce.com",
      orgApiVersion: "66.0",
      configLocation: "Global",
    });
    const ctx = formatAgentContext(env)!;
    expect(ctx).toContain("Default org: MyOrg (sandbox) — Connected");
    expect(ctx).toContain("Org API version: 66.0");
    expect(ctx).not.toContain("Instance:");
    expect(ctx).not.toContain("Config scope:");
  });

  it("includes CLI version", () => {
    const env = makeEnv({ projectDetected: true, projectName: "x", cliVersion: "2.130.9" });
    const ctx = formatAgentContext(env)!;
    expect(ctx).toContain("SF CLI: v2.130.9");
  });

  it("shows help text when no org configured", () => {
    const env = makeEnv({ projectDetected: true, projectName: "x" });
    const ctx = formatAgentContext(env)!;
    expect(ctx).toContain("not configured");
    expect(ctx).not.toContain("sf org login web");
  });

  it("shows error when org fails to connect", () => {
    const env = makeEnv({
      hasTargetOrg: true,
      targetOrg: "BadOrg",
      orgDetected: false,
      orgError: "auth expired",
    });
    const ctx = formatAgentContext(env)!;
    expect(ctx).toContain("unable to connect");
    expect(ctx).not.toContain("auth expired");
  });

  it("keeps routing and skill metadata out of the environment fact block", () => {
    const env = makeEnv({ projectDetected: true, projectName: "x" });
    const ctx = formatAgentContext(env)!;
    expect(ctx).not.toContain("Active SF skills:");
  });
});

// -------------------------------------------------------------------------------------------------
// formatDetailedStatus
// -------------------------------------------------------------------------------------------------

describe("formatDetailedStatus", () => {
  it("shows install link when CLI is missing", () => {
    const env = makeEnv({ cliInstalled: false });
    const status = formatDetailedStatus(env);
    expect(status).toContain("❌ SF CLI: not found");
    expect(status).toContain("developer.salesforce.com");
  });

  it("shows full status for connected environment", () => {
    const env = makeEnv({
      cliVersion: "2.130.9",
      projectDetected: true,
      projectName: "my-app",
      sourceApiVersion: "66.0",
      hasTargetOrg: true,
      targetOrg: "MyOrg",
      configLocation: "Global",
      orgDetected: true,
      orgAlias: "MyOrg",
      orgType: "sandbox",
      orgConnected: "Connected",
      orgInstanceUrl: "https://test.sandbox.my.salesforce.com",
      orgApiVersion: "66.0",
    });

    const status = formatDetailedStatus(env);
    expect(status).toContain("✅ SF CLI: v2.130.9");
    expect(status).toContain("✅ Project: my-app");
    expect(status).toContain("✅ Target org: MyOrg");
    expect(status).toContain("✅ Org: MyOrg (sandbox)");
    expect(status).toContain("Status: Connected");
  });

  it("warns about production org", () => {
    const env = makeEnv({
      projectDetected: true,
      projectName: "x",
      hasTargetOrg: true,
      orgDetected: true,
      orgAlias: "ProdOrg",
      orgType: "production",
    });
    const status = formatDetailedStatus(env);
    expect(status).toContain("⚠ WARNING");
    expect(status).toContain("PRODUCTION");
  });

  it("shows help for missing project", () => {
    const env = makeEnv({});
    const status = formatDetailedStatus(env);
    expect(status).toContain("⚠ Project: no sfdx-project.json found");
  });

  it("shows help for missing target-org", () => {
    const env = makeEnv({ projectDetected: true, projectName: "x" });
    const status = formatDetailedStatus(env);
    expect(status).toContain("⚠ Target org: not configured");
    expect(status).toContain("sf config set target-org");
  });
});
