/* SPDX-License-Identifier: Apache-2.0 */
/** Metadata-only boundary. This extracts effects; it never evaluates risk or approval. */
import type { JevToolDescriptor, JevToolMetadata } from "./types.ts";

const INVALID = "Invalid Jev tool metadata.";
const MAX_METADATA_BYTES = 32 * 1024;
const ACTION = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/;
const IDENTIFIER = /^[@a-zA-Z0-9_][@a-zA-Z0-9_.:-]{0,255}$/;
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const FILE_TOOLS = new Set(["read", "write", "edit"]);
const DATA360_TOOLS = new Set([
  "data360_discover",
  "data360_connect",
  "data360_prepare",
  "data360_harmonize",
  "data360_segment",
  "data360_activate",
  "data360_query",
  "data360_semantic",
  "data360_observe",
  "data360_orchestrate",
  "data360_api",
]);
const APEX_ACTIONS = new Set([
  "status",
  "org.preflight",
  "apex.search",
  "test.discover",
  "test.plan",
  "test.suites",
  "coverage.summary",
  "author.plan",
  "diagnose.file",
  "apex.source.get",
  "trace.start",
  "trace.stop",
  "trace.status",
  "log.latest",
  "log.get",
  "log.analyze",
  "log.watch",
  "anon.run",
  "test.run",
  "test.result",
  "test.rerun",
]);
const SOQL_ACTIONS = new Set([
  "status",
  "org.preflight",
  "schema.describe",
  "schema.relationships",
  "schema.search",
  "query.draft",
  "query.validate",
  "query.explain",
  "query.sample",
  "query.run",
  "query.count",
  "query.queryAll",
  "query.export",
  "sosl.run",
  "file.diagnose",
  "lsp.status",
  "history.last",
  "history.rerun",
]);
const AGENT_ACTIONS = new Set([
  "publish",
  "activate",
  "deactivate",
  "list_versions",
  "agent_user_status",
  "diagnose_agent_user",
  "provision_agent_user",
]);
const BOOL_FIELDS = new Set([
  "dry_run",
  "execute",
  "allow_confirmed",
  "allow_mutation",
  "mutation",
  "allow_unbounded",
  "include_deleted",
  "acknowledge_untested_activation",
  "acknowledge_quality_risk",
  "test_only",
  "include_coverage",
  "include_uncovered_lines",
  "include_members",
  "org_wide",
  "include_plan",
]);
const NUMBER_FIELDS = new Set([
  "limit",
  "max_rows",
  "offset",
  "version",
  "duration_minutes",
  "wait_seconds",
  "poll_interval_seconds",
  "threshold_percent",
  "timeout",
  "timeout_ms",
]);
const PATH_FIELDS = new Set([
  "path",
  "file",
  "file_path",
  "output_file",
  "agent_file",
  "release_spec_path",
]);
const PAYLOAD_FIELDS = new Set([
  "body",
  "content",
  "oldText",
  "newText",
  "old_text",
  "new_text",
  "edits",
  "query",
  "sql",
  "filters",
  "order_by",
  "fields",
  "markdown",
  "title",
  "criteria",
  "intent",
  "reason",
  "code",
  "script",
  "transcript",
  "text",
  "payload",
  "headers",
  "credentials",
  "token",
  "password",
  "api_key",
  "authorization",
]);
const TOOL_FIELDS: Record<string, Set<string>> = {
  read: new Set("path file_path offset limit".split(" ")),
  write: new Set("path file_path content".split(" ")),
  edit: new Set("path file_path oldText newText old_text new_text edits".split(" ")),
  bash: new Set("command timeout".split(" ")),
  herdr_pane: new Set("action pane command timeout timeout_ms limit".split(" ")),
  sf_apex: new Set(
    (
      "action target_org target targets query test_only limit intent file body log_id user_id " +
      "duration_minutes wait_seconds poll_interval_seconds allow_mutation include_coverage include_uncovered_lines " +
      "include_members org_wide threshold_percent tests class_names suite_names apex_ids report_formats run_id output_mode"
    ).split(" "),
  ),
  sf_soql: new Set(
    (
      "action target_org query object fields filters order_by intent file output_file format api " +
      "max_rows limit include_plan allow_unbounded include_deleted output_mode"
    ).split(" "),
  ),
  agentscript_lifecycle: new Set(
    (
      "action target_org agent_file agent_api_name release_spec_path " +
      "acknowledge_untested_activation version dry_run acknowledge_quality_risk username_override"
    ).split(" "),
  ),
  slack_canvas: new Set(
    "action canvas_id title markdown channel_id operation section_id criteria".split(" "),
  ),
  sf_browser_click: new Set("ref reason mutation".split(" ")),
  sf_browser_press: new Set("key reason mutation".split(" ")),
};
const DATA360_FIELDS = new Set(
  "action params target_org dry_run allow_confirmed timeout_ms output_mode".split(" "),
);
const DATA360_PARAM_FIELDS = new Set(
  "method path file file_path output_file url destination endpoint body headers query sql limit max_rows offset".split(
    " ",
  ),
);

function invalid(): never {
  throw new Error(INVALID);
}

/** Validate the original input without serializing potentially large file bodies. */
function validate(value: unknown): void {
  const active = new Set<object>();
  let nodes = 0;
  function visit(item: unknown, depth: number): void {
    if (++nodes > 4096 || depth > 32) invalid();
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) invalid();
      return;
    }
    if (typeof item !== "object" || active.has(item)) invalid();
    if (
      !Array.isArray(item) &&
      Object.getPrototypeOf(item) !== Object.prototype &&
      Object.getPrototypeOf(item) !== null
    )
      invalid();
    active.add(item);
    const properties = Object.getOwnPropertyDescriptors(item);
    for (const [key, property] of Object.entries(properties)) {
      if (Array.isArray(item) && key === "length") continue;
      if (!property.enumerable || !("value" in property)) invalid();
      visit(property.value, depth + 1);
    }
    active.delete(item);
  }
  visit(value, 0);
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, pattern: RegExp): string {
  if (typeof value !== "string" || !pattern.test(value)) invalid();
  return value;
}

function pathValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    Buffer.byteLength(value) > 4096 ||
    /[\x00-\x1f\x7f]/.test(value) ||
    /(?:^[a-z][a-z0-9+.-]*:\/\/|\$|`)/i.test(value)
  )
    invalid();
  return value;
}

/** URL userinfo, query, and fragment never cross this boundary. */
function destination(value: unknown): { value: string; omitted: boolean } {
  if (typeof value !== "string" || Buffer.byteLength(value) > 4096) invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    invalid();
  }
  if (!["http:", "https:"].includes(url.protocol)) invalid();
  const omitted = Boolean(url.username || url.password || url.search || url.hash);
  return { value: `${url.protocol}//${url.host}${url.pathname}`, omitted };
}

/** Shape only: schema prose, defaults, examples, const values, and payloads are excluded. */
function parameterShape(parameters: unknown): unknown {
  // TypeBox adds hidden runtime annotations. Project enumerable JSON shape
  // fields directly; do not traverse schema payloads with the raw-input validator.
  const value = (object: unknown, name: string): unknown => {
    if (!record(object)) return undefined;
    const property = Object.getOwnPropertyDescriptor(object, name);
    if (!property?.enumerable) return undefined;
    if (!("value" in property)) invalid();
    return property.value;
  };
  const properties = value(parameters, "properties");
  if (!record(properties)) return undefined;
  const fields = Object.entries(Object.getOwnPropertyDescriptors(properties)).filter(
    ([name, property]) => property.enumerable && ACTION.test(name),
  );
  if (fields.length > 128) invalid();
  const required = new Set<string>();
  const requiredShape = value(parameters, "required");
  if (Array.isArray(requiredShape)) {
    for (const [name, property] of Object.entries(
      Object.getOwnPropertyDescriptors(requiredShape),
    )) {
      if (name === "length" || !property.enumerable) continue;
      if (!("value" in property) || typeof property.value !== "string") invalid();
      required.add(property.value);
    }
  }
  return fields.map(([name, property]) => {
    if (!("value" in property)) invalid();
    const type = value(property.value, "type");
    return {
      name,
      type: ["string", "boolean", "number", "integer", "array", "object", "null"].includes(
        type as string,
      )
        ? type
        : "unspecified",
      required: required.has(name),
    };
  });
}

export function buildJevMetadata(
  toolName: string,
  input: Record<string, unknown>,
  descriptor?: JevToolDescriptor,
): JevToolMetadata {
  try {
    if (descriptor !== undefined && !record(descriptor)) invalid();
    return buildMetadata(toolName, input, descriptor);
  } catch {
    invalid();
  }
}

function buildMetadata(
  toolName: string,
  input: Record<string, unknown>,
  descriptor?: JevToolDescriptor,
): JevToolMetadata {
  text(toolName, /^[a-zA-Z][a-zA-Z0-9_.:-]{0,255}$/);
  if (!record(input)) invalid();
  validate(input);
  const result: JevToolMetadata = { toolName, metadata: {}, omissions: [], complete: true };
  const consumed = new Set<string>();
  const omit = (category: string, incomplete = false) => {
    if (!result.omissions.includes(category)) result.omissions.push(category);
    if (incomplete) result.complete = false;
  };
  if (descriptor) {
    if (
      typeof descriptor.description !== "string" ||
      Buffer.byteLength(descriptor.description) > 4096 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(descriptor.description)
    )
      invalid();
    // Registration prose is data too. Do not forward embedded endpoints or obvious credentials.
    if (
      /https?:\/\/|\bBearer\s+\S+|\b(?:sk|or)-[a-zA-Z0-9-]{12,}|(?:api[_ -]?key|password|token)\s*[:=]\s*\S+/i.test(
        descriptor.description,
      )
    )
      omit("tool_description_withheld");
    else result.description = descriptor.description;
    const shape = parameterShape(descriptor.parameters);
    if (shape) result.metadata.parameterShape = shape;
  } else omit("tool_description_unavailable");

  const known =
    FILE_TOOLS.has(toolName) ||
    toolName === "bash" ||
    toolName === "herdr_pane" ||
    ["sf_apex", "sf_soql", "agentscript_lifecycle", "slack_canvas"].includes(toolName) ||
    DATA360_TOOLS.has(toolName) ||
    ["sf_browser_click", "sf_browser_press"].includes(toolName);
  if (!known) omit("unfamiliar_tool_effects", true);
  const put = (key: string, value: unknown) => {
    result.metadata[key] = value;
    consumed.add(key);
  };
  const paths: string[] = [];
  const fields = (object: Record<string, unknown>, nested = false) => {
    const output: Record<string, unknown> = {};
    const schemaFields = DATA360_TOOLS.has(toolName)
      ? nested
        ? DATA360_PARAM_FIELDS
        : DATA360_FIELDS
      : TOOL_FIELDS[toolName];
    for (const [key, value] of Object.entries(object)) {
      if (schemaFields && !schemaFields.has(key)) {
        omit("unknown_fields_withheld", true);
        continue;
      }
      if (BOOL_FIELDS.has(key)) {
        if (typeof value !== "boolean") invalid();
        output[key] = value;
      } else if (NUMBER_FIELDS.has(key)) {
        if (typeof value !== "number" || !Number.isFinite(value)) invalid();
        output[key] = value;
      } else if (PATH_FIELDS.has(key)) {
        const path = pathValue(value);
        const apiRoute = DATA360_TOOLS.has(toolName) && key === "path";
        if (apiRoute) {
          output[key] = path.split(/[?#]/, 1)[0];
          if (output[key] !== path) omit("destination_components_withheld", true);
        } else {
          output[key] = path;
          paths.push(path);
        }
      } else if (["action", "operation"].includes(key)) output[key] = text(value, ACTION);
      else if (key === "method") {
        if (typeof value !== "string" || !HTTP_METHODS.has(value.toUpperCase())) invalid();
        output[key] = value.toUpperCase();
      } else if (key === "target_org") {
        if (typeof value !== "string" || !value || value.length > 1024) invalid();
        output[key] = "explicit";
      } else if (["url", "destination", "endpoint"].includes(key)) {
        const target = destination(value);
        output[key] = target.value;
        if (target.omitted) omit("destination_components_withheld", true);
      } else if (
        [
          "agent_api_name",
          "canvas_id",
          "channel_id",
          "section_id",
          "ref",
          "pane",
          "object",
        ].includes(key)
      ) {
        output[key] = text(value, IDENTIFIER);
      } else if (["format", "api", "output_mode"].includes(key)) {
        const enums =
          key === "format"
            ? ["csv", "json", "raw_json", "flattened_json"]
            : key === "api"
              ? ["rest", "tooling"]
              : ["summary", "inline", "file_only"];
        if (typeof value !== "string" || !enums.includes(value)) invalid();
        output[key] = value;
      } else if (key === "key" && toolName === "sf_browser_press") {
        output[key] = text(
          value,
          /^(?:(?:Control|Ctrl|Meta|Command|Cmd|Alt|Shift)\+)*(?:Enter|NumpadEnter|Escape|Tab|Space|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|[a-z0-9])$/i,
        );
      } else if (PAYLOAD_FIELDS.has(key)) {
        const ordinaryFileBody =
          FILE_TOOLS.has(toolName) &&
          ["content", "body", "oldText", "newText", "old_text", "new_text", "edits"].includes(key);
        if (ordinaryFileBody && key !== "edits" && typeof value !== "string") invalid();
        if (
          ["sf_apex", "sf_soql", "slack_canvas", "sf_browser_click", "sf_browser_press"].includes(
            toolName,
          ) &&
          ["query", "body", "markdown", "title", "reason"].includes(key) &&
          typeof value !== "string"
        )
          invalid();
        omit(ordinaryFileBody ? "file_body_withheld" : "payload_withheld", !ordinaryFileBody);
      } else if (!nested && key === "params" && DATA360_TOOLS.has(toolName)) {
        if (!record(value)) invalid();
        output.params = fields(value, true);
      } else if (!nested && key === "command" && ["bash", "herdr_pane"].includes(toolName)) {
        const shell = shellMetadata(value);
        output.shell = shell.metadata;
        paths.push(...shell.paths);
        if (!shell.complete) omit("shell_effects_opaque", true);
        if (shell.withheld) omit("shell_values_withheld");
        if (shell.targetOrg) output.target_org = "explicit";
      } else omit("unknown_fields_withheld", true);
      if (!nested) consumed.add(key);
    }
    return output;
  };
  Object.assign(result.metadata, fields(input));
  if (paths.length) put("paths", [...new Set(paths)]);
  if (FILE_TOOLS.has(toolName) && !["path", "file_path"].some((key) => consumed.has(key)))
    invalid();
  if (toolName === "write" && !consumed.has("content")) invalid();
  if (
    toolName === "edit" &&
    !consumed.has("edits") &&
    !(consumed.has("oldText") && consumed.has("newText")) &&
    !(consumed.has("old_text") && consumed.has("new_text"))
  )
    invalid();
  if (toolName === "bash" && !consumed.has("command")) invalid();
  if (toolName === "herdr_pane" && input.action === "run" && !consumed.has("command")) invalid();
  if (
    ["sf_apex", "sf_soql", "agentscript_lifecycle"].includes(toolName) ||
    DATA360_TOOLS.has(toolName)
  ) {
    if (!consumed.has("action")) invalid();
  }
  const actions =
    toolName === "sf_apex"
      ? APEX_ACTIONS
      : toolName === "sf_soql"
        ? SOQL_ACTIONS
        : toolName === "agentscript_lifecycle"
          ? AGENT_ACTIONS
          : toolName === "slack_canvas"
            ? new Set(["read", "create", "edit"])
            : undefined;
  if (actions && !actions.has(input.action as string)) omit("unrecognized_action_effects", true);
  if (["sf_browser_click", "sf_browser_press"].includes(toolName)) {
    if (!consumed.has(toolName === "sf_browser_click" ? "ref" : "key")) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_METADATA_BYTES) invalid();
  return result;
}

type Word = { value: string; dynamic: boolean };
type ShellToken = Word | { operator: string; fd?: string };

/** Quote-aware lexical extraction, deliberately not a general shell interpreter. */
function lex(command: string): ShellToken[] {
  if (Buffer.byteLength(command) > 128 * 1024) invalid();
  const tokens: ShellToken[] = [];
  let value = "",
    active = false,
    dynamic = false,
    quote = "";
  const flush = () => {
    if (active) tokens.push({ value, dynamic });
    value = "";
    active = false;
    dynamic = false;
  };
  const substitutionEnd = (start: number, backtick = false) => {
    let nesting = 1,
      innerQuote = "";
    for (let at = start; at < command.length; at++) {
      const char = command[at];
      if (char === "\\") {
        at++;
        continue;
      }
      if (backtick) {
        if (char === "`") return at;
        continue;
      }
      if (innerQuote) {
        if (char === innerQuote) innerQuote = "";
        continue;
      }
      if (["'", '"'].includes(char)) {
        innerQuote = char;
        continue;
      }
      if (char === "(") nesting++;
      if (char === ")" && --nesting === 0) return at;
    }
    invalid();
  };
  for (let i = 0; i < command.length; i++) {
    const char = command[i];
    if (quote !== "'" && (char === "`" || (char === "$" && command[i + 1] === "("))) {
      dynamic = true;
      active = true;
      i = substitutionEnd(i + (char === "`" ? 1 : 2), char === "`");
      value += "<substitution>";
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = "";
        continue;
      }
      if (quote === '"' && char === "\\") {
        if (++i >= command.length) invalid();
        if (!["$", "`", '"', "\\", "\n"].includes(command[i])) value += "\\";
        if (command[i] !== "\n") value += command[i];
        continue;
      }
      if (quote === '"' && (char === "$" || char === "`")) dynamic = true;
      value += char;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      active = true;
      continue;
    }
    if (char === "\\") {
      if (++i >= command.length) invalid();
      if (command[i] !== "\n") {
        value += command[i];
        active = true;
      }
      continue;
    }
    if (char === "#" && !active) {
      while (i < command.length && command[i] !== "\n") i++;
      i--;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      if (char === "\n") tokens.push({ operator: "\n" });
      continue;
    }
    if (/[;&|<>(){}]/.test(char)) {
      const fd = /[<>]/.test(char) && active && /^\d+$/.test(value) ? value : undefined;
      if (fd) {
        value = "";
        active = false;
      }
      flush();
      let operator = char;
      if (["&&", "||", ">>", "<<", "|&", ">&", "<&", ";;", "&>"].includes(char + command[i + 1]))
        operator += command[++i];
      tokens.push({ operator, ...(fd ? { fd } : {}) });
      continue;
    }
    if (/[$`*?[\]~]/.test(char)) dynamic = true;
    value += char;
    active = true;
  }
  if (quote) invalid();
  flush();
  if (tokens.length > 4096) invalid();
  return tokens;
}

const EXECUTABLES = new Set([
  "sf",
  "sfdx",
  "git",
  "rm",
  "sudo",
  "curl",
  "echo",
  "printf",
  "cat",
  "head",
  "tail",
  "ls",
  "pwd",
  "touch",
  "mkdir",
  "cp",
  "mv",
  "test",
  "true",
  "false",
  "find",
  "sed",
  "grep",
  "rg",
  "node",
  "python",
  "python3",
  "sh",
  "bash",
  "zsh",
  "eval",
  "source",
  ".",
  "env",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "chmod",
  "chown",
  "kill",
]);
const SF_OPERATIONS = new Set([
  "project deploy start",
  "project deploy validate",
  "project deploy quick",
  "project deploy preview",
  "project deploy report",
  "project deploy resume",
  "project retrieve start",
  "apex run",
  "apex run test",
  "data delete record",
  "data delete bulk",
  "data update record",
  "data update bulk",
  "data upsert bulk",
  "data import tree",
  "data export tree",
  "data query",
  "data get record",
  "api request rest",
  "org delete scratch",
  "org delete sandbox",
  "org display",
  "org list",
  "org open",
  "config get",
  "config set",
  "plugins",
  "version",
  "help",
  "force:apex:execute",
  "force:data:soql:query",
]);
const GIT_OPERATIONS = new Set([
  "status",
  "log",
  "diff",
  "show",
  "add",
  "commit",
  "push",
  "pull",
  "reset",
  "restore",
  "checkout",
  "clean",
  "branch",
  "merge",
  "fetch",
  "clone",
  "remote",
  "config",
  "rev-parse",
  "ls-files",
]);
const BOOLEAN_FLAGS = new Set([
  "--json",
  "--dry-run",
  "--check-only",
  "--force",
  "--force-with-lease",
  "--hard",
  "--soft",
  "--mixed",
  "--delete",
  "--recursive",
  "--no-prompt",
  "--use-most-recent",
  "--verbose",
  "--quiet",
  "--all",
  "--help",
  "--include-deleted",
  "--tooling-api",
  "--global",
  "--local",
  "--cached",
  "--staged",
  "--version",
  "--fail",
  "--location",
  "--silent",
  "--show-error",
  "--insecure",
  "--head",
  "-I",
  "-s",
  "-S",
  "-L",
  "-f",
  "-r",
  "-R",
  "-rf",
  "-fr",
  "-F",
  "-a",
  "-d",
  "-v",
  "-q",
  "-n",
  "-l",
  "-p",
]);
const PATH_FLAGS = new Set([
  "--file",
  "--manifest",
  "--source-dir",
  "--metadata-dir",
  "--pre-destructive-changes",
  "--post-destructive-changes",
  "--output-file",
  "--output-dir",
  "--result-dir",
  "--output",
  "-o",
]);
const ORG_FLAGS = new Set(["--target-org", "--targetusername", "-u", "-o"]);
const PAYLOAD_FLAGS = new Set([
  "--body",
  "--query",
  "--values",
  "--sobject",
  "--record-id",
  "--header",
  "--data",
  "--data-raw",
  "--data-binary",
  "--data-urlencode",
  "--form",
  "--user",
  "--password",
  "--token",
  "--api-key",
  "--message",
  "-H",
  "-d",
  "-F",
  "-m",
  "-e",
  "-c",
]);
const NUMBER_FLAGS = new Set([
  "--wait",
  "--limit",
  "--max-rows",
  "--max-time",
  "--connect-timeout",
]);
const ENUM_FLAGS: Record<string, string[]> = {
  "--test-level": ["NoTestRun", "RunSpecifiedTests", "RunLocalTests", "RunAllTestsInOrg"],
  "--level": ["RunLocalTests", "RunAllTestsInOrg", "RunSpecifiedTests"],
  "--result-format": ["human", "csv", "json", "junit", "tap"],
};

/** Value roles belong to a particular command schema, never to a flag name alone. */
function optionKind(executable: string, operation: string, flag: string): string | undefined {
  const includes = (options: string) => options.split(" ").includes(flag);
  if (["sf", "sfdx"].includes(executable) && SF_OPERATIONS.has(operation)) {
    if (ORG_FLAGS.has(flag)) return "org";
    if (
      BOOLEAN_FLAGS.has(flag) &&
      (includes("--json --help --version --verbose --quiet") ||
        (operation.startsWith("project deploy ") &&
          includes("--dry-run --check-only --use-most-recent")) ||
        (operation.startsWith("org delete ") && includes("--no-prompt")) ||
        (["data query", "force:data:soql:query"].includes(operation) &&
          includes("--include-deleted --tooling-api")))
    )
      return "boolean";
    if (
      PATH_FLAGS.has(flag) &&
      ((operation.startsWith("project deploy ") &&
        includes(
          "--manifest --source-dir --metadata-dir --pre-destructive-changes --post-destructive-changes --output-dir --result-dir",
        )) ||
        (operation === "project retrieve start" &&
          includes("--manifest --source-dir --output-dir")) ||
        (["apex run", "force:apex:execute"].includes(operation) && flag === "--file"))
    )
      return "path";
    if (
      PAYLOAD_FLAGS.has(flag) &&
      ((operation === "api request rest" && flag === "--body") ||
        (["data query", "force:data:soql:query"].includes(operation) && flag === "--query") ||
        (operation.startsWith("data ") && includes("--values --sobject --record-id")))
    )
      return "payload";
    if (operation === "api request rest" && flag === "--method") return "method";
    if (NUMBER_FLAGS.has(flag) && includes("--wait --limit --max-rows")) return "numeric";
    if (
      ENUM_FLAGS[flag] &&
      (operation.startsWith("project deploy ") ||
        operation === "apex run test" ||
        operation === "data query")
    )
      return "enum";
    return undefined;
  }
  if (executable === "curl") {
    if (
      BOOLEAN_FLAGS.has(flag) &&
      includes(
        "--fail --location --silent --show-error --insecure --head --help --version -I -s -S -L -f",
      )
    )
      return "boolean";
    if (includes("--request -X")) return "method";
    if (PATH_FLAGS.has(flag) && includes("--output -o")) return "path";
    if (
      PAYLOAD_FLAGS.has(flag) &&
      includes(
        "--header --data --data-raw --data-binary --data-urlencode --form --user --password --token --api-key -H -d -F",
      )
    )
      return "payload";
    if ((NUMBER_FLAGS.has(flag) && includes("--max-time --connect-timeout")) || flag === "-m")
      return "numeric";
    return undefined;
  }
  if (executable === "git") {
    const booleans: Record<string, string> = {
      status: "--all --verbose --quiet -v -q",
      push: "--force --force-with-lease --dry-run --delete --all --verbose --quiet -f -n -v -q",
      reset: "--hard --soft --mixed --quiet -q",
      add: "--dry-run --all --force --verbose -n -a -f -v",
      restore: "--staged",
      diff: "--cached --staged --quiet -R",
      commit: "--all --quiet --verbose -a -q -v -n",
      config: "--global --local",
    };
    if (BOOLEAN_FLAGS.has(flag) && includes(booleans[operation] ?? "")) return "boolean";
    if (
      PATH_FLAGS.has(flag) &&
      ((operation === "config" && flag === "--file") ||
        (["diff", "log", "show"].includes(operation) && flag === "--output"))
    )
      return "path";
    if (PAYLOAD_FLAGS.has(flag) && operation === "commit" && includes("--message -m"))
      return "payload";
    if (["log", "show"].includes(operation) && flag === "-n") return "numeric";
    return undefined;
  }
  const booleans: Record<string, string> = {
    echo: "-n",
    printf: "",
    rm: "--force --recursive --verbose -f -r -R -rf -fr -d -v",
    cat: "-n -s -v",
    head: "--quiet --verbose -q -v",
    tail: "--quiet --verbose -q -v -f",
    ls: "--all --recursive -a -l -r -R -d -F",
    cp: "--force --recursive --verbose -f -r -R -a -p -v",
    mv: "--force --verbose -f -n -v",
    touch: "-a",
    mkdir: "--verbose -p -v",
  };
  if (BOOLEAN_FLAGS.has(flag) && includes(booleans[executable] ?? "")) return "boolean";
  if (["head", "tail"].includes(executable) && flag === "-n") return "numeric";
  return undefined;
}

function shellMetadata(value: unknown): {
  metadata: Record<string, unknown>;
  paths: string[];
  targetOrg?: string;
  complete: boolean;
  withheld: boolean;
} {
  if (typeof value !== "string" || !value.trim()) invalid();
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) invalid();
  const tokens = lex(value);
  if (
    tokens.some(
      (token) =>
        "operator" in token &&
        ![">", ">>", "<", "&&", "||", ";", "|", "\n"].includes(token.operator),
    )
  ) {
    return {
      metadata: {
        commands: [{ executable: "opaque" }],
        operators: tokens
          .filter((token): token is { operator: string; fd?: string } => "operator" in token)
          .map((token) => `${token.fd ?? ""}${token.operator}`),
      },
      paths: [],
      complete: false,
      withheld: true,
    };
  }
  const commands: Record<string, unknown>[] = [];
  const operators: string[] = [];
  const paths: string[] = [];
  let complete = true,
    withheld = false;
  const targets = new Set<string>();
  let words: Word[] = [];
  const process = () => {
    if (!words.length) return;
    const command: Record<string, unknown> = {};
    const flags: Record<string, unknown>[] = [];
    const commandPaths: string[] = [],
      destinations: string[] = [];
    let i = 0;
    while (words[i] && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(words[i].value)) {
      i++;
      complete = false;
      withheld = true;
    }
    let executableWord = words[i++];
    if (!executableWord || executableWord.dynamic) {
      command.executable = "opaque";
      complete = false;
    } else {
      let executable = executableWord.value.split("/").pop() ?? "opaque";
      if (executable === "sudo") {
        command.privileged = true;
        executableWord = words[i++];
        executable = executableWord?.value.split("/").pop() ?? "opaque";
      }
      if (!EXECUTABLES.has(executable) || !executableWord || executableWord.dynamic) {
        command.executable = "unknown";
        complete = false;
        withheld = true;
      } else command.executable = executable;
      if (executableWord?.value.includes("/")) {
        complete = false;
        withheld = true;
      }
      const opaque = [
        "node",
        "python",
        "python3",
        "sh",
        "bash",
        "zsh",
        "eval",
        "source",
        ".",
        "env",
        "npm",
        "npx",
        "pnpm",
        "yarn",
      ].includes(executable);
      if (opaque) {
        complete = false;
        withheld = true;
      }
      let operation = "";
      if (["sf", "sfdx", "git"].includes(executable)) {
        const start = i;
        while (words[i] && !words[i].value.startsWith("-")) i++;
        const candidates = words.slice(start, i);
        if (executable === "git") {
          const first = candidates[0];
          if (first && !first.dynamic && GIT_OPERATIONS.has(first.value)) {
            operation = first.value;
            command.subcommands = [operation];
            i = start + 1;
          } else {
            complete = false;
            withheld = true;
          }
        } else {
          operation = candidates.map((word) => word.value).join(" ");
          if (candidates.some((word) => word.dynamic) || !SF_OPERATIONS.has(operation)) {
            complete = false;
            withheld = true;
          } else command.subcommands = candidates.map((word) => word.value);
        }
      }
      let explicitMethod = false,
        dataMethod = false,
        optionsEnded = false,
        ambiguousArguments = false;
      if (executable === "curl") command.method = "GET";
      for (; i < words.length; i++) {
        const word = words[i];
        if (word.dynamic && !optionsEnded) ambiguousArguments = true;
        if (
          word.dynamic ||
          opaque ||
          ambiguousArguments ||
          command.executable === "unknown" ||
          command.executable === "opaque"
        ) {
          complete = false;
          withheld = true;
          continue;
        }
        if (!optionsEnded && word.value === "--") {
          flags.push({ name: "--" });
          optionsEnded = true;
          continue;
        }
        if (!optionsEnded && word.value.startsWith("-")) {
          const equal = word.value.indexOf("=");
          const flag = equal < 0 ? word.value : word.value.slice(0, equal);
          const curl = executable === "curl";
          const kind = optionKind(executable, operation, flag);
          const org = kind === "org",
            payload = kind === "payload",
            flagPath = kind === "path",
            method = kind === "method",
            numeric = kind === "numeric",
            enums = kind === "enum" ? ENUM_FLAGS[flag] : undefined;
          if (!kind) {
            flags.push({ name: "unknown" });
            complete = false;
            withheld = true;
            ambiguousArguments = true;
            continue;
          }
          const info: Record<string, unknown> = { name: flag };
          flags.push(info);
          if (!(org || payload || flagPath || method || numeric || enums)) {
            if (equal >= 0) {
              complete = false;
              withheld = true;
            }
            if (curl && ["--head", "-I"].includes(flag)) {
              command.method = "HEAD";
              explicitMethod = true;
            }
            continue;
          }
          const argument =
            equal >= 0 ? { value: word.value.slice(equal + 1), dynamic: false } : words[++i];
          if (!argument || argument.dynamic) {
            complete = false;
            withheld = true;
            continue;
          }
          if (org) {
            targets.add(argument.value);
            info.value = "explicit";
          } else if (flagPath) {
            const path = pathValue(argument.value);
            info.value = path;
            commandPaths.push(path);
          } else if (method) {
            if (!HTTP_METHODS.has(argument.value.toUpperCase())) invalid();
            info.value = argument.value.toUpperCase();
            command.method = info.value;
            explicitMethod = true;
          } else if (numeric) {
            if (!/^\d+(?:\.\d+)?$/.test(argument.value)) invalid();
            info.value = Number(argument.value);
          } else if (enums) {
            if (!enums.includes(argument.value)) invalid();
            info.value = argument.value;
          } else {
            withheld = true;
            // Headers can override methods or other effects; their values stay private.
            if (!["--user", "--password", "--token", "--api-key"].includes(flag)) complete = false;
            if (
              curl &&
              [
                "--data",
                "--data-raw",
                "--data-binary",
                "--data-urlencode",
                "--form",
                "-d",
                "-F",
              ].includes(flag)
            )
              dataMethod = true;
          }
          continue;
        }
        if (executable === "curl") {
          const target = destination(word.value);
          destinations.push(target.value);
          if (target.omitted) {
            complete = false;
            withheld = true;
          }
        } else if (
          ["rm", "cat", "head", "tail", "ls", "touch", "mkdir", "cp", "mv"].includes(executable) ||
          (executable === "git" &&
            (["add", "restore"].includes(operation) || (operation === "diff" && optionsEnded)))
        )
          commandPaths.push(pathValue(word.value));
        else if (["echo", "printf", "true", "false", "pwd"].includes(executable)) withheld = true;
        else {
          complete = false;
          withheld = true;
        }
      }
      if (dataMethod && !explicitMethod) command.method = "POST";
    }
    if (flags.length) command.flags = flags;
    if (commandPaths.length) {
      command.paths = commandPaths;
      paths.push(...commandPaths);
    }
    if (destinations.length) command.destinations = destinations;
    commands.push(command);
    words = [];
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!("operator" in token)) {
      words.push(token);
      continue;
    }
    operators.push(`${token.fd ?? ""}${token.operator}`);
    if ([">", ">>", "<"].includes(token.operator)) {
      const target = tokens[++i];
      if (!target || "operator" in target) invalid();
      if (target.dynamic) {
        complete = false;
        withheld = true;
      } else paths.push(pathValue(target.value));
    } else if (["&&", "||", ";", "|", "\n"].includes(token.operator)) {
      if (["&&", "||", "|"].includes(token.operator) && !words.length) invalid();
      if (["&&", "||", "|"].includes(token.operator) && i === tokens.length - 1) invalid();
      process();
    } else {
      complete = false;
      withheld = true;
      process();
    }
  }
  process();
  if (!commands.length) invalid();
  if (targets.size > 1) complete = false;
  const orgCommands = commands.filter((command) =>
    ["sf", "sfdx"].includes(command.executable as string),
  ).length;
  if (orgCommands > 1) complete = false;
  return {
    metadata: {
      commands,
      operators,
      ...(orgCommands > 1 ? { orgContext: "ambiguous_multiple_commands" } : {}),
    },
    paths,
    targetOrg: targets.size === 1 && orgCommands <= 1 ? [...targets][0] : undefined,
    complete,
    withheld,
  };
}

/** Local-only resolver hint. The org identity is never included in outbound metadata. */
export function extractJevTargetOrg(
  toolName: string,
  input: Record<string, unknown>,
): string | undefined {
  if (typeof input.target_org === "string") return input.target_org;
  if (["bash", "herdr_pane"].includes(toolName) && typeof input.command === "string")
    return shellMetadata(input.command).targetOrg;
  return undefined;
}
