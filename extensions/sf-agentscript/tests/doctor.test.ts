/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, test } from "vitest";
import {
  npmRegistryPackageUrl,
  packageCoherenceIssues,
  probeDoctor,
  renderDoctorReport,
  type DoctorStatus,
} from "../lib/doctor.ts";

function baseStatus(): DoctorStatus {
  return {
    sdkLoaded: true,
    sdkPackage: "@sf-agentscript/agentforce",
    sdkPackageVersion: "2.5.32",
    agentScriptPackages: [
      {
        name: "@sf-agentscript/agentforce",
        kind: "direct",
        declaredVersion: "2.5.32",
        resolvedVersion: "2.5.32",
        latestVersion: "2.5.32",
        freshness: "current",
        loaded: true,
      },
      {
        name: "@sf-agentscript/compiler",
        kind: "transitive",
        resolvedVersion: "2.6.9",
        latestVersion: "2.7.0",
        freshness: "update_available",
        loaded: true,
      },
    ],
    packageCoherent: true,
    packageIssues: [],
    dialectsProbed: ["agentforce"],
    upstreamNote: "@sf-agentscript/agentforce@2.5.32",
    salesforceCoreResolved: true,
    salesforceCoreVersion: "8.31.0",
    sfdxAgentsWritable: true,
    sfdxAgentsPath: "/tmp/.sfdx/agents",
  };
}

describe("renderDoctorReport", () => {
  test("builds scoped npm registry URLs", () => {
    expect(npmRegistryPackageUrl("@sf-agentscript/agentforce")).toBe(
      "https://registry.npmjs.org/@sf-agentscript%2Fagentforce",
    );
  });

  test("omits the test-only AgentFabric package from runtime doctor status", async () => {
    const status = await probeDoctor(process.cwd());
    expect(status.agentScriptPackages.map((entry) => entry.name)).not.toContain(
      "@sf-agentscript/agentfabric-dialect",
    );
  });

  test("renders official AgentScript package versions", () => {
    const report = renderDoctorReport(baseStatus());
    expect(report).toContain("AgentScript packages:");
    expect(report).toContain(
      "@sf-agentscript/agentforce: direct, declared 2.5.32, resolved 2.5.32, latest 2.5.32, current",
    );
    expect(report).toContain(
      "@sf-agentscript/compiler: transitive, not declared, resolved 2.6.9, latest 2.7.0, update available",
    );
    expect(report).toContain("package coherence: one compatible toolchain");
  });

  test("reports missing declarations and duplicate foundational versions", () => {
    const issues = packageCoherenceIssues([
      {
        name: "@sf-agentscript/language",
        kind: "direct",
        resolvedVersion: "2.20.0",
        resolvedVersions: ["2.18.0", "2.20.0"],
        loaded: true,
      },
      {
        name: "@sf-agentscript/parser",
        kind: "transitive",
        loaded: false,
      },
    ]);
    expect(issues).toEqual([
      "@sf-agentscript/language is not declared directly",
      "@sf-agentscript/language resolves multiple versions: 2.18.0, 2.20.0",
      "@sf-agentscript/parser is not resolvable",
    ]);
  });
});
