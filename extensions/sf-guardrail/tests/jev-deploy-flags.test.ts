/* SPDX-License-Identifier: Apache-2.0 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildJevMetadata } from "../lib/jev-metadata.ts";

const schemaFile = process.env.SF_GUARDRAIL_DEPLOY_SCHEMA_FILE;
const operations = [
  "project deploy start",
  "project deploy validate",
  "project deploy preview",
  "project deploy quick",
  "project deploy report",
  "project deploy resume",
];
const flags = ["--dry-run", "--check-only", "--checkonly", "--use-most-recent"];
const cases = operations.flatMap((operation) =>
  flags.map((flag) => ({
    operation,
    flag,
    supported:
      (operation === "project deploy start" && flag === "--dry-run") ||
      (["project deploy quick", "project deploy report", "project deploy resume"].includes(
        operation,
      ) &&
        flag === "--use-most-recent"),
  })),
);

function observe(operation: string, flag: string, executable = "sf") {
  const result = buildJevMetadata("bash", { command: `${executable} ${operation} ${flag}` });
  const shell = result.metadata.shell as {
    commands: Array<{ subcommands?: string[]; flags?: Array<{ name: string }> }>;
  };
  return { result, command: shell.commands[0] };
}

describe("Salesforce deploy flag metadata", () => {
  it.each(cases)(
    "observes $flag only on its supported operation $operation",
    ({ operation, flag, supported }) => {
      for (const executable of ["sf", "sfdx"]) {
        const { result, command } = observe(operation, flag, executable);
        expect(command.subcommands).toEqual(operation.split(" "));
        expect(command.flags).toEqual([{ name: supported ? flag : "unknown" }]);
        expect(result.complete).toBe(supported);
        expect(result.metadata).not.toHaveProperty("executionFlags");
        expect(command).not.toHaveProperty("planningOnly");
        if (!supported) expect(result.omissions).toContain("shell_effects_opaque");
      }
    },
  );

  it.each(["force:source:deploy", "force:mdapi:deploy"])(
    "keeps the unsupported legacy operation %s unknown",
    (operation) => {
      for (const executable of ["sf", "sfdx"]) {
        const { result, command } = observe(operation, "--checkonly", executable);
        expect(result.complete).toBe(false);
        expect(result.omissions).toContain("shell_effects_opaque");
        expect(command).not.toHaveProperty("subcommands");
        expect(JSON.stringify(result)).not.toContain("--checkonly");
        expect(result.metadata).not.toHaveProperty("executionFlags");
      }
    },
  );

  it.each(["--check-only", "--checkonly"])(
    "keeps later org operands local after unsupported deploy flag %s",
    (flag) => {
      const result = buildJevMetadata("bash", {
        command: `sf project deploy start ${flag} -o PRIVATE_TARGET_SENTINEL`,
      });
      expect(result.metadata.shell).toMatchObject({
        commands: [{ subcommands: ["project", "deploy", "start"], flags: [{ name: "unknown" }] }],
      });
      expect(result.complete).toBe(false);
      expect(result.omissions).toContain("shell_effects_opaque");
      expect(JSON.stringify(result)).not.toContain("PRIVATE_TARGET_SENTINEL");
    },
  );
});

describe.skipIf(!schemaFile)("installed primary Salesforce deploy schemas", () => {
  function commands() {
    if (!schemaFile) throw new Error("Missing explicit deploy schema file.");
    return (
      JSON.parse(readFileSync(schemaFile, "utf8")) as {
        commands: Record<
          string,
          {
            aliases?: string[];
            flags: Record<string, { type: string; char?: string; aliases?: string[] }>;
          }
        >;
      }
    ).commands;
  }

  it.each(cases)("matches the declared boolean flag $flag on $operation", ({ operation, flag }) => {
    const schema = commands()[operation.replaceAll(" ", ":")];
    expect(schema).toBeDefined();
    const supported = Object.entries(schema.flags).some(
      ([name, value]) =>
        value.type === "boolean" &&
        [
          `--${name}`,
          ...(value.char ? [`-${value.char}`] : []),
          ...(value.aliases ?? []).map((alias) => `--${alias}`),
        ].includes(flag),
    );
    const { result, command } = observe(operation, flag);
    expect(command.flags).toEqual([{ name: supported ? flag : "unknown" }]);
    expect(result.complete).toBe(supported);
  });

  it.each(["force:source:deploy", "force:mdapi:deploy"])(
    "does not invent an absent command or alias %s",
    (operation) => {
      const schema = commands();
      expect(schema[operation]).toBeUndefined();
      expect(Object.values(schema).some((command) => command.aliases?.includes(operation))).toBe(
        false,
      );
      expect(observe(operation, "--checkonly").result.complete).toBe(false);
    },
  );
});
