/* SPDX-License-Identifier: Apache-2.0 */
/** Shared redaction for runtime errors and arbitrary Canvas API return values. */
import os from "node:os";

const SECRET_KEY_RE = /(?:token|secret|password|authorization|cookie|sfdx.?auth.?url)/i;

export function sanitizeRuntimeText(value: string): string {
  const home = os.homedir();
  return value
    .replace(
      /\b(Bearer|Basic)\s+[A-Za-z0-9+/=._~:-]+/gi,
      (_match, scheme: string) => `${scheme} [REDACTED]`,
    )
    .replace(/((?:token|secret|password|authorization)\s*[=:]\s*)[^\s,;"}]+/gi, "$1[REDACTED]")
    .replace(/("(?:token|secret|password|authorization)"\s*:\s*")[^"]*(")/gi, "$1[REDACTED]$2")
    .replace(/https?:\/\/[^\s"'<>]+/gi, "[URL]")
    .replace(/\b00D[A-Za-z0-9]{12,15}\b/g, "[ORG_ID]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[EMAIL]")
    .replaceAll(home, "~")
    .replace(/(?:^|\s)(\/(?:Users|home|private|var|tmp)\/[^\s,;"'}]+)/g, " [PATH]")
    .replace(/[A-Za-z]:\\(?:[^\s,;"'}]+\\)*[^\s,;"'}]+/g, "[PATH]");
}

export function sanitizeRuntimeValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (typeof value === "string") return sanitizeRuntimeText(value).slice(0, 4000);
  if (Array.isArray(value))
    return value.slice(0, 200).map((item) => sanitizeRuntimeValue(item, depth + 1));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    if (SECRET_KEY_RE.test(key)) result[key] = "[REDACTED]";
    else if (key === "filePath" || key === "requestLogPath" || key === "scriptDir")
      result[key] = "[PATH]";
    else result[key] = sanitizeRuntimeValue(child, depth + 1);
  }
  return result;
}
