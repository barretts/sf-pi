/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Status-only Pi auth-store inspection.
 *
 * Execution paths should use `ctx.modelRegistry.getApiKeyForProvider()` so Pi
 * owns credential retrieval. This helper exists for config/status surfaces that
 * do not receive an ExtensionContext. It intentionally reports only whether a
 * provider appears configured; it never returns token values.
 */
import { existsSync } from "node:fs";
import { readStoredCredential } from "@earendil-works/pi-coding-agent";
import { globalAgentPath } from "./pi-paths.ts";

export type PiAuthProviderStatusSource = "pi-auth-store" | "missing";

export interface PiAuthProviderStatus {
  provider: string;
  configured: boolean;
  source: PiAuthProviderStatusSource;
}

export function getPiAuthStorePath(): string {
  return globalAgentPath("auth.json");
}

export function readPiAuthProviderStatus(
  provider: string,
  authPath: string = getPiAuthStorePath(),
): PiAuthProviderStatus {
  if (!existsSync(authPath)) return { provider, configured: false, source: "missing" };

  const credential = readStoredCredential(provider, authPath);
  return { provider, configured: credential !== undefined, source: "pi-auth-store" };
}
