/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for read-only gateway onboarding source discovery. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectUsableCaBundlePaths,
  discoverGatewayOnboardingSources,
  extractNodeExtraCaCertsValues,
  findShellOnlyNodeExtraCaCerts,
} from "../lib/onboarding-sources.ts";

const SAMPLE_PEM_BODY = [
  "-----BEGIN CERTIFICATE-----",
  "MIIDATCCAemgAwIBAgIUPz2FMRbJU+d+Mc+WDfHyd7vXkbEwDQYJKoZIhvcNAQEL",
  "BQAwDzENMAsGA1UEAwwEdGVzdDAgFw0yNjA1MTcxNTMyMDNaGA8yMTI2MDQyMzE1",
  "MzIwM1owDzENMAsGA1UEAwwEdGVzdDCCASIwDQYJKoZIhvcNAQEBBQADggEPADCC",
  "AQoCggEBALKrZF3OtNbvCh3F+KhOIDlxfoDNzn+kICT/t+25l+FK7tV/6QscJqha",
  "/OkGPYC4G5eT5P5ulQqL5wFirT7TszUdQ3ZXBljU44QfgtBvFm3bA5MD6C76TIVS",
  "O6xIqNPuGm26BbMTJshHgigWLsUzqVjb5KplVJxK2fH0AZ4vDi3HjaxQeadkhYYJ",
  "t9PYyqTw1sw8MSZgQo7qAPKWCx13mewnX39H3J/5piqLuamjhk/LwbrV8HdqX25L",
  "lIydsMyYct9tYFsXt+z2BMA0w3zQ6yLwgpk5IJhwqULPaT8waO2CJzrNyMfQ4xxm",
  "FjQ9wvWxIJ1iMcCtJAlrHI9CwvBESfcCAwEAAaNTMFEwHQYDVR0OBBYEFKG+C8C8",
  "4NMJ/XJumoMHyOBw3FOvMB8GA1UdIwQYMBaAFKG+C8C84NMJ/XJumoMHyOBw3FOv",
  "MA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAIwzxmG8Zonbpy9t",
  "HD3hQIr/Ha+zAAT5kW95PmLyKAWm0CXCEvkTvBStY5xJViIsyuempRGwf/izQorB",
  "cdUyHvs8Ik1gKBRk2+NKUHIoRIDk7rRRkoP0muK3/8cb7UDZu5ktZKdXRM8UGCaV",
  "hkHTuHeNv4ZnOhqRiZ9EGD/X0MK57c8N+yRdUA0X2CbcxZIelT0IV/T6aqTuMlcm",
  "MYWWGz9BXgf6x04mE4OboCKUK89EybCGDo0y0hPXwSpyHp/oLYyF4hZjrcPalONd",
  "YwK+rexE7q4QRgJUuk0NkKcmNYsHD1UfpcgjcGvUBzmKZuZs1JXVJCzTtMMLsW/m",
  "YqneP1s=",
  "-----END CERTIFICATE-----",
  "",
].join("\n");

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(path.join(os.tmpdir(), "sf-pi-onboarding-sources-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("extractNodeExtraCaCertsValues", () => {
  it("parses quoted, unquoted, and exported NODE_EXTRA_CA_CERTS assignments", () => {
    expect(
      extractNodeExtraCaCertsValues(
        [
          'export NODE_EXTRA_CA_CERTS="~/.devbar/conf/internal.pem"',
          "NODE_EXTRA_CA_CERTS=/tmp/ca.pem # comment",
          "  NODE_EXTRA_CA_CERTS='~/.claude/certs/root.pem'",
        ].join("\n"),
      ),
    ).toEqual(["~/.devbar/conf/internal.pem", "/tmp/ca.pem", "~/.claude/certs/root.pem"]);
  });
});

describe("discoverGatewayOnboardingSources", () => {
  it("finds Claude Code credentials without exposing the raw token", () => {
    const settingsPath = path.join(tmpDir, ".claude", "settings.json");
    mkdirSync(path.dirname(settingsPath), { recursive: true });
    writeFileSync(
      settingsPath,
      JSON.stringify({
        env: {
          ANTHROPIC_BASE_URL: "https://gateway.example.com/v1",
          ANTHROPIC_AUTH_TOKEN: "secret-token-1234567890",
        },
      }),
    );

    const discovery = discoverGatewayOnboardingSources({ home: tmpDir, cwd: tmpDir });
    const candidate = discovery.credentialCandidates.find(
      (entry) => entry.sourceId === "claude-code",
    );

    expect(candidate?.baseUrl).toBe("https://gateway.example.com");
    expect(candidate?.apiKeyPresent).toBe(true);
    expect(JSON.stringify(candidate)).not.toContain("secret-token-1234567890");
  });

  it("adopts NODE_EXTRA_CA_CERTS from ~/.zshrc and flags it as shell-only", () => {
    const pemPath = path.join(tmpDir, ".devbar", "custom.pem");
    mkdirSync(path.dirname(pemPath), { recursive: true });
    writeFileSync(pemPath, SAMPLE_PEM_BODY);
    writeFileSync(path.join(tmpDir, ".zshrc"), `export NODE_EXTRA_CA_CERTS="${pemPath}"\n`);

    const discovery = discoverGatewayOnboardingSources({ home: tmpDir, cwd: tmpDir });
    const shellFinding = discovery.nodeExtraCaCertsFindings.find(
      (entry) => entry.location === "~/.zshrc",
    );

    expect(shellFinding?.path).toBe(pemPath);
    expect(shellFinding?.validPem).toBe(true);
    expect(collectUsableCaBundlePaths(discovery)).toContain(pemPath);
    expect(findShellOnlyNodeExtraCaCerts(discovery).map((entry) => entry.path)).toContain(pemPath);
  });

  it("bounds PEM discovery to known tool directories such as ~/.devbar and ~/.claude", () => {
    const devbarPem = path.join(tmpDir, ".devbar", "custom-root.pem");
    const claudePem = path.join(tmpDir, ".claude", "certs", "team-root.pem");
    mkdirSync(path.dirname(devbarPem), { recursive: true });
    mkdirSync(path.dirname(claudePem), { recursive: true });
    writeFileSync(devbarPem, SAMPLE_PEM_BODY);
    writeFileSync(claudePem, SAMPLE_PEM_BODY);

    const discovery = discoverGatewayOnboardingSources({ home: tmpDir, cwd: tmpDir });
    const usable = collectUsableCaBundlePaths(discovery);

    expect(usable).toContain(devbarPem);
    expect(usable).toContain(claudePem);
  });
});
