/* SPDX-License-Identifier: Apache-2.0 */
import { createHash } from "node:crypto";

/** Hash complete local inputs without invoking custom serializers or losing key order. */
export function guardrailCanonicalJson(value: unknown): string {
  let nodes = 0;
  const seen = new Set<object>();
  function visit(item: unknown, depth: number): unknown {
    if (++nodes > 4096 || depth > 32) throw new Error("invalid-input");
    if (item === null || typeof item === "boolean" || typeof item === "string") return item;
    if (typeof item === "number" && Number.isFinite(item)) return item;
    if (typeof item !== "object" || !item || seen.has(item)) throw new Error("invalid-input");
    seen.add(item);
    try {
      if (Array.isArray(item)) return item.map((entry) => visit(entry, depth + 1));
      if (
        Object.getPrototypeOf(item) !== Object.prototype &&
        Object.getPrototypeOf(item) !== null
      ) {
        throw new Error("invalid-input");
      }
      const result: Record<string, unknown> = Object.create(null);
      for (const key of Object.keys(item).sort()) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !("value" in descriptor)) throw new Error("invalid-input");
        result[key] = visit(descriptor.value, depth + 1);
      }
      return result;
    } finally {
      seen.delete(item);
    }
  }
  const json = JSON.stringify(visit(value, 0));
  if (Buffer.byteLength(json) > 4 * 1024 * 1024) throw new Error("invalid-input");
  return json;
}

export function guardrailInputHash(value: unknown): string {
  return createHash("sha256").update(guardrailCanonicalJson(value)).digest("hex");
}
