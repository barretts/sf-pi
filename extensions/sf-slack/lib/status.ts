/* SPDX-License-Identifier: Apache-2.0 */
/** Pure Slack status helpers shared by the runtime footer and tests. */
import type { SlackStatusKind } from "../../../lib/common/slack-status/store.ts";
import type { SlackTokenType } from "./api.ts";

export interface SlackFooterTheme {
  fg(color: string, text: string): string;
}

export interface SlackFooterStatusInput {
  icon: string;
  kind: SlackStatusKind;
  tokenType: SlackTokenType;
}

export function classifySlackStatus(input: {
  state: "loading" | "connected" | "disconnected" | "error";
  grantedScopeCount: number;
  requestedScopeCount: number;
  missingGrantedScopeCount: number;
}): SlackStatusKind {
  switch (input.state) {
    case "loading":
      return "loading";
    case "disconnected":
      return "not-configured";
    case "error":
      return "auth-error";
    case "connected":
      if (input.missingGrantedScopeCount > 0) return "partial-grant";
      if (input.requestedScopeCount > 0 && input.grantedScopeCount >= input.requestedScopeCount) {
        return "ready";
      }
      return "scopes-unknown";
  }
}

export function slackStatusLabel(kind: SlackStatusKind): string {
  switch (kind) {
    case "ready":
    case "partial-grant":
      return "✓ Connected";
    case "scopes-unknown":
      return "? Scopes unknown";
    case "loading":
      return "connecting…";
    case "not-configured":
      return "○ Not configured";
    case "auth-error":
      return "✗ Auth error";
    case "hidden":
      return "";
  }
}

/**
 * Render a calm, adaptive footer pill.
 *
 * Identity, raw token type, and scope counts belong in `/sf-slack`. The
 * persistent footer stays compact when healthy and adds only the qualifier
 * needed to explain degraded capability.
 */
export function formatSlackFooterStatus(
  input: SlackFooterStatusInput,
  theme: SlackFooterTheme,
): string | null {
  if (input.kind === "hidden" || input.kind === "not-configured") return null;

  const prefix = `${input.icon} ${theme.fg("dim", "Slack")}`;
  if (input.kind === "loading") return `${prefix} ${theme.fg("dim", "connecting…")}`;
  if (input.kind === "auth-error") return `${prefix} ${theme.fg("error", "✗ Auth error")}`;

  // Token constraints outrank scope qualifiers: bot tokens can authenticate
  // but cannot perform user-token write actions; app/unknown tokens are not a
  // supported runtime posture for this integration.
  if (input.tokenType === "app" || input.tokenType === "unknown") {
    return `${prefix} ${theme.fg("warning", "! Unsupported token")}`;
  }

  const connected = theme.fg("success", "✓ Connected");
  if (input.tokenType === "bot") {
    return `${prefix} ${connected} ${theme.fg("warning", "· bot token")}`;
  }
  if (input.kind === "partial-grant") {
    return `${prefix} ${connected} ${theme.fg("warning", "· limited")}`;
  }
  if (input.kind === "scopes-unknown") {
    return `${prefix} ${theme.fg("warning", "? Scopes unknown")}`;
  }
  return `${prefix} ${connected}`;
}
