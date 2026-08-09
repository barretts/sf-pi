/* SPDX-License-Identifier: Apache-2.0 */
/** Unit tests for Slack runtime status classification and compact footer rendering. */
import { describe, expect, it } from "vitest";
import { classifySlackStatus, formatSlackFooterStatus, slackStatusLabel } from "../lib/status.ts";

const plainTheme = {
  fg: (_color: string, text: string) => text,
};

describe("Slack status classification", () => {
  it("marks full granted scopes as ready", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 26,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 0,
    });

    expect(kind).toBe("ready");
    expect(slackStatusLabel(kind)).toBe("✓ Connected");
  });

  it("marks missing scopes as a partial grant while staying connected", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 0,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 26,
    });

    expect(kind).toBe("partial-grant");
    expect(slackStatusLabel(kind)).toBe("✓ Connected");
  });

  it("marks zero granted scopes with no diff as scopes unknown", () => {
    const kind = classifySlackStatus({
      state: "connected",
      grantedScopeCount: 0,
      requestedScopeCount: 26,
      missingGrantedScopeCount: 0,
    });

    expect(kind).toBe("scopes-unknown");
    expect(slackStatusLabel(kind)).toBe("? Scopes unknown");
  });
});

describe("compact Slack footer status", () => {
  const render = (
    kind: Parameters<typeof formatSlackFooterStatus>[0]["kind"],
    tokenType: Parameters<typeof formatSlackFooterStatus>[0]["tokenType"] = "user",
  ) => formatSlackFooterStatus({ icon: "💬", kind, tokenType }, plainTheme);

  it("keeps the healthy user-token state compact", () => {
    const status = render("ready");

    expect(status).toBe("💬 Slack ✓ Connected");
    expect(status).not.toMatch(/@|\[user\]|scope/i);
  });

  it("adds only a limited qualifier for partial grants", () => {
    expect(render("partial-grant")).toBe("💬 Slack ✓ Connected · limited");

    const themed = formatSlackFooterStatus(
      { icon: "💬", kind: "partial-grant", tokenType: "user" },
      { fg: (color, text) => `[${color}:${text}]` },
    );
    expect(themed).toContain("[success:✓ Connected]");
    expect(themed).toContain("[warning:· limited]");
  });

  it("surfaces non-user token constraints without identity or scope counts", () => {
    expect(render("ready", "bot")).toBe("💬 Slack ✓ Connected · bot token");
    expect(render("partial-grant", "bot")).toBe("💬 Slack ✓ Connected · bot token");
    expect(render("ready", "app")).toBe("💬 Slack ! Unsupported token");
    expect(render("ready", "unknown")).toBe("💬 Slack ! Unsupported token");
  });

  it("keeps unknown scopes and auth failures actionable", () => {
    expect(render("scopes-unknown")).toBe("💬 Slack ? Scopes unknown");
    expect(render("auth-error")).toBe("💬 Slack ✗ Auth error");
  });

  it("keeps unconfigured and hidden Slack out of the footer", () => {
    expect(render("not-configured")).toBeNull();
    expect(render("hidden")).toBeNull();
  });
});
