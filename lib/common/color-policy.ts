/* SPDX-License-Identifier: Apache-2.0 */
/** Shared presence-based NO_COLOR policy for SF Pi-owned ANSI rendering. */

const ANSI_ESCAPE = String.fromCharCode(27);
const ANSI_SGR_PATTERN = new RegExp(`${ANSI_ESCAPE}\\[[0-9;]*m`, "g");

export function colorsEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NO_COLOR === undefined;
}

export function stripAnsiSgr(value: string): string {
  return value.replace(ANSI_SGR_PATTERN, "");
}

export function stripAnsiIfNoColor(
  value: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string {
  return colorsEnabled(environment) ? value : stripAnsiSgr(value);
}
