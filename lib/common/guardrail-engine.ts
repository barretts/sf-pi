/* SPDX-License-Identifier: Apache-2.0 */
import { closeSync, constants, fstatSync, openSync, readSync } from "node:fs";
import { globalSettingsPath } from "./sf-pi-settings.ts";

export type GuardrailEngineSelection = "deterministic" | "jev";

/** Error messages and categories never contain settings values, paths, or parse text. */
export class GuardrailConfigError extends Error {
  readonly category: string;

  constructor(category: string) {
    super(`Guardrail configuration blocked: ${category}.`);
    this.category = category;
    this.name = "GuardrailConfigError";
  }
}

export const CONFIG_FILE_LIMIT_BYTES = 256 * 1024;

export function readBoundedGuardrailJsonObject(
  filePath: string,
  source: "settings" | "override" | "bundled",
  optional: boolean,
): Record<string, unknown> | undefined {
  let fd: number;
  try {
    fd = openSync(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  } catch (error) {
    if (optional && (error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw new GuardrailConfigError(`${source}-unreadable`);
  }
  let text: string;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new GuardrailConfigError(`${source}-unreadable`);
    if (stat.size > CONFIG_FILE_LIMIT_BYTES) {
      throw new GuardrailConfigError(`${source}-too-large`);
    }
    const buffer = Buffer.alloc(CONFIG_FILE_LIMIT_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const bytes = readSync(fd, buffer, size, buffer.length - size, null);
      if (!bytes) break;
      size += bytes;
    }
    if (size > CONFIG_FILE_LIMIT_BYTES) {
      throw new GuardrailConfigError(`${source}-too-large`);
    }
    text = buffer.subarray(0, size).toString("utf8");
  } catch (error) {
    if (error instanceof GuardrailConfigError) throw error;
    throw new GuardrailConfigError(`${source}-unreadable`);
  } finally {
    closeSync(fd);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    rejectGuardrailJsonDuplicateKeys(text);
  } catch {
    throw new GuardrailConfigError(`${source}-invalid-json`);
  }
  if (!settingsObject(parsed)) throw new GuardrailConfigError(`${source}-invalid-schema`);
  return parsed as Record<string, unknown>;
}

/** Called after JSON syntax validation, before a selector or policy is trusted. */
export function rejectGuardrailJsonDuplicateKeys(text: string): void {
  const containers: Array<Set<string> | null> = [];
  for (const match of text.matchAll(/"(?:\\.|[^"\\])*"|[{}[\]]/g)) {
    const token = match[0];
    if (token === "{") containers.push(new Set());
    else if (token === "[") containers.push(null);
    else if (token === "}" || token === "]") containers.pop();
    else {
      let next = match.index + token.length;
      while (/\s/.test(text[next] ?? "")) next += 1;
      if (text[next] !== ":") continue;
      const keys = containers.at(-1);
      const key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error("Guardrail JSON has duplicate keys.");
      keys.add(key);
    }
  }
}

function settingsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Both callers select the engine from the same bounded raw settings. */
export function readGuardrailEngineSettings(): {
  engine: GuardrailEngineSelection;
  raw: Record<string, unknown>;
} {
  const root = readBoundedGuardrailJsonObject(globalSettingsPath(), "settings", true) ?? {};
  if (root.sfPi !== undefined && !settingsObject(root.sfPi)) {
    throw new GuardrailConfigError("settings-invalid-schema");
  }
  const sfPi = (root.sfPi ?? {}) as Record<string, unknown>;
  const raw = sfPi.guardrail === undefined ? {} : sfPi.guardrail;
  if (
    !settingsObject(raw) ||
    (raw.engine !== undefined && raw.engine !== "deterministic" && raw.engine !== "jev")
  ) {
    throw new GuardrailConfigError("settings-invalid-schema");
  }
  return { engine: raw.engine === "jev" ? "jev" : "deterministic", raw };
}
