/* SPDX-License-Identifier: Apache-2.0 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeEndpoint, resolveEndpoint, resolveTokenCandidates } from "../lib/auth.ts";

afterEach(() => vi.unstubAllEnvs());

describe("sf-docs auth", () => {
  it("resolves pi auth before env", () => {
    expect(resolveTokenCandidates({ piAuthToken: "pi", envToken: "env" })).toEqual({
      source: "pi-auth",
      token: "pi",
    });
  });

  it("falls back to env token", () => {
    expect(resolveTokenCandidates({ piAuthToken: "", envToken: "env" })).toEqual({
      source: "env",
      token: "env",
    });
  });

  it("normalizes endpoints and rejects unsafe credential destinations", () => {
    expect(normalizeEndpoint("https://mcp.docs.salesforce.com")).toEqual({
      ok: true,
      endpoint: "https://mcp.docs.salesforce.com/",
    });
    expect(normalizeEndpoint("https://user:pass@example.test/")).toEqual({
      ok: false,
      error: "SF_DOCS_MCP_ENDPOINT must not include username or password.",
    });
    expect(normalizeEndpoint("http://example.test/")).toEqual({
      ok: false,
      error: "SF_DOCS_MCP_ENDPOINT must use HTTPS unless the host is loopback.",
    });
    expect(normalizeEndpoint("http://127.0.0.1:8787/")).toEqual({
      ok: true,
      endpoint: "http://127.0.0.1:8787/",
      warning: "SF_DOCS_MCP_ENDPOINT is using loopback HTTP.",
    });
  });

  it("fails closed when an endpoint override is invalid", () => {
    vi.stubEnv("SF_DOCS_MCP_ENDPOINT", "not-a-url");
    expect(resolveEndpoint()).toEqual({
      ok: false,
      source: "env",
      error: "SF_DOCS_MCP_ENDPOINT is not a valid URL.",
    });
  });
});
