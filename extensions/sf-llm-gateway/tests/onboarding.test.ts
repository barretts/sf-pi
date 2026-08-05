/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for the stable gateway onboarding URL builder. */
import { describe, expect, it } from "vitest";
import { buildOnboardingUrl, OnboardingTarget } from "../lib/onboarding.ts";

describe("buildOnboardingUrl", () => {
  it("returns an empty string when base URL is missing", () => {
    expect(buildOnboardingUrl(undefined)).toBe("");
    expect(buildOnboardingUrl("")).toBe("");
  });

  it("strips the public /v1 suffix and returns the gateway root", () => {
    expect(buildOnboardingUrl("https://gateway.example.com/v1")).toBe(
      "https://gateway.example.com",
    );
  });

  it("does not build deployment-specific OAuth or UI deep links", () => {
    const url = buildOnboardingUrl("https://gateway.example.com");
    expect(url).toBe("https://gateway.example.com");
    expect(url).not.toContain("/oauth2/start");
    expect(url).not.toContain("page=api-keys");
  });

  it("ignores historical explicit targets for root-only navigation", () => {
    expect(buildOnboardingUrl("https://gateway.example.com", OnboardingTarget.ApiKeys)).toBe(
      "https://gateway.example.com",
    );
  });
});
