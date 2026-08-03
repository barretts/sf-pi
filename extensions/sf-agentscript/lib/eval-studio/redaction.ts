/* SPDX-License-Identifier: Apache-2.0 */
/** Bounded default masking for Studio projections and reports. */

import { redactDisplayText } from "../../../../lib/common/redaction.ts";
import { redactSensitiveLiterals } from "../eval/seeds.ts";

const SENSITIVE_KEY =
  /(?:token|secret|password|authorization|cookie|session[_-]?id|prompt_content|raw_prompt|action_(?:input|output|payload))/i;
const SENSITIVE_QUERY = /^(?:sid|session|session_id|token|access_token|auth|authorization)$/i;

function redactUrl(value: string): string {
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY.test(key)) url.searchParams.set(key, "[REDACTED]");
    }
    return url.toString();
  } catch {
    return value;
  }
}

export interface StudioRedactionContext {
  sensitiveNames?: ReadonlySet<string>;
  sensitiveValues?: ReadonlySet<string>;
}

export function redactStudioValue(
  value: unknown,
  key = "",
  context: StudioRedactionContext = {},
): unknown {
  if (SENSITIVE_KEY.test(key) || context.sensitiveNames?.has(key)) return "[REDACTED]";
  if (typeof value === "string") {
    const redacted = redactDisplayText(redactUrl(value)).replace(
      /\b(token|secret|password|session[_-]?id)\b\s*[:=]\s*[^\s,}\]]+/gi,
      "$1: [REDACTED]",
    );
    return redactSensitiveLiterals(redacted, context.sensitiveValues ?? new Set());
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactStudioValue(entry, "", context));
  }
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const isContextVariable = typeof record.name === "string" && "value" in record;
  return Object.fromEntries(
    Object.entries(record).map(([childKey, child]) => [
      childKey,
      isContextVariable && childKey === "value"
        ? "[REDACTED]"
        : redactStudioValue(child, childKey, context),
    ]),
  );
}
