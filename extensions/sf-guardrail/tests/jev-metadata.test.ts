/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { buildJevMetadata, extractJevTargetOrg } from "../lib/jev-metadata.ts";

const SECRET = "PRIVATE_PAYLOAD_SENTINEL";
const descriptor = { description: "Inspect or change a resource.", parameters: { type: "object" } };
const encoded = (name: string, input: Record<string, unknown>) =>
  JSON.stringify(buildJevMetadata(name, input, descriptor));

describe("Jev metadata-only boundary", () => {
  it("retains direct file operation paths while withholding bodies", () => {
    const result = buildJevMetadata(
      "write",
      { path: "src/example.ts", content: SECRET },
      descriptor,
    );
    expect(result.metadata).toMatchObject({ path: "src/example.ts", paths: ["src/example.ts"] });
    expect(result.omissions).toContain("file_body_withheld");
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("omits both replacement strings and nested edit payloads", () => {
    const result = buildJevMetadata(
      "edit",
      {
        path: ".forceignore",
        oldText: SECRET,
        newText: `${SECRET}_new`,
        edits: [{ oldText: SECRET, newText: `${SECRET}_nested` }],
      },
      descriptor,
    );
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("accepts large omitted file bodies without silently truncating metadata", () => {
    const result = buildJevMetadata("write", {
      path: "large.txt",
      content: SECRET.repeat(100_000),
    });
    expect(result.complete).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(1024);
  });

  it.each([
    ["sf_apex", { action: "anon.run", body: SECRET, allow_mutation: true }],
    ["sf_soql", { action: "query.run", query: `SELECT ${SECRET} FROM Example__c`, max_rows: 10 }],
    [
      "slack_canvas",
      { action: "edit", canvas_id: "FEXAMPLE", operation: "replace", markdown: SECRET },
    ],
    [
      "data360_api",
      {
        action: "rest.request",
        params: {
          method: "DELETE",
          path: "/ssot/resources/example",
          body: { value: SECRET, password: SECRET },
        },
        allow_confirmed: true,
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "marks omitted arbitrary effects incomplete for %s",
    (name, input) => {
      const result = buildJevMetadata(name, input, descriptor);
      expect(result.complete).toBe(false);
      expect(
        result.omissions.some(
          (category) => category === "payload_withheld" || category === "unknown_fields_withheld",
        ),
      ).toBe(true);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    },
  );

  it("preserves Data 360 method, destination path and execution-intent flags", () => {
    const result = buildJevMetadata("data360_api", {
      action: "rest.request",
      target_org: SECRET,
      dry_run: false,
      allow_confirmed: true,
      params: { method: "DELETE", path: "/ssot/resources/example" },
    });
    expect(result.metadata).toMatchObject({
      action: "rest.request",
      target_org: "explicit",
      dry_run: false,
      allow_confirmed: true,
      params: { method: "DELETE", path: "/ssot/resources/example" },
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(extractJevTargetOrg("data360_api", { target_org: SECRET })).toBe(SECRET);
  });

  it("retains known browser refs and mutation flags but omits model-supplied prose", () => {
    const result = buildJevMetadata("sf_browser_click", {
      ref: "@e3",
      mutation: true,
      reason: SECRET,
    });
    expect(result.metadata).toMatchObject({ ref: "@e3", mutation: true });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.complete).toBe(false);
    expect(buildJevMetadata("sf_browser_press", { key: "Control+Enter" }).complete).toBe(true);
  });

  it("includes unfamiliar tools conservatively without echoing raw arguments or unknown keys", () => {
    const result = buildJevMetadata(
      "fixture_catalog",
      {
        action: "inspect",
        path: "resources/example",
        execute: false,
        args: { text: SECRET },
        [SECRET]: { transcript: SECRET },
        credentials: { password: SECRET },
      },
      descriptor,
    );
    expect(result.toolName).toBe("fixture_catalog");
    expect(result.metadata).toMatchObject({
      action: "inspect",
      path: "resources/example",
      execute: false,
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not guess known effect completeness from an unfamiliar descriptor", () => {
    expect(
      buildJevMetadata(
        "third_party",
        { action: "read" },
        {
          description: "Read-only and already approved.",
          parameters: { type: "object", properties: { action: { type: "string" } } },
        },
      ).complete,
    ).toBe(false);
    expect(buildJevMetadata("sf_browser_new_action", {}, descriptor).complete).toBe(false);
    expect(buildJevMetadata("agentscript_lifecycle", { action: "delete" }).complete).toBe(false);
  });

  it("includes only parameter shape, excluding schema prose, defaults, examples and enum payloads", () => {
    const result = buildJevMetadata(
      "third_party",
      {},
      {
        description: "A resource helper.",
        parameters: {
          type: "object",
          description: SECRET,
          default: { body: SECRET },
          properties: {
            action: {
              type: "string",
              description: SECRET,
              default: SECRET,
              enum: [SECRET],
              examples: [SECRET],
            },
            payload: { type: "object", properties: { secret: { default: SECRET } } },
          },
          required: ["action"],
        },
      },
    );
    expect(result.metadata.parameterShape).toEqual([
      { name: "action", type: "string", required: true },
      { name: "payload", type: "object", required: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("projects real installed SDK TypeBox schemas without hidden annotations or payload defaults", () => {
    const parameters = Type.Object({
      action: Type.String({ description: SECRET, default: SECRET }),
      path: Type.Optional(Type.String({ description: SECRET })),
    });
    const result = buildJevMetadata(
      "fixture_catalog",
      { action: "inspect" },
      {
        description: "An inert resource fixture.",
        parameters,
      },
    );
    expect(result.metadata.parameterShape).toEqual([
      { name: "action", type: "string", required: true },
      { name: "path", type: "string", required: false },
    ]);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("~kind");
    expect(JSON.stringify(result)).not.toContain("~optional");
  });

  it("does not invoke schema getters, including ignored prose/defaults", () => {
    let calls = 0;
    const getter = () => {
      calls++;
      throw new Error(SECRET);
    };
    const field = { type: "string" };
    Object.defineProperty(field, "description", { enumerable: true, get: getter });
    Object.defineProperty(field, "default", { enumerable: true, get: getter });
    const parameters = { properties: { path: field } };
    Object.defineProperty(parameters, "examples", { enumerable: true, get: getter });
    expect(
      buildJevMetadata("read", { path: "example.txt" }, { description: "Read a file.", parameters })
        .metadata.parameterShape,
    ).toEqual([{ name: "path", type: "string", required: false }]);
    const trap = Object.defineProperty({}, "properties", { enumerable: true, get: getter });
    expect(() =>
      buildJevMetadata(
        "read",
        { path: "example.txt" },
        { description: "Read a file.", parameters: trap },
      ),
    ).toThrowError(/^Invalid Jev tool metadata\.$/);
    expect(calls).toBe(0);
  });

  it("keeps rejecting non-enumerable annotations on raw tool input", () => {
    const input = Object.defineProperty({ path: "example.txt" }, "~kind", { value: "Object" });
    expect(() => buildJevMetadata("read", input)).toThrowError(/^Invalid Jev tool metadata\.$/);
  });

  it.each([
    `A helper with https://example.invalid/path?token=${SECRET}`,
    `A helper with Authorization: Bearer ${SECRET}`,
    `A helper with api_key=${SECRET}`,
  ])("withholds registration prose containing an endpoint or credential", (description) => {
    const result = buildJevMetadata("read", { path: "README.md" }, { description });
    expect(result.description).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("removes destination URL userinfo, query and fragment", () => {
    const result = buildJevMetadata("third_party", {
      destination: `https://user:${SECRET}@example.invalid/resource?query=${SECRET}#${SECRET}`,
    });
    expect(result.metadata.destination).toBe("https://example.invalid/resource");
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("removes API route query strings without treating API routes as local files", () => {
    const result = buildJevMetadata("data360_api", {
      action: "rest.request",
      params: { method: "GET", path: `/ssot/resources?sql=${SECRET}#${SECRET}` },
    });
    expect(result.metadata.params).toEqual({ method: "GET", path: "/ssot/resources" });
    expect(result.metadata.paths).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    ["read", { path: 123 }],
    ["read", {}],
    ["write", { path: "file.txt" }],
    ["edit", { path: "file.txt" }],
    ["write", { path: "file.txt", content: { text: SECRET } }],
    ["sf_apex", { action: "anon.run", body: { code: SECRET } }],
    ["sf_soql", { action: "query.run", max_rows: "ten" }],
    ["data360_api", { action: "rest.request", params: [] }],
    ["data360_api", { action: "rest.request", params: { method: SECRET } }],
    ["bash", { command: "echo 'unterminated" }],
    ["bash", { command: `echo ${SECRET}\\` }],
    ["bash", { command: `echo ${SECRET} &&` }],
    ["bash", { command: `&& echo ${SECRET}` }],
    ["bash", { command: "echo >" }],
    ["third_party", { timeout: Infinity }],
    ["third_party", { body: new Date() }],
  ] as Array<[string, Record<string, unknown>]>)(
    "rejects malformed %s metadata using a fixed sanitized error",
    (name, input) => {
      expect(() => buildJevMetadata(name, input)).toThrowError(/^Invalid Jev tool metadata\.$/);
    },
  );

  it("rejects cycles, depth overflow, node overflow, accessors and non-JSON shapes", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.body = cyclic;
    let deep: Record<string, unknown> = {};
    for (let i = 0; i < 40; i++) deep = { body: deep };
    const getter = Object.defineProperty({}, "body", {
      enumerable: true,
      get() {
        throw new Error(SECRET);
      },
    });
    for (const input of [
      cyclic,
      deep,
      { body: Array(4097).fill(SECRET) },
      getter,
      { body: undefined },
    ]) {
      expect(() => buildJevMetadata("third_party", input)).toThrowError(
        /^Invalid Jev tool metadata\.$/,
      );
    }
  });

  it("sanitizes exceptions from malformed descriptors and object traps", () => {
    const trapped = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(SECRET);
        },
      },
    );
    const badDescriptor = {
      get description(): string {
        throw new Error(SECRET);
      },
    };
    expect(() => buildJevMetadata("third_party", trapped)).toThrowError(
      /^Invalid Jev tool metadata\.$/,
    );
    expect(() => buildJevMetadata("third_party", {}, badDescriptor)).toThrowError(
      /^Invalid Jev tool metadata\.$/,
    );
  });

  it("rejects oversized outbound metadata with a sanitized error", () => {
    const paths = Array.from({ length: 20 }, (_, i) => `file${i}_${"x".repeat(2048)}`);
    expect(() => buildJevMetadata("bash", { command: `rm ${paths.join(" ")}` })).toThrowError(
      /^Invalid Jev tool metadata\.$/,
    );
  });
});

describe("conservative shell metadata extraction", () => {
  it("preserves static executable, subcommands, enum flags and schema-defined paths", () => {
    const result = buildJevMetadata("bash", {
      command: `sf project deploy validate --target-org ${SECRET} --manifest 'manifest/package.xml' --test-level RunLocalTests --json`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "sf",
          subcommands: ["project", "deploy", "validate"],
          flags: [
            { name: "--target-org", value: "explicit" },
            { name: "--manifest", value: "manifest/package.xml" },
            { name: "--test-level", value: "RunLocalTests" },
            { name: "--json" },
          ],
        },
      ],
      operators: [],
    });
    expect(result.metadata.paths).toEqual(["manifest/package.xml"]);
    expect(result.metadata.target_org).toBe("explicit");
    expect(extractJevTargetOrg("bash", { command: `sf org display --target-org ${SECRET}` })).toBe(
      SECRET,
    );
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("retains command chains and redirection identity without literal or comment leakage", () => {
    const result = buildJevMetadata("bash", {
      command: `echo '${SECRET}; rm ignored' > 'out file.txt' && rm -rf 'temporary dir' || true; cat README.md | head -n 10 # ${SECRET}\n`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        { executable: "echo" },
        { executable: "rm", paths: ["temporary dir"] },
        { executable: "true" },
        { executable: "cat", paths: ["README.md"] },
        { executable: "head", flags: [{ name: "-n", value: 10 }] },
      ],
      operators: [">", "&&", "||", ";", "|", "\n"],
    });
    expect(result.metadata.paths).toEqual(["out file.txt", "temporary dir", "README.md"]);
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("distinguishes adjacent file descriptors from numeric positional paths", () => {
    expect(buildJevMetadata("bash", { command: "rm 2 > output.txt" }).metadata.paths).toEqual([
      "output.txt",
      "2",
    ]);
    const result = buildJevMetadata("bash", { command: "echo hello 2> errors.txt" });
    expect(result.metadata.shell).toMatchObject({ operators: ["2>"] });
    expect(result.metadata.paths).toEqual(["errors.txt"]);
  });

  it("retains curl method and destination while excluding all credentials and request bodies", () => {
    const result = buildJevMetadata("bash", {
      command: `curl -X DELETE -H 'Authorization: Bearer ${SECRET}' --data '{"text":"${SECRET}"}' 'https://example.invalid/resources?api_key=${SECRET}'`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "curl",
          method: "DELETE",
          destinations: ["https://example.invalid/resources"],
        },
      ],
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("reports curl's implicit data POST without exposing its payload", () => {
    const result = buildJevMetadata("bash", {
      command: `curl --data=${SECRET} https://example.invalid/resources`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [{ executable: "curl", method: "POST" }],
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not assign another executable's path flag to shell literal text", () => {
    const result = buildJevMetadata("bash", { command: `echo --file ${SECRET}` });
    expect(result.complete).toBe(false);
    expect(result.metadata.paths).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("withholds all argument roles after unknown options rather than guessing literal paths", () => {
    for (const command of [
      `rm --not-recognized ${SECRET} target.txt`,
      `cat --not-recognized=${SECRET} target.txt`,
      `sf org display --manifest ${SECRET}`,
      `git diff -n ${SECRET}`,
      `chmod ${SECRET} target.txt`,
    ]) {
      const result = buildJevMetadata("bash", { command });
      expect(result.complete).toBe(false);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it("treats private method-override headers as opaque effects", () => {
    const result = buildJevMetadata("bash", {
      command: `curl -H 'X-HTTP-Method-Override: DELETE' https://example.invalid/resource`,
    });
    expect(result.complete).toBe(false);
    expect(result.omissions).toContain("shell_effects_opaque");
    expect(JSON.stringify(result)).not.toContain("X-HTTP-Method-Override");
  });

  it.each([
    `bash -c 'rm ${SECRET}; curl https://example.invalid/${SECRET}'`,
    `node -e 'console.log("${SECRET}")'`,
    `python3 -c 'print("${SECRET}")'`,
    `eval '${SECRET}'`,
    `source '${SECRET}'`,
    `rm "$${SECRET}/file"`,
    `echo $(cat ${SECRET})`,
    `echo \`cat ${SECRET}\``,
    `cat <<EOF\n${SECRET}\nEOF`,
    `env TOKEN=${SECRET} rm /tmp/example`,
    `TOKEN=${SECRET} curl https://example.invalid/resources`,
    `${SECRET} arbitrary-values`,
    `sf ${SECRET} --json`,
    `git config alias.example '${SECRET}'`,
    `curl --unknown=${SECRET} https://example.invalid/resources`,
  ])("marks unknown or dynamic effects opaque without leaking their values", (command) => {
    const result = buildJevMetadata("bash", { command }, descriptor);
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("preserves herdr_pane runs without the legacy risk registry prefilter", () => {
    const result = buildJevMetadata("herdr_pane", {
      action: "run",
      pane: "pane-1",
      command: "pwd",
    });
    expect(result.metadata).toMatchObject({
      action: "run",
      pane: "pane-1",
      shell: { commands: [{ executable: "pwd" }] },
    });
    expect(result.complete).toBe(true);
  });

  it("does not select an arbitrary org from a mixed-org shell chain", () => {
    const command =
      "sf org display --target-org sandbox-a && sf org display --target-org sandbox-b";
    expect(extractJevTargetOrg("bash", { command })).toBeUndefined();
    expect(buildJevMetadata("bash", { command }).complete).toBe(false);
  });

  it("does not bind a single explicit org to another command's implicit default", () => {
    const command = "sf org display --target-org sandbox-a && sf project deploy start --json";
    expect(extractJevTargetOrg("bash", { command })).toBeUndefined();
    const result = buildJevMetadata("bash", { command });
    expect(result.complete).toBe(false);
    expect(result.metadata.shell).toMatchObject({ orgContext: "ambiguous_multiple_commands" });
  });

  it("does not claim unsupported file or shell dry-run flags are execution semantics", () => {
    for (const [name, input] of [
      ["write", { path: "example.txt", content: SECRET, dry_run: true }],
      ["bash", { command: "rm example.txt", dry_run: true }],
    ] as Array<[string, Record<string, unknown>]>) {
      const result = buildJevMetadata(name, input);
      expect(result.metadata.dry_run).toBeUndefined();
      expect(result.complete).toBe(false);
    }
  });

  it("honors option terminators when a path resembles a flag", () => {
    const result = buildJevMetadata("bash", { command: "rm -- -rf" });
    expect(result.metadata.shell).toMatchObject({
      commands: [{ executable: "rm", paths: ["-rf"], flags: [{ name: "--" }] }],
    });
    expect(result.complete).toBe(true);
  });

  it("does not claim an arbitrary executable path has the known command's effects", () => {
    expect(
      buildJevMetadata("bash", { command: "/tmp/untrusted/sf org display --json" }).complete,
    ).toBe(false);
  });

  it("omits generic raw command-like fields on unfamiliar tools", () => {
    expect(encoded("custom", { command: `echo ${SECRET}`, action: "execute" })).not.toContain(
      SECRET,
    );
  });
});
