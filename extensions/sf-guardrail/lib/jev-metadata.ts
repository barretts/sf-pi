/* SPDX-License-Identifier: Apache-2.0 */
/** Metadata-only boundary. This extracts effects; it never evaluates risk or approval. */
import type { JevToolDescriptor, JevToolMetadata } from "./types.ts";

const INVALID = "Invalid Jev tool metadata.";
const MAX_METADATA_BYTES = 32 * 1024;
const ACTION = /^[a-zA-Z][a-zA-Z0-9_.:-]{0,127}$/;
const IDENTIFIER = /^[@a-zA-Z0-9_][@a-zA-Z0-9_.:-]{0,255}$/;
const HTTP_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]);
const FILE_TOOLS = new Set(["read", "write", "edit", "grep", "find", "ls"]);
const OPTIONAL_PATH_FILE_TOOLS = new Set(["grep", "find", "ls"]);
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
  "ignoreCase",
  "literal",
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
  "context",
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
  grep: new Set("pattern path glob ignoreCase literal context limit".split(" ")),
  find: new Set("pattern path limit".split(" ")),
  ls: new Set("path limit".split(" ")),
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

// Exact dispatch identities only. No safety classifications from the action catalog.
const DATA360_STREAM_DRY_RUN_ACTIONS = new Set([
  "stream.create",
  "stream.create_ingest_api",
  "stream.create_third_party_connector",
  "stream.delete",
  "stream.get",
  "stream.list",
  "stream.list.data_streams_list",
  "stream.run",
  "stream.update",
  "d360_datastream_create",
  "d360_datastream_create_ingest_api",
  "data_stream.create_ingest_api",
  "d360_datastream_create_third_party_connectors",
  "data_stream.create_third_party_connector",
  "d360_datastream_delete",
  "d360_datastream_get",
  "d360_datastream_list",
  "d360_data_streams_list",
  "d360_datastream_run",
  "d360_datastream_update",
]);
const DATA360_JOURNEY_RUN_ACTIONS = new Set([
  "cleanup.run",
  "ingest_csv.run",
  "manifest.run",
  "journey.cleanup.run",
  "journey.ingest_csv.run",
  "journey.manifest.run",
]);
const DATA360_JOURNEY_PLAN_ACTIONS = new Set([
  "cleanup.plan",
  "ingest_csv.plan",
  "manifest.plan",
  "journey.cleanup.plan",
  "journey.ingest_csv.plan",
  "journey.manifest.plan",
]);

/** How the current runner treats this flag; it says nothing about policy or permission. */
function executionFlags(toolName: string, input: Record<string, unknown>) {
  const action = input.action as string;
  if (toolName === "agentscript_lifecycle") {
    // lifecycle/actions/agent-user.ts forwards this flag only to runProvision,
    // whose omitted flag defaults to true. Publication and other actions ignore it.
    if (action === "provision_agent_user")
      return { dryRun: "honored", effectiveDryRun: input.dry_run !== false };
    return { dryRun: AGENT_ACTIONS.has(action) ? "ignored" : "unknown" };
  }
  if (
    (toolName === "data360_api" && action === "rest.request") ||
    (toolName === "data360_prepare" && DATA360_STREAM_DRY_RUN_ACTIONS.has(action))
  )
    // Direct REST and these capability-backed stream actions return their plans
    // before the operation request when dry_run is true; omission defaults to false.
    return { dryRun: "honored", effectiveDryRun: input.dry_run === true };
  if (toolName === "data360_orchestrate") {
    // Journey branches precede the facade flag guard. Their confirmed run paths
    // do not forward dry_run to the child writes; exact plan branches never run them.
    if (DATA360_JOURNEY_PLAN_ACTIONS.has(action)) return { dryRun: "ignored", planningOnly: true };
    if (DATA360_JOURNEY_RUN_ACTIONS.has(action)) return { dryRun: "ignored" };
  }
  return { dryRun: "unknown" };
}

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
      if (!known || (schemaFields && !schemaFields.has(key))) {
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
        const path = pathValue(
          OPTIONAL_PATH_FILE_TOOLS.has(toolName) && value === "" ? "." : value,
        );
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
      } else if (
        (toolName === "grep" && ["pattern", "glob"].includes(key)) ||
        (toolName === "find" && key === "pattern")
      ) {
        if (typeof value !== "string") invalid();
        // Search selectors are data. Their spelling cannot add executable effects.
        omit(key === "glob" ? "search_glob_data_withheld" : "search_pattern_data_withheld");
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
        const browserReason =
          ["sf_browser_click", "sf_browser_press"].includes(toolName) && key === "reason";
        omit(
          ordinaryFileBody ? "file_body_withheld" : "payload_withheld",
          !ordinaryFileBody && !browserReason,
        );
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
  if (OPTIONAL_PATH_FILE_TOOLS.has(toolName)) {
    if (!consumed.has("path")) {
      put("path", ".");
      paths.push(".");
    }
    // Keep each public runner's calculation and unit. Do not invent a shared clamp.
    const limit = result.metadata.limit as number | undefined;
    put(
      "limit",
      toolName === "grep"
        ? Math.max(1, limit ?? 100)
        : (limit ?? (toolName === "find" ? 1000 : 500)),
    );
    put("limitUnit", toolName === "grep" ? "matches" : toolName === "find" ? "results" : "entries");
    if (toolName === "grep") {
      put("ignoreCase", result.metadata.ignoreCase ?? false);
      put("literal", result.metadata.literal ?? false);
      const context = result.metadata.context as number | undefined;
      put("context", context && context > 0 ? context : 0);
      put("globFilterApplied", Boolean(input.glob));
    }
  }
  if (paths.length) put("paths", [...new Set(paths)]);
  if (
    FILE_TOOLS.has(toolName) &&
    !OPTIONAL_PATH_FILE_TOOLS.has(toolName) &&
    !["path", "file_path"].some((key) => consumed.has(key))
  )
    invalid();
  if (["grep", "find"].includes(toolName) && !consumed.has("pattern")) invalid();
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
  if (toolName === "agentscript_lifecycle" || DATA360_TOOLS.has(toolName))
    result.metadata.executionFlags = executionFlags(toolName, input);
  if (["sf_browser_click", "sf_browser_press"].includes(toolName)) {
    if (!consumed.has(toolName === "sf_browser_click" ? "ref" : "key")) invalid();
  }
  if (Buffer.byteLength(JSON.stringify(result)) > MAX_METADATA_BYTES) invalid();
  return result;
}

type Word = { value: string; dynamic: boolean };
type ShellToken = Word | { operator: string; fd?: string };

/** Quote-aware lexical extraction, deliberately not a general shell interpreter. */
function lex(command: string): { tokens: ShellToken[]; commentsOmitted: boolean } {
  if (Buffer.byteLength(command) > 128 * 1024) invalid();
  const tokens: ShellToken[] = [];
  let value = "",
    active = false,
    dynamic = false,
    quote = "";
  let commentsOmitted = false;
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
      commentsOmitted = true;
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
      if (
        char === "{" &&
        command[i + 1] === "}" &&
        !active &&
        (i + 2 === command.length || /\s/.test(command[i + 2]))
      ) {
        tokens.push({ value: "{}", dynamic: false });
        i++;
        continue;
      }
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
  return { tokens, commentsOmitted };
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
  "killall",
  "pkill",
  "shred",
  "srm",
  "wipe",
  "truncate",
  "chgrp",
  "dd",
  "mkfs",
  "mkfs.ext2",
  "mkfs.ext3",
  "mkfs.ext4",
  "mkfs.xfs",
  "mkfs.btrfs",
  "mkfs.vfat",
  "mkfs.fat",
  "mkfs.ntfs",
  "mkfs.exfat",
  "mkfs.f2fs",
  "mkfs.minix",
  "mkfs.hfs",
  "mkfs.hfsplus",
  "mkfs.apfs",
  "mkfs.ufs",
  "reboot",
  "shutdown",
  "docker",
  "kubectl",
  "terraform",
  "dropdb",
  "redis-cli",
  "pi",
  "agent-browser",
  "base64",
  "wget",
  "timeout",
  "nohup",
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
  "force:data:record:get",
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
  "project delete source",
  "project delete tracking",
  "project reset tracking",
  "package delete",
  "package version delete",
  "package uninstall",
  "package version promote",
  "package push-upgrade schedule",
  "package push-upgrade abort",
  "package install",
  "package install report",
  "force:package:install:report",
  "org logout",
  "org generate password",
  "org delete",
  "org api",
  "org auth show-access-token",
  "org auth show-sfdx-auth-url",
  "org auth show-user-password",
  "plugins install",
  "plugins uninstall",
  "plugins remove",
  "plugins reset",
  "plugins list",
  "agent adl delete",
  "agent adl file delete",
  "agent activate",
  "agent deactivate",
  "agent publish authoring-bundle",
  "data create record",
  "data create file",
  "data upsert record",
  "data import bulk",
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
const CLI_OPERATIONS: Record<string, Set<string>> = {
  sf: SF_OPERATIONS,
  sfdx: SF_OPERATIONS,
  git: GIT_OPERATIONS,
  pi: new Set([
    "auth check",
    "auth print-api-key",
    "auth print-bearer-token",
    "auth list",
    "auth status",
    "auth login",
    "auth logout",
  ]),
  docker: new Set([
    "system prune",
    "compose down",
    "rm",
    "ps",
    "images",
    "inspect",
    "image prune",
    "container prune",
    "volume prune",
    "builder prune",
    "compose ps",
    "compose logs",
    "compose config",
    "compose up",
    "stop",
    "start",
    "restart",
    "exec",
    "run",
    "build",
    "pull",
    "push",
    "rmi",
    "volume rm",
    "network rm",
  ]),
  kubectl: new Set([
    "delete",
    "get",
    "describe",
    "apply",
    "create",
    "replace",
    "patch",
    "exec",
    "rollout status",
    "rollout restart",
    "scale",
    "config view",
    "config current-context",
    "config use-context",
    "logs",
    "version",
    "cluster-info",
    "auth can-i",
  ]),
  terraform: new Set([
    "destroy",
    "apply",
    "plan",
    "show",
    "validate",
    "fmt",
    "state list",
    "state rm",
    "state pull",
    "state push",
    "init",
    "output",
    "workspace list",
    "workspace show",
    "workspace select",
  ]),
  "redis-cli": new Set([
    "FLUSHALL",
    "FLUSHDB",
    "PING",
    "INFO",
    "GET",
    "SET",
    "DEL",
    "UNLINK",
    "KEYS",
    "SCAN",
    "CONFIG GET",
    "CONFIG SET",
    "SHUTDOWN",
    "SAVE",
    "BGSAVE",
    "MONITOR",
  ]),
  "agent-browser": new Set([
    "open",
    "snapshot",
    "click",
    "fill",
    "select",
    "press",
    "type",
    "eval",
    "close",
    "wait",
    "get text",
    "get url",
    "get title",
    "get value",
    "get attr",
    "get count",
    "is visible",
    "is enabled",
    "is checked",
    "find role",
    "find text",
    "find label",
    "find placeholder",
    "screenshot",
    "pdf",
    "cookies get",
    "cookies set",
    "cookies clear",
    "storage local",
    "storage session",
    "network requests",
    "tab new",
    "tab list",
    "tab switch",
    "tab close",
    "download",
    "upload",
    "scroll",
    "back",
    "forward",
    "reload",
    "focus",
    "hover",
    "check",
    "uncheck",
  ]),
};

function knownOperation(executable: string, words: Word[], start: number): string {
  const operations = CLI_OPERATIONS[executable];
  if (!operations) return "";
  let result = "";
  const parts: string[] = [];
  for (const word of words.slice(start, start + 6)) {
    if (word.dynamic || word.value.startsWith("-")) break;
    parts.push(executable === "redis-cli" ? word.value.toUpperCase() : word.value);
    const candidate = parts.join(" ");
    if (operations.has(candidate)) result = candidate;
  }
  return result;
}
const BOOLEAN_FLAGS = new Set([
  "--json",
  "--dry-run",
  "--check-only",
  "--checkonly",
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
  "--all-rows",
  "--use-tooling-api",
  "--usetoolingapi",
  "-t",
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
  if (CLI_OPERATIONS[executable] && includes("--help --version")) return "boolean";
  if (["sf", "sfdx"].includes(executable) && ORG_FLAGS.has(flag)) return "org";
  if (["sf", "sfdx"].includes(executable) && includes("--json --verbose --quiet")) return "boolean";
  if (executable === "pi") {
    if (includes("--credentials --help --version")) return "boolean";
    if (flag === "--provider") return "identifier";
  }
  if (
    executable === "git" &&
    operation === "status" &&
    includes("--short --porcelain --branch -s -b")
  )
    return "boolean";
  if (
    executable === "git" &&
    operation === "clean" &&
    includes("--force --dry-run -f -d -x -X -n -fd -fdx -df -dfx")
  )
    return "boolean";
  if (["kill", "killall", "pkill"].includes(executable)) {
    if (
      /^-(?:[1-9]\d?|HUP|INT|TERM|KILL|STOP|CONT)$/.test(flag) ||
      includes("--help --version -f -x -e -v -q")
    )
      return "boolean";
    if (includes("--signal -s")) return "signal";
  }
  if (executable.startsWith("mkfs")) {
    if (
      includes("--help --version -v -V") ||
      (["mkfs.ext2", "mkfs.ext3", "mkfs.ext4"].includes(executable) && flag === "-F") ||
      (executable === "mkfs.xfs" && flag === "-f")
    )
      return "boolean";
    if (executable === "mkfs" && includes("--type -t")) return "filesystem";
    if (includes("-L --label")) return "identifier";
  }
  if (executable === "find") {
    if (includes("-delete -print -print0 -depth -xdev -mount -empty")) return "boolean";
    if (includes("-maxdepth -mindepth")) return "numeric";
    if (includes("-name -iname -path -ipath -regex -iregex")) return "payload";
    if (includes("-exec -execdir -ok -okdir")) return "exec";
    if (flag === "-type") return "file-type";
  }
  if (executable === "truncate" && includes("--size -s")) return "size";
  if (executable === "shred" && includes("--iterations -n")) return "numeric";
  if (executable === "shred" && includes("--size -s")) return "size";
  if (["chmod", "chown", "chgrp"].includes(executable)) {
    if (includes("--recursive -R --verbose -v --changes -c --silent --quiet -f --help --version"))
      return "boolean";
    if (includes("--reference")) return "path";
  }
  const booleans: Record<string, string> = {
    shred: "--force -f --zero -z --remove -u --verbose -v --help --version",
    srm: "-f -r -R -s -m -z -v --help --version",
    wipe: "-f -r -R -q -v --help --version",
    truncate: "--no-create -c --io-blocks -o --help --version",
    reboot: "--force -f --halt --poweroff --reboot --no-wall --help",
    shutdown: "-h -r -H -P -k -c --halt --poweroff --reboot --cancel --no-wall --help",
    dropdb:
      "--force -f --if-exists --echo -e --interactive -i --password -W --no-password -w --help --version",
    "redis-cli": "--raw --no-raw --json --quoted-json --tls --insecure --help --version",
    base64: "--decode -d -D --ignore-garbage -i --help --version",
    wget: "--quiet -q --verbose -v --help --version",
  };
  if (includes(booleans[executable] ?? "")) return "boolean";
  if (executable === "dropdb" && includes("--host -h --port -p --username -U --maintenance-db"))
    return "identifier";
  if (executable === "redis-cli") {
    if (includes("-a --pass --user")) return "credential";
    if (includes("-h --host")) return "identifier";
    if (includes("-p -n")) return "numeric";
  }
  if (executable === "docker") {
    const options: Record<string, string> = {
      "system prune": "--all -a --force -f --volumes",
      "compose down": "--volumes -v --remove-orphans",
      rm: "--force -f --volumes -v --link -l",
      ps: "--all -a --quiet -q",
      images: "--all -a --quiet -q",
      "image prune": "--all -a --force -f",
      "container prune": "--force -f",
      "volume prune": "--all -a --force -f",
      "builder prune": "--all -a --force -f",
    };
    if (includes(options[operation] ?? "")) return "boolean";
    if (operation === "compose down" && flag === "--rmi") return "image-removal";
    if (includes("--context --host -H")) return "identifier";
    if (flag === "--config") return "path";
    if (includes("--format --filter")) return "payload";
  }
  if (executable === "kubectl") {
    if (includes("--all --force --now --ignore-not-found --help --version")) return "boolean";
    if (flag === "--cascade") return "cascade";
    if (flag === "--dry-run") return "dry-run";
    if (
      flag === "--kubeconfig" ||
      (["delete", "get", "describe", "apply", "create", "replace"].includes(operation) &&
        includes("--filename -f"))
    )
      return "path";
    if (includes("--namespace -n --context --cluster --user")) return "identifier";
    if (flag === "--grace-period") return "numeric";
    if (flag === "--timeout") return "duration";
    if (includes("--selector -l --field-selector --patch -p")) return "payload";
  }
  if (executable === "terraform") {
    if (includes("-destroy -auto-approve -refresh-only -no-color -compact-warnings -help --help"))
      return "boolean";
    if (
      flag === "-chdir" ||
      (["destroy", "apply", "plan"].includes(operation) && flag === "-var-file") ||
      (operation === "plan" && flag === "-out")
    )
      return "path";
    if (flag === "-target") return "identifier";
    if (flag === "-var") return "payload";
    if (flag === "-parallelism") return "numeric";
  }
  if (executable === "agent-browser") {
    if (includes("--json --headed --help --version -i --interactive --full")) return "boolean";
    if (includes("--session --profile")) return "identifier";
  }
  if (["sf", "sfdx"].includes(executable) && SF_OPERATIONS.has(operation)) {
    if (ORG_FLAGS.has(flag)) return "org";
    if (["data get record", "force:data:record:get"].includes(operation)) {
      if (includes("--sobject --sobjecttype -s --record-id --sobjectid -i")) return "identifier";
      if (includes("--where -w")) return "payload";
      if (includes("--use-tooling-api --usetoolingapi -t")) return "boolean";
      if (flag === "--api-version") return "numeric";
    }
    if (["package install report", "force:package:install:report"].includes(operation)) {
      if (includes("--request-id --requestid -i")) return "identifier";
      if (flag === "--api-version") return "numeric";
    }
    if (
      BOOLEAN_FLAGS.has(flag) &&
      (includes("--json --help --version --verbose --quiet") ||
        (operation.startsWith("project deploy ") &&
          includes("--dry-run --check-only --checkonly --use-most-recent")) ||
        ((operation.startsWith("org delete") ||
          operation.startsWith("package ") ||
          operation.startsWith("plugins ")) &&
          includes("--no-prompt --force")) ||
        (operation === "org logout" && includes("--all --no-prompt")) ||
        (["data query", "force:data:soql:query"].includes(operation) &&
          includes("--all-rows --use-tooling-api --usetoolingapi -t")))
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
    if (["api request rest", "org api"].includes(operation) && flag === "--method") return "method";
    if (operation.startsWith("project delete ") && includes("--source-dir --manifest"))
      return "path";
    if (operation === "project delete source" && flag === "--metadata") return "identifier";
    if (operation === "agent publish authoring-bundle" && includes("--file --path")) return "path";
    if (
      operation.startsWith("package ") &&
      includes(
        "--package --package-id --package-version-id --target-dev-hub --installation-key --push-request-id",
      )
    )
      return "identifier";
    if (operation.startsWith("agent adl ") && includes("--library-id --file-id"))
      return "identifier";
    if (operation === "plugins reset" && flag === "--hard") return "boolean";
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
    if (flag === "-fsSL" || flag === "-sSL" || flag === "-fsS") return "boolean";
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
      diff: "--cached --staged --quiet --stat -R",
      commit: "--all --quiet --verbose -a -q -v -n",
      config: "--global --local",
    };
    if (
      (BOOLEAN_FLAGS.has(flag) || (operation === "diff" && flag === "--stat")) &&
      includes(booleans[operation] ?? "")
    )
      return "boolean";
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
  const utilityBooleans: Record<string, string> = {
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
  if (BOOLEAN_FLAGS.has(flag) && includes(utilityBooleans[executable] ?? "")) return "boolean";
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
  const { tokens, commentsOmitted } = lex(value);
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
        ...(commentsOmitted ? { policyTokens: "comments_withheld" } : {}),
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
  let complete = !commentsOmitted,
    withheld = commentsOmitted;
  const targets = new Set<string>();
  let targetRolesAmbiguous = false;
  let words: Word[] = [];
  const process = () => {
    if (!words.length) return;
    const command: Record<string, unknown> = {};
    const flags: Record<string, unknown>[] = [];
    const commandPaths: string[] = [],
      destinations: string[] = [];
    const wrappers: Record<string, unknown>[] = [];
    let i = 0;
    let environmentAssignments = 0;
    let ambiguousWrapper = false;
    const obscureRemainder = () => {
      i = words.length;
      ambiguousWrapper = true;
      targetRolesAmbiguous = true;
      complete = false;
      withheld = true;
    };
    const assignment = (word: Word) => {
      environmentAssignments++;
      complete = false;
      withheld = true;
      if (!word.dynamic && /^SF_TEMP_SHOW_SECRETS=(?:true|false|1|0)$/.test(word.value)) {
        command.environmentFlags = { SF_TEMP_SHOW_SECRETS: /=(?:true|1)$/.test(word.value) };
      }
    };
    while (words[i] && /^[a-zA-Z_][a-zA-Z0-9_]*=/.test(words[i].value)) {
      const word = words[i++];
      assignment(word);
      if (word.dynamic) {
        obscureRemainder();
        break;
      }
    }
    while (!ambiguousWrapper && words[i] && !words[i].dynamic) {
      const wrapper = words[i].value;
      if (!wrapper || !["env", "nohup", "timeout", "sudo"].includes(wrapper)) break;
      i++;
      const wrapperMetadata: Record<string, unknown> = { executable: wrapper };
      wrappers.push(wrapperMetadata);
      if (wrapper === "sudo") command.privileged = true;
      if (wrapper === "env") {
        while (words[i]) {
          if (/^[a-zA-Z_][a-zA-Z0-9_]*=/.test(words[i].value)) {
            const word = words[i++];
            assignment(word);
            if (word.dynamic) {
              obscureRemainder();
              break;
            }
            continue;
          }
          if (["-i", "--ignore-environment"].includes(words[i].value)) {
            wrapperMetadata.clearEnvironment = true;
            complete = false;
            i++;
            continue;
          }
          if (["-u", "--unset"].includes(words[i].value)) {
            i++;
            if (!words[i]) invalid();
            wrapperMetadata.unsetVariable = "specified";
            complete = false;
            withheld = true;
            if (words[i].dynamic) {
              obscureRemainder();
              break;
            }
            i++;
            continue;
          }
          if (words[i].value === "--") i++;
          break;
        }
      } else if (wrapper === "timeout") {
        const duration = words[i++];
        if (duration?.dynamic) obscureRemainder();
        else if (!duration || !/^\d+(?:\.\d+)?[smhd]?$/.test(duration.value)) invalid();
        else wrapperMetadata.duration = duration.value;
      } else if (wrapper === "sudo") {
        while (words[i] && ["-u", "-g", "-n", "-E", "-H", "--"].includes(words[i].value)) {
          const option = words[i++].value;
          if (["-u", "-g"].includes(option)) {
            const identity = words[i++];
            if (!identity) invalid();
            wrapperMetadata.identity = "specified";
            withheld = true;
            complete = false;
            if (identity.dynamic) {
              obscureRemainder();
              break;
            }
          }
          if (["-E", "-H"].includes(option)) {
            wrapperMetadata.environmentModified = true;
            complete = false;
          }
          if (option === "--") break;
        }
      } else if (words[i]?.value === "--") i++;
      if (ambiguousWrapper) break;
      if (!words[i]) {
        if (wrapper === "env") {
          command.executable = "env";
          command.output = "environment_variables";
          complete = false;
        } else invalid();
        break;
      }
    }
    if (wrappers.length) command.wrappers = wrappers;
    if (environmentAssignments) command.environmentAssignments = environmentAssignments;
    const executableWord = words[i++];
    if (!executableWord && command.executable === "env") {
      /* env without a command prints environment data. */
    } else if (!executableWord || executableWord.dynamic) {
      command.executable = "opaque";
      complete = false;
    } else {
      // A basename does not establish an arbitrary executable's argument schema.
      const executable = executableWord.value.includes("/") ? "opaque" : executableWord.value;
      if (!EXECUTABLES.has(executable)) {
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
      if (CLI_OPERATIONS[executable]) {
        operation = knownOperation(executable, words, i);
        if (operation) {
          command.subcommands = operation.split(" ");
          i += operation.split(" ").length;
        }
      }
      let explicitMethod = false,
        dataMethod = false,
        optionsEnded = false,
        ambiguousArguments = false;
      let positionalCount = 0;
      let findExpression = false;
      if (executable === "curl") command.method = "GET";
      for (; i < words.length; i++) {
        const word = words[i];
        if (word.dynamic) {
          ambiguousArguments = true;
          targetRolesAmbiguous = true;
        }
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
        if (
          !operation &&
          CLI_OPERATIONS[executable] &&
          !optionsEnded &&
          !word.value.startsWith("-")
        ) {
          operation = knownOperation(executable, words, i);
          if (operation) {
            command.subcommands = operation.split(" ");
            i += operation.split(" ").length - 1;
            continue;
          }
          complete = false;
          withheld = true;
          ambiguousArguments = true;
          targetRolesAmbiguous = true;
          continue;
        }
        if (!optionsEnded && word.value === "--") {
          flags.push({ name: "--" });
          optionsEnded = true;
          continue;
        }
        if (!optionsEnded && word.value.startsWith("-")) {
          if (executable === "find") findExpression = true;
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
            targetRolesAmbiguous = true;
            continue;
          }
          const info: Record<string, unknown> = { name: flag };
          flags.push(info);
          if (kind === "boolean") {
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
          if (kind === "exec") {
            const nestedWords: Word[] = [];
            while (words[i + 1] && ![";", "+"].includes(words[i + 1].value))
              nestedWords.push(words[++i]);
            if (words[i + 1]) i++;
            else complete = false;
            const nestedExecutable = nestedWords[0]?.value;
            const nested: Record<string, unknown> = {
              executable:
                nestedExecutable && !nestedWords[0].dynamic && EXECUTABLES.has(nestedExecutable)
                  ? nestedExecutable
                  : "opaque",
            };
            if (nestedExecutable && nested.executable !== "opaque") {
              const nestedOperation = knownOperation(nestedExecutable, nestedWords, 1);
              if (nestedOperation) nested.subcommands = nestedOperation.split(" ");
              const nestedFlags = nestedWords
                .slice(1)
                .filter(
                  (item) =>
                    !item.dynamic &&
                    item.value.startsWith("-") &&
                    optionKind(nestedExecutable, nestedOperation, item.value) === "boolean",
                )
                .map((item) => item.value);
              if (nestedFlags.length) nested.flags = nestedFlags;
              if (nestedWords.some((item) => item.value === "{}")) nested.target = "current_match";
            }
            info.command = nested;
            complete = false;
            withheld = true;
            continue;
          }
          const argument =
            equal >= 0 ? { value: word.value.slice(equal + 1), dynamic: false } : words[++i];
          if (!argument || argument.dynamic) {
            complete = false;
            withheld = true;
            ambiguousArguments = true;
            targetRolesAmbiguous = true;
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
          } else if (kind === "identifier" || kind === "credential") {
            info.value = "specified";
            withheld = true;
          } else if (
            [
              "size",
              "duration",
              "signal",
              "filesystem",
              "file-type",
              "image-removal",
              "cascade",
              "dry-run",
            ].includes(kind)
          ) {
            const safe =
              kind === "size"
                ? /^[+-]?\d+(?:\.\d+)?(?:[KMGTPEZY](?:i?B)?|[kmgtpezy])?$/.test(argument.value)
                : kind === "duration"
                  ? /^\d+(?:\.\d+)?(?:ms|s|m|h|d)?$/.test(argument.value)
                  : kind === "signal"
                    ? /^(?:[1-9]\d?|(?:SIG)?(?:HUP|INT|TERM|KILL|STOP|CONT))$/.test(argument.value)
                    : (kind === "filesystem"
                        ? [
                            "ext2",
                            "ext3",
                            "ext4",
                            "xfs",
                            "btrfs",
                            "vfat",
                            "fat",
                            "ntfs",
                            "exfat",
                            "f2fs",
                            "minix",
                            "hfs",
                            "hfsplus",
                            "apfs",
                            "ufs",
                          ]
                        : kind === "file-type"
                          ? ["b", "c", "d", "f", "l", "p", "s"]
                          : kind === "image-removal"
                            ? ["all", "local"]
                            : kind === "cascade"
                              ? ["orphan", "background", "foreground"]
                              : ["client", "server", "none"]
                      ).includes(argument.value);
            if (safe) info.value = argument.value;
            else {
              complete = false;
              withheld = true;
            }
          } else if (payload) {
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
          } else {
            complete = false;
            withheld = true;
          }
          continue;
        }
        positionalCount++;
        if (
          ["curl", "wget"].includes(executable) ||
          (executable === "agent-browser" && operation === "open")
        ) {
          const target = destination(word.value);
          destinations.push(target.value);
          if (target.omitted) {
            complete = false;
            withheld = true;
          }
        } else if (
          [
            "rm",
            "cat",
            "head",
            "tail",
            "ls",
            "touch",
            "mkdir",
            "cp",
            "mv",
            "shred",
            "srm",
            "wipe",
            "truncate",
          ].includes(executable) ||
          (executable === "find" && !findExpression) ||
          ((executable.startsWith("mkfs") || executable === "base64") && positionalCount === 1) ||
          (executable === "git" &&
            (["add", "restore", "clean"].includes(operation) ||
              (operation === "diff" && optionsEnded)))
        )
          commandPaths.push(pathValue(word.value));
        else if (
          ["mkfs", "mkfs.ext2", "mkfs.ext3", "mkfs.ext4"].includes(executable) &&
          positionalCount === 2 &&
          /^\d{1,15}$/.test(word.value)
        )
          command.blocks = Number(word.value);
        else if (executable === "dd") {
          const equal = word.value.indexOf("=");
          const name = word.value.slice(0, equal),
            operand = word.value.slice(equal + 1);
          if (equal > 0 && ["if", "of"].includes(name)) {
            const path = pathValue(operand);
            command.operands ??= [];
            (command.operands as unknown[]).push({ name, path });
            commandPaths.push(path);
          } else if (
            equal > 0 &&
            ["bs", "ibs", "obs", "count", "skip", "seek"].includes(name) &&
            /^\d+(?:[kKMGTPEZY](?:i?B)?)?$/.test(operand)
          ) {
            command.operands ??= [];
            (command.operands as unknown[]).push({ name, value: operand });
          } else if (
            equal > 0 &&
            ["conv", "iflag", "oflag", "status"].includes(name) &&
            operand
              .split(",")
              .every((item) =>
                [
                  "notrunc",
                  "sync",
                  "fsync",
                  "fdatasync",
                  "noerror",
                  "sparse",
                  "append",
                  "direct",
                  "fullblock",
                  "nocache",
                  "none",
                  "noxfer",
                  "progress",
                ].includes(item),
              )
          ) {
            command.operands ??= [];
            (command.operands as unknown[]).push({ name, value: operand });
          } else {
            complete = false;
            withheld = true;
          }
        } else if (["chmod", "chown", "chgrp"].includes(executable)) {
          const reference = flags.some((flag) => flag.name === "--reference");
          if (positionalCount === 1 && !reference) {
            if (
              executable === "chmod" &&
              /^(?:[0-7]{3,4}|[ugoa]*[+=-][rwxXstugo]*(?:,[ugoa]*[+=-][rwxXstugo]*)*)$/.test(
                word.value,
              )
            )
              command.mode = word.value;
            else {
              command.identity = "specified";
              complete = false;
              withheld = true;
            }
          } else if (executable === "chmod" && !command.mode && !reference) {
            complete = false;
            withheld = true;
          } else commandPaths.push(pathValue(word.value));
        } else if (
          executable === "kubectl" &&
          ["delete", "get", "describe"].includes(operation) &&
          positionalCount === 1 &&
          [
            "all",
            "pods",
            "pod",
            "deployments",
            "deployment",
            "services",
            "service",
            "namespaces",
            "namespace",
            "jobs",
            "job",
            "secrets",
            "secret",
            "configmaps",
            "configmap",
            "nodes",
            "node",
            "persistentvolumes",
            "persistentvolume",
            "persistentvolumeclaims",
            "persistentvolumeclaim",
            "statefulsets",
            "daemonsets",
            "replicasets",
            "ingresses",
          ].includes(word.value)
        ) {
          command.resourceType = word.value;
        } else if (
          executable === "redis-cli" &&
          ["FLUSHALL", "FLUSHDB"].includes(operation) &&
          ["ASYNC", "SYNC"].includes(word.value.toUpperCase())
        ) {
          command.mode = word.value.toUpperCase();
        } else if (
          executable === "shutdown" &&
          positionalCount === 1 &&
          /^(?:now|\+\d+|\d{1,2}:\d{2})$/.test(word.value)
        ) {
          command.schedule = word.value;
        } else if (
          ["sf", "sfdx"].includes(executable) &&
          ["api request rest", "org api"].includes(operation) &&
          word.value.startsWith("/")
        ) {
          if (command.apiPath !== undefined) {
            complete = false;
            withheld = true;
            ambiguousArguments = true;
            targetRolesAmbiguous = true;
            continue;
          }
          command.apiPath = word.value.split(/[?#]/, 1)[0];
          if (command.apiPath !== word.value) {
            complete = false;
            withheld = true;
          }
        } else if (["echo", "printf", "true", "false", "pwd"].includes(executable)) withheld = true;
        else {
          complete = false;
          withheld = true;
        }
      }
      if (
        CLI_OPERATIONS[executable] &&
        !operation &&
        !flags.some((flag) => ["--help", "--version"].includes(flag.name as string))
      )
        complete = false;
      if (
        executable === "agent-browser" &&
        !["snapshot", "close", "back", "forward", "reload", "tab list"].includes(operation)
      )
        complete = false;
      if (dataMethod && !explicitMethod) command.method = "POST";
      // Official plugin-api uses GET when no method or request-file override is present.
      if (
        ["sf", "sfdx"].includes(executable) &&
        operation === "api request rest" &&
        command.apiPath !== undefined &&
        command.method === undefined &&
        !ambiguousArguments
      )
        command.method = "GET";
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
      ...(commentsOmitted ? { policyTokens: "comments_withheld" } : {}),
      ...(orgCommands > 1 ? { orgContext: "ambiguous_multiple_commands" } : {}),
    },
    paths,
    targetOrg:
      targets.size === 1 && orgCommands <= 1 && !targetRolesAmbiguous ? [...targets][0] : undefined,
    complete,
    withheld,
  };
}

/** Shared structural head projection; unknown effect context retains no head restriction. */
export function jevShellExecutableHeads(
  metadata: JevToolMetadata,
): ReadonlySet<string> | undefined {
  const shell = metadata.metadata.shell as
    | {
        commands?: Array<{ executable?: string; wrappers?: Array<{ executable?: string }> }>;
        policyTokens?: string;
      }
    | undefined;
  // Omitted comments/scripts can contain heads the baseline tokenizer still sees.
  if (!metadata.complete || shell?.policyTokens === "comments_withheld" || !shell?.commands?.length)
    return undefined;
  const heads = shell.commands.flatMap((command) => [
    command.executable,
    ...(command.wrappers ?? []).map((wrapper) => wrapper.executable),
  ]);
  if (heads.some((head) => !head || ["unknown", "opaque"].includes(head))) return undefined;
  return new Set(heads as string[]);
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
