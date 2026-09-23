/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it } from "vitest";
import { Type } from "typebox";
import { readFileSync } from "node:fs";
import {
  buildJevMetadata,
  extractJevTargetOrg,
  jevShellExecutableHeads,
} from "../lib/jev-metadata.ts";
import type { JevToolMetadata } from "../lib/types.ts";

const SECRET = "PRIVATE_PAYLOAD_SENTINEL";
const descriptor = { description: "Inspect or change a resource.", parameters: { type: "object" } };
const encoded = (name: string, input: Record<string, unknown>) =>
  JSON.stringify(buildJevMetadata(name, input, descriptor));
const baselineCommands = (
  JSON.parse(
    readFileSync(
      new URL("../../../scripts/fixtures/jev-guardrail-baseline-dev.json", import.meta.url),
      "utf8",
    ),
  ) as {
    cases: Array<{ id: string; input: Record<string, unknown> }>;
  }
).cases.filter((fixture) => fixture.id.startsWith("command-"));

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
    expect(result.complete).toBe(true);
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
    expect(result.metadata).toEqual({});
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
    const result = buildJevMetadata("data360_api", {
      action: "rest.request",
      params: {
        destination: `https://user:${SECRET}@example.invalid/resource?query=${SECRET}#${SECRET}`,
      },
    });
    expect(result.metadata.params).toEqual({ destination: "https://example.invalid/resource" });
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

describe("schema-based shell effect coverage", () => {
  it("covers all 62 frozen baseline command families without consulting their decisions", () => {
    expect(baselineCommands).toHaveLength(62);
  });

  it.each(baselineCommands)(
    "retains known executable and operation metadata for $id",
    (fixture) => {
      const result = buildJevMetadata("bash", fixture.input);
      const shell = result.metadata.shell as { commands: Array<Record<string, unknown>> };
      expect(shell.commands.length).toBeGreaterThan(0);
      expect(
        shell.commands.every(
          (command) => !["unknown", "opaque"].includes(command.executable as string),
        ),
      ).toBe(true);
      expect(result.metadata.command).toBeUndefined();
      expect(result.metadata.args).toBeUndefined();
      const privateOperands = [
        "example_user",
        "example_group",
        "example_process",
        "example_container",
        "example_namespace",
        "example_database",
        "example_package",
        "example_library",
        "example_file",
        "example_push_request",
        "example_session",
        "example-plugin",
        "EvalScratch",
        "cHJpbnRm",
      ];
      for (const operand of privateOperands) expect(JSON.stringify(result)).not.toContain(operand);
    },
  );

  it.each([
    ["pi auth check", { executable: "pi", subcommands: ["auth", "check"] }],
    [
      "pi auth check --credentials",
      { executable: "pi", subcommands: ["auth", "check"], flags: [{ name: "--credentials" }] },
    ],
    ["pi auth print-api-key", { executable: "pi", subcommands: ["auth", "print-api-key"] }],
    [
      "pi auth print-bearer-token",
      { executable: "pi", subcommands: ["auth", "print-bearer-token"] },
    ],
    [
      "git status --short",
      { executable: "git", subcommands: ["status"], flags: [{ name: "--short" }] },
    ],
    [
      "git reset --soft",
      { executable: "git", subcommands: ["reset"], flags: [{ name: "--soft" }] },
    ],
    [
      "terraform apply -destroy",
      { executable: "terraform", subcommands: ["apply"], flags: [{ name: "-destroy" }] },
    ],
    [
      "redis-cli flushall ASYNC",
      { executable: "redis-cli", subcommands: ["FLUSHALL"], mode: "ASYNC" },
    ],
    ["chmod -R a+rwx build", { executable: "chmod", mode: "a+rwx", paths: ["build"] }],
    [
      "truncate -s 0 activity.log",
      { executable: "truncate", flags: [{ name: "-s", value: "0" }], paths: ["activity.log"] },
    ],
    [
      "mkfs -t ext4 /dev/example",
      { executable: "mkfs", flags: [{ name: "-t", value: "ext4" }], paths: ["/dev/example"] },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "retains schema-proven distinctions for %s",
    (command, effect) => {
      const result = buildJevMetadata("bash", { command });
      expect(result.metadata.shell).toMatchObject({ commands: [effect] });
      expect(result.complete).toBe(true);
    },
  );

  it("records dd source and destination roles without treating all operands as file paths", () => {
    const result = buildJevMetadata("bash", {
      command: `dd if=input.img of=output.img bs=4M count=0 conv=notrunc status=progress ignored=${SECRET}`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "dd",
          operands: [
            { name: "if", path: "input.img" },
            { name: "of", path: "output.img" },
            { name: "bs", value: "4M" },
            { name: "count", value: "0" },
            { name: "conv", value: "notrunc" },
            { name: "status", value: "progress" },
          ],
        },
      ],
    });
    expect(result.metadata.paths).toEqual(["input.img", "output.img"]);
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("shows the public find-exec operation while withholding arbitrary command arguments", () => {
    const result = buildJevMetadata("bash", {
      command: `find build -exec rm --unknown ${SECRET} {} \\;`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "find",
          paths: ["build"],
          flags: [{ name: "-exec", command: { executable: "rm", target: "current_match" } }],
        },
      ],
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it.each([
    "env pi auth print-api-key",
    "nohup pi auth print-api-key",
    "timeout 5s pi auth print-api-key",
    "sudo pi auth print-api-key",
    "env nohup timeout 5s pi auth print-api-key",
  ])("retains static nested operations through %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        { executable: "pi", subcommands: ["auth", "print-api-key"], wrappers: expect.any(Array) },
      ],
    });
    expect(result.complete).toBe(true);
  });

  it("keeps generic assignments private and marks altered environment incomplete", () => {
    const result = buildJevMetadata("bash", {
      command: `env PRIVATE_TOKEN=${SECRET} pi auth print-api-key --provider ${SECRET}`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "pi",
          subcommands: ["auth", "print-api-key"],
          environmentAssignments: 1,
          flags: [{ name: "--provider", value: "specified" }],
        },
      ],
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("PRIVATE_TOKEN");
  });

  it("retains the public SF display option's boolean effect without forwarding generic environment values", () => {
    const result = buildJevMetadata("bash", {
      command: `SF_TEMP_SHOW_SECRETS=true PRIVATE_TOKEN=${SECRET} sf org display -o ${SECRET}`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "sf",
          environmentFlags: { SF_TEMP_SHOW_SECRETS: true },
          subcommands: ["org", "display"],
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result.complete).toBe(false);
  });

  it("recognizes operations after known global options without exposing context identifiers", () => {
    for (const command of [
      `docker --context ${SECRET} system prune`,
      `kubectl -n ${SECRET} delete pods --all`,
      `redis-cli -h ${SECRET} -p 6379 FLUSHDB`,
      `agent-browser --session ${SECRET} click @e1`,
      `sf -o ${SECRET} org display --json`,
    ]) {
      const result = buildJevMetadata("bash", { command });
      expect(
        (result.metadata.shell as { commands: Array<{ subcommands?: unknown }> }).commands[0]
          .subcommands,
      ).toBeDefined();
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });

  it.each([
    `pi auth print-api-key --provider ${SECRET}`,
    `pi auth check --provider=${SECRET}`,
    `docker rm -f ${SECRET}`,
    `dropdb ${SECRET}`,
    `redis-cli -a ${SECRET} SET ${SECRET} ${SECRET}`,
    `pkill -9 '${SECRET}.*'`,
    `killall --signal KILL ${SECRET}`,
    `chown -R ${SECRET} build`,
    `chgrp -R ${SECRET} build`,
    `mkfs.ext4 -L ${SECRET} /dev/example`,
    `find build -name ${SECRET} -delete`,
    `kubectl patch pods ${SECRET} --patch ${SECRET}`,
    `terraform apply -var ${SECRET}`,
    `agent-browser fill '${SECRET}' '${SECRET}'`,
    `agent-browser eval '${SECRET}'`,
    `sf plugins install ${SECRET}`,
    `sf package push-upgrade abort --push-request-id ${SECRET}`,
    `sf agent adl file delete --library-id ${SECRET} --file-id ${SECRET}`,
    `shutdown -h now '${SECRET}'`,
    `bash -c 'pi auth print-api-key ${SECRET}'`,
  ])("withholds payloads and scalar identifier roles in %s", (command) => {
    expect(encoded("bash", { command })).not.toContain(SECRET);
  });

  it.each([
    `pi auth print-api-key-extra ${SECRET}`,
    `docker system prune-extra ${SECRET}`,
    `rm --namespace ${SECRET} build`,
    `docker inspect --filename ${SECRET}`,
    `kubectl exec --filename ${SECRET}`,
    `terraform validate -out ${SECRET}`,
    `mkfs.unknown ${SECRET}`,
    `find build -unknown ${SECRET}`,
    `truncate -s ${SECRET} target.txt`,
    `shred --label ${SECRET} archive.txt`,
    `find build -print ${SECRET}`,
    `find build -delete ${SECRET}`,
    `mkfs.ext4 /dev/example ${SECRET}`,
    `base64 input.txt ${SECRET}`,
    `terraform apply -out ${SECRET}`,
  ])("does not project near misses or another operation's value roles for %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("retains initial find paths and the numeric mkfs blocks operand according to their arity", () => {
    expect(buildJevMetadata("bash", { command: "find src tests -print" }).metadata.paths).toEqual([
      "src",
      "tests",
    ]);
    const filesystem = buildJevMetadata("bash", { command: "mkfs.ext4 /dev/example 1024" });
    expect(filesystem.metadata.shell).toMatchObject({
      commands: [{ executable: "mkfs.ext4", paths: ["/dev/example"], blocks: 1024 }],
    });
    expect(filesystem.metadata.paths).toEqual(["/dev/example"]);
    expect(filesystem.complete).toBe(true);
    expect(
      buildJevMetadata("bash", { command: "terraform plan -out plan.tfplan" }).metadata.paths,
    ).toEqual(["plan.tfplan"]);
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
    expect(result.complete).toBe(false);
    expect(result.metadata.shell).toMatchObject({ policyTokens: "comments_withheld" });
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

describe("ambiguous roles remain private", () => {
  it.each([
    `mkfs.ext4 -L $LABEL_ARGS ${SECRET} /dev/example`,
    `mkfs.ext4 -L "$LABEL_ARGS" ${SECRET} /dev/example`,
    `cat -n $ARGS ${SECRET}`,
    `rm -- $ARGS ${SECRET}`,
    `git config --file $FILE_ARGS ${SECRET}`,
    `curl --user $AUTH_ARGS https://example.invalid/${SECRET}`,
    `docker --context $CONTEXT_ARGS system prune ${SECRET}`,
    `truncate --size $SIZE_ARGS ${SECRET}`,
    `find build -name $PATTERN_ARGS ${SECRET}`,
  ])("withholds later argument roles after dynamic option values in %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect((result.metadata.paths as string[] | undefined) ?? []).not.toContain("/dev/example");
    expect(result.omissions).toContain("shell_values_withheld");
  });

  it.each([
    `env -u $ENV_ARGS cat ${SECRET}`,
    `env --unset "$ENV_ARGS" cat ${SECRET}`,
    `sudo -u $SUDO_ARGS cat ${SECRET}`,
    `sudo -g "$SUDO_ARGS" cat ${SECRET}`,
    `env PRIVATE=$ASSIGN_ARGS cat ${SECRET}`,
    `PRIVATE=$ASSIGN_ARGS cat ${SECRET}`,
    `env nohup timeout $DURATION_ARGS cat ${SECRET}`,
  ])("does not infer a static nested executable from dynamic wrapper fields in %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.metadata.shell).toMatchObject({ commands: [{ executable: "opaque" }] });
    expect(result.metadata.paths).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not bind an org parsed before an expansion that could override its role", () => {
    const command = "sf org display -o static-sandbox --json $EXTRA_ARGS";
    expect(extractJevTargetOrg("bash", { command })).toBeUndefined();
    expect(buildJevMetadata("bash", { command }).complete).toBe(false);
  });

  it.each([
    `/tmp/untrusted/cat ${SECRET}`,
    `./cat ${SECRET}`,
    `/usr/bin/cat ${SECRET}`,
    `/tmp/untrusted/env cat ${SECRET}`,
    `/tmp/untrusted/sudo cat ${SECRET}`,
    `/tmp/untrusted/nohup cat ${SECRET}`,
    `/tmp/untrusted/timeout 5s cat ${SECRET}`,
    `/tmp/untrusted/sf org display --file ${SECRET}`,
    `/tmp/untrusted/docker system prune ${SECRET}`,
  ])("does not apply a known basename's schema to qualified executable %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.metadata.shell).toMatchObject({ commands: [{ executable: "unknown" }] });
    expect(result.metadata.paths).toBeUndefined();
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(
      (result.metadata.shell as { commands: Array<Record<string, unknown>> }).commands[0]
        .subcommands,
    ).toBeUndefined();
  });

  it("keeps arbitrary find-exec executable paths opaque", () => {
    const result = buildJevMetadata("bash", {
      command: `find build -exec /tmp/untrusted/rm -rf ${SECRET} {} \\;`,
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [{ flags: [{ name: "-exec", command: { executable: "opaque" } }] }],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(JSON.stringify(result)).not.toContain("-rf");
  });

  it.each([
    "path",
    "file",
    "file_path",
    "output_file",
    "object",
    "ref",
    "agent_api_name",
    "canvas_id",
    "url",
    "destination",
    "endpoint",
    "action",
    "operation",
    "method",
    "pane",
    "target_org",
    "format",
    "api",
    "output_mode",
  ])("does not infer a scalar value role from unfamiliar tool field %s", (field) => {
    const result = buildJevMetadata(
      "unfamiliar_tool",
      { [field]: SECRET },
      {
        description: "Inspect or mutate a resource.",
        parameters: Type.Object({ [field]: Type.String({ default: SECRET }) }),
      },
    );
    expect(result.metadata).toEqual({
      parameterShape: [{ name: field, type: "string", required: true }],
    });
    expect(result.complete).toBe(false);
    expect(result.omissions).toContain("unfamiliar_tool_effects");
    expect(result.omissions).toContain("unknown_fields_withheld");
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("withholds unfamiliar boolean/numeric values as well as strings", () => {
    const result = buildJevMetadata("unfamiliar_tool", {
      execute: true,
      dry_run: false,
      allow_confirmed: true,
      limit: 12345,
    });
    expect(result.metadata).toEqual({});
    expect(result.complete).toBe(false);
  });

  it.each(["sudo", "sf org delete"])(
    "records omitted comment tokens without echoing the %s text",
    (comment) => {
      const result = buildJevMetadata("bash", { command: `git status # ${comment} ${SECRET}` });
      expect(result.metadata.shell).toMatchObject({
        commands: [{ executable: "git", subcommands: ["status"] }],
        policyTokens: "comments_withheld",
      });
      expect(result.complete).toBe(false);
      expect(result.omissions).toContain("shell_values_withheld");
      expect(JSON.stringify(result)).not.toContain(comment);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    },
  );

  it("distinguishes quoted and escaped hash literals from comments", () => {
    for (const command of [`echo '# ${SECRET}'`, `echo \\# ${SECRET}`]) {
      const result = buildJevMetadata("bash", { command });
      expect(result.complete).toBe(true);
      expect((result.metadata.shell as Record<string, unknown>).policyTokens).toBeUndefined();
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
  });
});

describe("verified Salesforce CLI structural forms", () => {
  it("preserves the exact legacy checkonly boolean spelling recognized by the baseline", () => {
    const result = buildJevMetadata("bash", {
      command: "sf project deploy start --checkonly -o EvalProduction",
    });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "sf",
          subcommands: ["project", "deploy", "start"],
          flags: [{ name: "--checkonly" }, { name: "-o", value: "explicit" }],
        },
      ],
    });
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain("EvalProduction");
  });

  it.each([
    "sf api request rest /services/data/v60.0/limits -o EvalProduction",
    "sf -o EvalProduction api request rest /services/data/v60.0/limits",
  ])("records documented default GET with a static positional endpoint in %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.metadata.shell).toMatchObject({
      commands: [
        {
          executable: "sf",
          subcommands: ["api", "request", "rest"],
          apiPath: "/services/data/v60.0/limits",
          method: "GET",
        },
      ],
    });
    expect(result.metadata.paths).toBeUndefined();
    expect(result.complete).toBe(true);
    expect(JSON.stringify(result)).not.toContain("EvalProduction");
  });

  it("retains an explicit supported REST method instead of substituting the default", () => {
    const result = buildJevMetadata("bash", {
      command:
        "sf api request rest /services/data/v60.0/sobjects/Account --method DELETE -o EvalProduction",
    });
    expect(result.metadata.shell).toMatchObject({ commands: [{ method: "DELETE" }] });
    expect(result.complete).toBe(true);
  });

  it("keeps the unverified org-api-rest endpoint grammar incomplete", () => {
    const result = buildJevMetadata("bash", {
      command: `sf org api rest --method GET --endpoint /services/data/v60.0/${SECRET} -o EvalProduction`,
    });
    expect(result.complete).toBe(false);
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(
      (result.metadata.shell as { commands: Array<Record<string, unknown>> }).commands[0].apiPath,
    ).toBeUndefined();
  });

  it.each([
    `sf api request rest /services/data/v60.0/limits --file ${SECRET}`,
    `sf api request rest /services/data/v60.0/limits $EXTRA_ARGS ${SECRET}`,
  ])("does not assign default GET through an opaque request override in %s", (command) => {
    const result = buildJevMetadata("bash", { command });
    expect(result.complete).toBe(false);
    expect(
      (result.metadata.shell as { commands: Array<Record<string, unknown>> }).commands[0].method,
    ).toBeUndefined();
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("does not project a second REST positional string as another endpoint", () => {
    const result = buildJevMetadata("bash", {
      command: `sf api request rest /services/data/v60.0/limits /${SECRET}`,
    });
    expect(result.complete).toBe(false);
    expect(result.metadata.shell).toMatchObject({
      commands: [{ apiPath: "/services/data/v60.0/limits" }],
    });
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });
});

describe("shared structural executable heads", () => {
  it("includes every complete command and transparent wrapper head", () => {
    const metadata = buildJevMetadata("bash", {
      command: "sudo nohup timeout 5s env git status --short && pwd",
    });
    expect(metadata.complete).toBe(true);
    expect(jevShellExecutableHeads(metadata)).toEqual(
      new Set(["git", "sudo", "nohup", "timeout", "env", "pwd"]),
    );
  });

  it("does not collapse complete commands merely because private scalar values were withheld", () => {
    const metadata = buildJevMetadata("bash", { command: `pi auth check --provider ${SECRET}` });
    expect(metadata.complete).toBe(true);
    expect(metadata.omissions).toContain("shell_values_withheld");
    expect(jevShellExecutableHeads(metadata)).toEqual(new Set(["pi"]));
  });

  it.each([
    "git status # omitted policy tokens",
    "unknown-command arbitrary",
    "bash -c 'arbitrary script'",
    "env -u $UNKNOWN_ARGS git status",
    "sf org display && sf org list",
  ])("leaves executable coverage unrestricted for incomplete %s", (command) => {
    expect(jevShellExecutableHeads(buildJevMetadata("bash", { command }))).toBeUndefined();
  });

  it.each([
    undefined,
    {},
    { commands: [] },
    { commands: [{ executable: "git" }], policyTokens: "comments_withheld" },
    { commands: [{}] },
    { commands: [{ executable: "" }] },
    { commands: [{ executable: "unknown" }] },
    { commands: [{ executable: "opaque" }] },
    { commands: [{ executable: "git", wrappers: [{}] }] },
    { commands: [{ executable: "git", wrappers: [{ executable: "opaque" }] }] },
  ])("leaves missing/opaque structural coverage unrestricted: %j", (shell) => {
    const metadata: JevToolMetadata = {
      toolName: "bash",
      metadata: { shell },
      complete: true,
      omissions: [],
    };
    expect(jevShellExecutableHeads(metadata)).toBeUndefined();
  });
});
