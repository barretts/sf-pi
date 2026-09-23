/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Mechanical command/policy projection. Fresh local labels expose equality and
 * finite delimiter-prefix relations, never a raw dictionary or a match result.
 * The grammar intentionally follows command-gate's legacy tokenizer, including
 * its flattened command boundaries and wrapper quirks. Jev interprets the rows.
 */
import { tokenizeSimpleCommands, type TokenizedCommand } from "./bash-ast.ts";
import { resolveRuleBehavior } from "./rule-behavior.ts";
import type { CommandGateConfig, CommandPattern } from "./types.ts";

const MAX_SOURCE_CHARS = 128 * 1024;
const MAX_PARSE_WORK = 512 * 1024;
const MAX_VIEWS = 256;
const MAX_POSITIONS = 4096;
const MAX_CLASSES = 2048;
const MAX_ROWS = 256;
const MAX_CONTEXT_BYTES = 24 * 1024;
const SHELLS = new Set(["bash", "sh", "zsh"]);
const WRAPPERS = new Set(["sudo", "env", "timeout", "nohup", "nice", "time", "watch"]);
const PI_WRAPPERS = {
  env: { values: ["-u", "--unset", "-C", "--chdir"], assignments: true },
  timeout: { values: ["-k", "--kill-after", "-s", "--signal"], skip: 1 },
  sudo: {
    values: [
      "-u",
      "--user",
      "-g",
      "--group",
      "-h",
      "--host",
      "-p",
      "--prompt",
      "-C",
      "--close-from",
      "-T",
      "--command-timeout",
      "-R",
      "--chroot",
      "-D",
      "--chdir",
    ],
    assignments: true,
  },
  nice: { values: ["-n", "--adjustment"] },
  time: { values: ["-o", "--output", "-f", "--format"] },
  watch: { values: ["-n", "--interval"] },
  nohup: {},
  command: {},
} as Record<string, { values?: string[]; assignments?: boolean; skip?: number }>;

const basename = (value: string) => value.slice(value.lastIndexOf("/") + 1);
const executable = (value: string) => basename(value).replace(/^[({]+|[)}]+$/g, "");
const assignment = (value: string) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(value);

/** No dictionary survives this call. Unsupported shapes reject atomically. */
export function buildJevCommandTokenContext(
  command: string,
  gate: CommandGateConfig,
  options: { publicWords?: readonly string[] } = {},
): Record<string, unknown> {
  try {
    if (typeof command !== "string" || command.length > MAX_SOURCE_CHARS) throw new Error();
    let parseWork = 0;
    let grammarCalls = 0;
    let positions = 0;
    const parse = (source: string): TokenizedCommand[] => {
      parseWork += source.length;
      if (parseWork > MAX_PARSE_WORK) throw new Error();
      const views = tokenizeSimpleCommands(source).map((item) => item.tokens);
      if (views.length > MAX_VIEWS) throw new Error();
      return views;
    };
    const original = parse(command);
    // Baseline's zero-token substring fallback cannot be represented by labels.
    if (original.length === 0) throw new Error();
    const expanded: TokenizedCommand[] = [];
    const expand = (view: TokenizedCommand, depth: number) => {
      expanded.push(view);
      if (expanded.length > MAX_VIEWS) throw new Error();
      if (depth > 3) return;
      let nested: TokenizedCommand[] = [];
      if (SHELLS.has(view.head)) {
        const index = view.args.indexOf("-c");
        const script = index >= 0 ? view.args[index + 1] : undefined;
        if (script) nested = parse(script);
      } else if (view.head === "eval") {
        nested = parse(view.args.join(" "));
      } else if (view.head === "xargs" || WRAPPERS.has(view.head)) {
        const index = view.args.findIndex(
          (arg) => !arg.startsWith("-") && (view.head === "xargs" || !arg.includes("=")),
        );
        if (index >= 0) {
          nested = [{ head: basename(view.args[index] ?? ""), args: view.args.slice(index + 1) }];
        }
      }
      for (const child of nested) expand(child, depth + 1);
    };
    for (const view of original) expand(view, 0);

    // Tool identity/option parsing only: credential-output predicates stay in Jev.
    const piFromScript = (script: string, depth: number): string[] | undefined => {
      for (const view of parse(script)) {
        const args = piArgs(view, depth + 1);
        if (args) return args; // Legacy grammar chooses the first Pi invocation.
      }
      return undefined;
    };
    const piArgs = (view: TokenizedCommand, depth = 0): string[] | undefined => {
      grammarCalls += 1;
      if (depth > 32 || grammarCalls > MAX_POSITIONS) throw new Error();
      const head = executable(view.head);
      if (head === "pi" || view.head === "$PI" || view.head === "${PI}") return view.args;
      if (head === "npx") {
        for (let index = 0; index < view.args.length; index += 1) {
          const arg = view.args[index] ?? "";
          if (arg === "--") continue;
          if (arg === "--call" || arg === "-c") {
            const script = view.args[index + 1];
            return script ? piFromScript(script, depth + 1) : undefined;
          }
          if (["--package", "-p", "--node-options"].includes(arg)) {
            index += 1;
            continue;
          }
          if (arg.startsWith("-")) continue;
          const packageName = "@earendil-works/pi-coding-agent";
          return arg === packageName ||
            arg.startsWith(`${packageName}@`) ||
            executable(arg) === "pi"
            ? view.args.slice(index + 1)
            : undefined;
        }
        return undefined;
      }
      if (SHELLS.has(head)) {
        const index = view.args.indexOf("-c");
        const script = index >= 0 ? view.args[index + 1] : undefined;
        return script ? piFromScript(script, depth + 1) : undefined;
      }
      if (head === "eval") return piFromScript(view.args.join(" "), depth + 1);
      let index: number | undefined;
      if (view.head === "{" || view.head === "(") index = 0;
      else {
        const wrapper = assignment(view.head)
          ? { assignments: true, values: [] as string[], skip: 0 }
          : PI_WRAPPERS[head];
        if (!wrapper) return undefined;
        let options = true;
        let skip = wrapper.skip ?? 0;
        for (let cursor = 0; cursor < view.args.length; cursor += 1) {
          const arg = view.args[cursor] ?? "";
          if (options && arg === "--") {
            options = false;
            continue;
          }
          if (wrapper.assignments && assignment(arg)) continue;
          if (options && wrapper.values?.includes(arg)) {
            cursor += 1;
            continue;
          }
          if (options && arg.startsWith("-")) continue;
          if (skip > 0) {
            skip -= 1;
            continue;
          }
          index = cursor;
          break;
        }
      }
      const word = index === undefined ? undefined : view.args[index];
      return word && index !== undefined
        ? piArgs({ head: executable(word), args: view.args.slice(index + 1) }, depth + 1)
        : undefined;
    };
    const piViews = expanded.map((view) => piArgs(view)).filter((args) => args !== undefined);

    const whole = new Map<string, number>();
    const equals = new Map<string, number>();
    const dot = new Map<string, number>();
    const version = new Map<string, number>();
    const classes: Record<string, number>[] = [];
    const label = (map: Map<string, number>, value: string) => {
      const found = map.get(value);
      if (found !== undefined) return found;
      if (map.size >= MAX_CLASSES) throw new Error();
      const id = map.size;
      map.set(value, id);
      return id;
    };
    const token = (value: string) => {
      positions += 1;
      if (positions > MAX_POSITIONS) throw new Error();
      const found = whole.get(value);
      if (found !== undefined) return found;
      const id = label(whole, value);
      const item: Record<string, number> = { id };
      const eq = value.indexOf("=");
      const period = value.indexOf(".");
      const at = value.indexOf("@", value.startsWith("@") ? 1 : 0);
      if (eq >= 0) item.equalsPrefix = label(equals, value.slice(0, eq + 1));
      if (period >= 0) item.dotPrefix = label(dot, value.slice(0, period + 1));
      if (at >= 0) item.versionPrefix = label(version, value.slice(0, at + 1));
      classes.push(item);
      return id;
    };
    const view = (item: TokenizedCommand) => ({
      head: token(item.head),
      args: item.args.map(token),
    });
    const originalLabels = original.map(view);
    const expandedLabels = expanded.map(view);
    const piLabels = piViews.map((args) => args.map(token));
    const descriptors = Object.getOwnPropertyDescriptors(gate);
    let rowCount = 0;
    let patternChars = 0;
    const rows = (key: keyof CommandGateConfig) => {
      const source = descriptors[key]?.value;
      if (!Array.isArray(source)) throw new Error();
      rowCount += source.length;
      if (rowCount > MAX_ROWS) throw new Error();
      const candidates: CommandPattern[] = [];
      for (let index = 0; index < source.length; index += 1) {
        const item = Object.getOwnPropertyDescriptor(source, index);
        if (!item || item.get || item.set || !item.value || typeof item.value !== "object") {
          throw new Error();
        }
        candidates.push(item.value);
      }
      return candidates.map((candidate) => {
        const fields = Object.getOwnPropertyDescriptors(candidate);
        if (Object.values(fields).some((field) => field.get || field.set)) throw new Error();
        const pattern = fields.pattern?.value;
        if (typeof pattern !== "string") throw new Error();
        patternChars += pattern.length;
        if (patternChars > MAX_SOURCE_CHARS) throw new Error();
        const enabled = fields.enabled?.value;
        const behavior = fields.behavior?.value;
        const action = fields.action?.value;
        if (
          (enabled !== undefined && typeof enabled !== "boolean") ||
          (behavior !== undefined && !["off", "confirm", "block"].includes(behavior)) ||
          (action !== undefined && !["confirm", "block"].includes(action))
        )
          throw new Error();
        const resolved = resolveRuleBehavior({ enabled, behavior, action });
        const effective =
          resolved === "off"
            ? "off"
            : key === "allowedPatterns"
              ? "allow"
              : key === "autoDenyPatterns"
                ? "block"
                : resolved;
        const trimmed = pattern.trim();
        const base = { behavior: effective };
        // EXACT sentinels, before ordinary whitespace splitting. No input matching.
        switch (trimmed) {
          case "":
            return { ...base, kind: "empty" };
          case "dd of=":
            return {
              ...base,
              kind: "dd_output",
              head: token("dd"),
              equalsPrefix: label(equals, "of="),
            };
          case "mkfs.*":
            return { ...base, kind: "mkfs", exact: token("mkfs"), dotPrefix: label(dot, "mkfs.") };
          case "remote-script-to-shell":
            return {
              ...base,
              kind: "remote_script_to_shell",
              downloaders: ["curl", "wget"].map(token),
              shells: [...SHELLS].map(token),
            };
          case "base64-decode-to-shell":
            return {
              ...base,
              kind: "base64_decode_to_shell",
              head: token("base64"),
              decodeArgs: ["-d", "--decode"].map(token),
              shells: [...SHELLS].map(token),
            };
          case "pi-auth-credential-output":
            return {
              ...base,
              kind: "pi_credential_output",
              auth: token("auth"),
              check: token("check"),
              credentials: token("--credentials"),
              printActions: ["print-api-key", "print-bearer-token"].map(token),
            };
          case "find -delete":
            return { ...base, kind: "find_delete", head: token("find"), arg: token("-delete") };
          case "find -exec rm":
            return {
              ...base,
              kind: "find_exec_rm",
              head: token("find"),
              exec: token("-exec"),
              rm: token("rm"),
            };
          default:
            return {
              ...base,
              kind: "tokens",
              tokens: trimmed.split(/\s+/).filter(Boolean).map(token),
            };
        }
      });
    };
    const policy = {
      patterns: rows("patterns"),
      allowedPatterns: rows("allowedPatterns"),
      autoDenyPatterns: rows("autoDenyPatterns"),
    };
    // Caller supplies only words already public in known CLI metadata. This
    // validates shape, not secrecy; raw tool arguments must never supply it.
    const optionFields = Object.getOwnPropertyDescriptors(options);
    const publicField = optionFields.publicWords;
    if (publicField?.get || publicField?.set) throw new Error();
    const publicWords = publicField?.value === undefined ? [] : publicField.value;
    if (!Array.isArray(publicWords) || publicWords.length > 256) throw new Error();
    const publicFields = Object.getOwnPropertyDescriptors(publicWords);
    if (Object.values(publicFields).some((field) => field.get || field.set)) throw new Error();
    const publicSeen = new Set<string>();
    const publicSyntax: { word: string; id: number }[] = [];
    for (const word of publicWords) {
      if (typeof word !== "string" || word.length > 128 || !/^[a-zA-Z0-9_.:-]+$/.test(word)) {
        throw new Error();
      }
      if (publicSeen.has(word)) continue;
      publicSeen.add(word);
      publicSyntax.push({ word, id: token(word) });
    }
    const result = {
      operation: {
        version: 1,
        original: originalLabels,
        expanded: expandedLabels,
        flat: expandedLabels.flatMap((item) => [item.head, ...item.args]),
        classes,
        piArgs: piLabels,
        publicSyntax,
      },
      policy,
    };
    if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_CONTEXT_BYTES) throw new Error();
    return result;
  } catch {
    throw new Error("unsupported-command-token-context");
  }
}
