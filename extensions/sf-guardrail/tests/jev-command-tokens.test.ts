/* SPDX-License-Identifier: Apache-2.0 */
import { describe, expect, it, vi } from "vitest";
import { evaluateCommand } from "../lib/command-gate.ts";
import { buildJevCommandTokenContext } from "../lib/jev-command-tokens.ts";
import { evaluateSafety } from "../lib/safety-kernel.ts";
import type { CommandGateConfig, CommandPattern } from "../lib/types.ts";

const gate = (patch: Partial<CommandGateConfig> = {}): CommandGateConfig => ({
  patterns: [],
  allowedPatterns: [],
  autoDenyPatterns: [],
  ...patch,
});
const rule = (pattern: string, patch: Partial<CommandPattern> = {}): CommandPattern => ({
  id: "private-rule-name",
  pattern,
  ...patch,
});
const project = (command: string, config: CommandGateConfig) =>
  buildJevCommandTokenContext(command, config) as any;
const classFor = (context: any, id: number) =>
  context.operation.classes.find((row: any) => row.id === id);
vi.mock("../../../lib/common/sf-environment/shared-runtime.ts", () => ({
  getCachedSfEnvironment: () => null,
}));
vi.mock("../../../lib/common/sf-environment/detect.ts", () => ({
  detectConfig: async () => {
    throw new Error("unexpected-org-lookup");
  },
  detectOrg: async () => {
    throw new Error("unexpected-org-lookup");
  },
}));
const deterministic = (command: string, commandGate: CommandGateConfig) =>
  evaluateSafety({
    toolName: "bash",
    input: { command },
    cwd: "/fixture-project",
    config: {
      version: 1,
      productionAliases: [],
      headlessEscapeHatchEnv: "FIXTURE_ALLOW",
      confirmTimeoutMs: 120000,
      policies: { rules: [] },
      orgAwareGate: { rules: [] },
      commandGate,
    },
  });

describe("privacy-preserving legacy command token context", () => {
  it("separates the withheld-operand collision through within-request equality", () => {
    const config = gate({ autoDenyPatterns: [rule("fixture_private_restricted_operand")] });
    const restricted = "echo fixture_private_restricted_operand";
    const ordinary = "echo fixture_private_public_operand";
    expect(evaluateCommand(restricted, config)?.action).toBe("autodeny");
    expect(evaluateCommand(ordinary, config)).toBeUndefined();
    const a = project(restricted, config);
    const b = project(ordinary, config);
    expect(a.policy.autoDenyPatterns[0].tokens[0]).toBe(a.operation.flat[1]);
    expect(b.policy.autoDenyPatterns[0].tokens[0]).not.toBe(b.operation.flat[1]);
    expect(a).not.toEqual(b);
    for (const context of [a, b]) {
      const wire = JSON.stringify(context);
      expect(wire).not.toMatch(/fixture_private|private-rule-name|echo/);
      expect(wire).not.toMatch(/matched|verdict|risk|hash|dictionary/);
    }
  });

  it("keeps a quoted multiword argument distinct from individually quoted tokens", () => {
    const config = gate({ patterns: [rule("sf project delete source", { behavior: "block" })] });
    const individual = 'echo "sf" "project" "delete" "source"';
    const combined = 'echo "sf project delete source"';
    expect(evaluateCommand(individual, config)?.matched?.behavior).toBe("block");
    expect(evaluateCommand(combined, config)).toBeUndefined();
    const a = project(individual, config);
    const b = project(combined, config);
    expect(a.policy.patterns[0].tokens).toEqual(a.operation.flat.slice(1));
    expect(b.operation.flat).toHaveLength(2);
    expect(b.policy.patterns[0].tokens).toHaveLength(4);
    expect(a.policy.patterns[0].behavior).toBe("block");
    expect(JSON.stringify(a)).not.toContain("sf");
    expect(JSON.stringify(b)).not.toContain("source");
  });

  it("retains the baseline flat window across original command boundaries", () => {
    const config = gate({ autoDenyPatterns: [rule("alpha echo beta")] });
    const command = "echo alpha; echo beta";
    expect(evaluateCommand(command, config)?.action).toBe("autodeny");
    const context = project(command, config);
    expect(context.operation.original).toHaveLength(2);
    expect(context.policy.autoDenyPatterns[0].tokens).toEqual(context.operation.flat.slice(1));
  });

  it("retains legacy comment tokens without exposing comment text", () => {
    const command = "echo safe # fixture_private_comment_literal";
    const config = gate({ autoDenyPatterns: [rule("fixture_private_comment_literal")] });
    expect(evaluateCommand(command, config)?.action).toBe("autodeny");
    const context = project(command, config);
    expect(context.policy.autoDenyPatterns[0].tokens[0]).toBe(context.operation.flat.at(-1));
    expect(JSON.stringify(context)).not.toContain("fixture_private_comment_literal");
  });

  it("records parent-first nested expansion without returning inline script source", () => {
    const command = 'env bash -c "git reset --hard fixture_private_revision"';
    const config = gate({ patterns: [rule("git reset --hard")] });
    expect(evaluateCommand(command, config)?.action).toBe("confirm");
    const context = project(command, config);
    expect(context.operation.original).toHaveLength(1);
    expect(context.operation.expanded).toHaveLength(3);
    const row = context.policy.patterns[0];
    const nested = context.operation.expanded[2];
    expect(row.tokens).toEqual([nested.head, ...nested.args.slice(0, 2)]);
    expect(JSON.stringify(context)).not.toMatch(/fixture_private_revision|git reset|--hard/);
  });

  it("preserves the original adjacency used by the downloader sentinel for semicolons too", () => {
    const config = gate({ autoDenyPatterns: [rule("remote-script-to-shell")] });
    for (const command of ["curl fixture_private_url | bash", "curl fixture_private_url; bash"]) {
      expect(evaluateCommand(command, config)?.action).toBe("autodeny");
      const context = project(command, config);
      const row = context.policy.autoDenyPatterns[0];
      expect(row.kind).toBe("remote_script_to_shell");
      expect(row.downloaders).toContain(context.operation.original[0].head);
      expect(row.shells).toContain(context.operation.original[1].head);
      expect(JSON.stringify(context)).not.toContain("fixture_private_url");
    }
  });

  it("keeps decoder flags and shell adjacency as opaque structural facts", () => {
    const config = gate({ patterns: [rule("base64-decode-to-shell")] });
    const command = "echo fixture_private_encoded | base64 --decode && zsh";
    expect(evaluateCommand(command, config)?.action).toBe("confirm");
    const context = project(command, config);
    const row = context.policy.patterns[0];
    expect(row.head).toBe(context.operation.original[1].head);
    expect(row.decodeArgs).toContain(context.operation.original[1].args[0]);
    expect(row.shells).toContain(context.operation.original[2].head);
    expect(JSON.stringify(context)).not.toContain("fixture_private_encoded");
  });

  it("keeps ordinary whitespace variants separate from exact special sentinels", () => {
    const command = "dd of=fixture_private_output";
    const exact = gate({ allowedPatterns: [rule("  dd of=  ")] });
    const spaced = gate({ allowedPatterns: [rule("dd   of=")] });
    expect(evaluateCommand(command, exact)?.action).toBe("allow");
    expect(evaluateCommand(command, spaced)).toBeUndefined();
    expect(project(command, exact).policy.allowedPatterns[0].kind).toBe("dd_output");
    expect(project(command, spaced).policy.allowedPatterns[0].kind).toBe("tokens");
  });

  it("uses separate equality and delimiter-prefix namespaces for dd and mkfs", () => {
    const config = gate({ patterns: [rule("dd of="), rule("mkfs.*")] });
    const context = project("dd of=fixture_private_disk; echo mkfs.ext4", config);
    expect(evaluateCommand("dd of=fixture_private_disk", config)?.matched?.pattern).toBe("dd of=");
    expect(evaluateCommand("echo mkfs.ext4", config)?.matched?.pattern).toBe("mkfs.*");
    const dd = context.operation.expanded[0];
    const mkfs = context.operation.expanded[1];
    expect(classFor(context, dd.args[0]).equalsPrefix).toBe(
      context.policy.patterns[0].equalsPrefix,
    );
    expect(classFor(context, mkfs.args[0]).dotPrefix).toBe(context.policy.patterns[1].dotPrefix);
    expect(JSON.stringify(context)).not.toMatch(/fixture_private_disk|mkfs\.ext4|of=/);
  });

  it("serializes find argument positions rather than a matched flag", () => {
    const config = gate({ patterns: [rule("find -delete"), rule("find -exec rm")] });
    const command = "find fixture_private_path -exec echo rm \\;";
    expect(evaluateCommand(command, config)?.matched?.pattern).toBe("find -exec rm");
    const context = project(command, config);
    const row = context.policy.patterns[1];
    const args = context.operation.expanded[0].args;
    expect(args.indexOf(row.rm)).toBeGreaterThan(args.indexOf(row.exec));
    expect(JSON.stringify(context)).not.toContain("fixture_private_path");
  });

  it.each([
    "pi auth print-api-key fixture_private_provider",
    "$PI auth print-api-key fixture_private_provider",
    "${PI} auth print-api-key fixture_private_provider",
    "env -u fixture_private_env pi auth check --credentials",
    'timeout 15 bash -c "pi auth print-bearer-token fixture_private_provider"',
    "npx --package @earendil-works/pi-coding-agent pi auth print-api-key",
    "npx @earendil-works/pi-coding-agent@fixture_private_version auth print-api-key",
    'npx --call "pi auth print-api-key fixture_private_provider"',
    "{ pi auth print-api-key; }",
    "( pi auth print-api-key )",
    "fixture_private_env=value command pi auth print-api-key",
    "sudo -u fixture_private_user pi auth print-api-key",
  ])("projects Pi argument structure for %s", (command) => {
    const config = gate({ autoDenyPatterns: [rule("pi-auth-credential-output")] });
    expect(evaluateCommand(command, config)?.action).toBe("autodeny");
    const context = project(command, config);
    const row = context.policy.autoDenyPatterns[0];
    expect(context.operation.piArgs.length).toBeGreaterThan(0);
    expect(context.operation.piArgs.some((args: number[]) => args[0] === row.auth)).toBe(true);
    expect(JSON.stringify(context)).not.toMatch(
      /fixture_private|@earendil|print-api-key|--credentials/,
    );
    // The row field name "credentials" is public schema, not a literal value.
  });

  it("preserves active policy order and moves ordinary off rows into effect waivers", () => {
    const config = gate({
      allowedPatterns: [rule("alpha", { behavior: "block" }), rule("beta", { enabled: false })],
      autoDenyPatterns: [
        rule("alpha", { behavior: "confirm" }),
        rule("gamma", { behavior: "off" }),
      ],
      patterns: [
        rule("alpha", { action: "block" }),
        rule("beta"),
        rule("gamma", { enabled: false }),
      ],
    });
    expect(evaluateCommand("echo alpha", config)?.action).toBe("allow");
    const context = project("echo alpha beta gamma", config);
    expect(context.operation.version).toBe(2);
    expect(context.policy.allowedPatterns.map((row: any) => row.behavior)).toEqual(["allow"]);
    expect(context.policy.autoDenyPatterns.map((row: any) => row.behavior)).toEqual(["block"]);
    expect(context.policy.patterns.map((row: any) => row.behavior)).toEqual(["block", "confirm"]);
    expect(context.policy.patterns.map((row: any) => row.tokens[0])).toEqual(
      context.operation.flat.slice(1, 3),
    );
    expect(context.policy.effectWaivers.map((row: any) => row.behavior)).toEqual(["off"]);
    expect(context.policy.effectWaivers[0].tokens).toEqual(context.operation.flat.slice(3));
  });

  it("omits disabled allow exceptions so an active auto-deny remains a baseline block", async () => {
    const command = "echo fixture_private_restricted_operand";
    const config = gate({
      allowedPatterns: [rule("fixture_private_restricted_operand", { enabled: false })],
      autoDenyPatterns: [rule("fixture_private_restricted_operand")],
    });
    expect((await deterministic(command, config))?.action).toBe("block");
    const context = project(command, config);
    expect(context.policy.allowedPatterns).toEqual([]);
    expect(context.policy.effectWaivers).toEqual([]);
    expect(context.policy.autoDenyPatterns[0].behavior).toBe("block");
    expect(context.policy.autoDenyPatterns[0].tokens[0]).toBe(context.operation.flat[1]);
  });

  it("omits disabled auto-deny rows so the actual baseline allows", async () => {
    const command = "git status";
    const config = gate({ autoDenyPatterns: [rule("git status", { behavior: "off" })] });
    expect((await deterministic(command, config))?.action ?? "allow").toBe("allow");
    const context = project(command, config);
    expect(context.policy.autoDenyPatterns).toEqual([]);
    expect(context.policy.effectWaivers).toEqual([]);
    expect(context).toEqual(project(command, gate()));
  });

  it.each([
    ["block", "confirm"],
    ["confirm", "block"],
  ] as const)(
    "keeps an off ordinary row from masking first-active %s before %s",
    async (first, second) => {
      const command = "echo fixture_private_operand";
      const config = gate({
        patterns: [
          rule("fixture_private_operand", { behavior: "off" }),
          rule("fixture_private_operand", { behavior: first }),
          rule("fixture_private_operand", { behavior: second }),
        ],
      });
      expect((await deterministic(command, config))?.action).toBe(first);
      const context = project(command, config);
      expect(context.policy.patterns.map((row: any) => row.behavior)).toEqual([first, second]);
      expect(context.policy.effectWaivers.map((row: any) => row.behavior)).toEqual(["off"]);
      expect(context.policy.effectWaivers[0].tokens).toEqual(context.policy.patterns[0].tokens);
      expect(context.policy.patterns[0].tokens[0]).toBe(context.operation.flat[1]);
    },
  );

  it("omits inactive allow/deny words and special constants from every outbound class", () => {
    const command = "git status";
    const config = gate({
      allowedPatterns: [
        rule("fixture_private_disabled_allow=value.ext@version", { behavior: "off" }),
        rule("dd of=", { enabled: false }),
      ],
      autoDenyPatterns: [
        rule("fixture_private_disabled_deny=value.ext@version", { enabled: false }),
        rule("remote-script-to-shell", { behavior: "off" }),
      ],
    });
    const context = project(command, config);
    expect(context).toEqual(project(command, gate()));
    expect(JSON.stringify(context)).toBe(JSON.stringify(project(command, gate())));
    expect(JSON.stringify(context)).not.toMatch(/fixture_private|dd_output|remote_script_to_shell/);
  });

  it("preserves exact special syntax for off ordinary effect-waiver rows", () => {
    const command = "dd of=fixture_private_output";
    const config = gate({
      patterns: [rule("dd of=", { behavior: "off" }), rule("dd   of=", { enabled: false })],
    });
    const context = project(command, config);
    expect(context.policy.patterns).toEqual([]);
    expect(context.policy.effectWaivers.map((row: any) => row.kind)).toEqual([
      "dd_output",
      "tokens",
    ]);
    expect(classFor(context, context.operation.expanded[0].args[0]).equalsPrefix).toBe(
      context.policy.effectWaivers[0].equalsPrefix,
    );
    expect(JSON.stringify(context)).not.toContain("fixture_private_output");
  });

  it("validates inactive rows and aggregate bounds before omitting them", () => {
    for (const key of ["allowedPatterns", "autoDenyPatterns", "patterns"] as const) {
      const bad = [
        rule("safe", { enabled: false, behavior: "invalid" as any }),
        rule("safe", { behavior: "off", action: "invalid" as any }),
        rule(42 as any, { enabled: false }),
        rule("fixture_private_large".repeat(7000), { enabled: false }),
        rule(Array.from({ length: 4100 }, () => "safe").join(" "), { enabled: false }),
        rule(Array.from({ length: 2050 }, (_, index) => `private_token_${index}`).join(" "), {
          enabled: false,
        }),
      ];
      for (const candidate of bad)
        expect(() => project("git status", gate({ [key]: [candidate] }))).toThrowError(
          "unsupported-command-token-context",
        );
      expect(() =>
        project(
          "git status",
          gate({ [key]: Array.from({ length: 257 }, () => rule("safe", { enabled: false })) }),
        ),
      ).toThrowError("unsupported-command-token-context");
      expect(() =>
        project(
          "git status",
          gate({
            [key]: Array.from({ length: 128 }, () =>
              rule(`fixture_private_${"x".repeat(1024)}`, { enabled: false }),
            ),
          }),
        ),
      ).toThrowError("unsupported-command-token-context");
      let invoked = false;
      const candidate = rule("safe", { enabled: false });
      Object.defineProperty(candidate, "description", {
        get: () => {
          invoked = true;
          return "fixture_private_getter";
        },
      });
      expect(() => project("git status", gate({ [key]: [candidate] }))).toThrowError(
        "unsupported-command-token-context",
      );
      expect(invoked).toBe(false);
      const symbolic = rule("safe", { enabled: false });
      Object.defineProperty(symbolic, Symbol("private"), {
        get: () => {
          invoked = true;
          return "fixture_private_getter";
        },
      });
      expect(() => project("git status", gate({ [key]: [symbolic] }))).toThrowError(
        "unsupported-command-token-context",
      );
      expect(invoked).toBe(false);
      const inherited = Object.assign(Object.create({ enabled: false }), rule("safe"));
      expect(() => project("git status", gate({ [key]: [inherited] }))).toThrowError(
        "unsupported-command-token-context",
      );
    }
  });

  it("uses request-local first-seen labels without Unicode hash collisions", () => {
    const a = project("echo fixture_private_alpha", gate());
    const b = project("printf fixture_private_beta", gate());
    expect(a).toEqual(b); // IDs describe relationships, never a stable lexical identity.
    const high = "\ud800";
    const low = "\udc00";
    const context = project(`echo '${high}' '${low}'`, gate({ patterns: [rule(high)] }));
    expect(context.operation.flat[1]).not.toBe(context.operation.flat[2]);
    expect(context.policy.patterns[0].tokens[0]).toBe(context.operation.flat[1]);
    expect(JSON.stringify(context)).not.toContain("\\ud800");
  });

  it("links only caller-supplied public grammar words to the shared equality classes", () => {
    const config = gate({ patterns: [rule("fixture_private_custom_pattern"), rule("git status")] });
    const context = buildJevCommandTokenContext(
      "git status --short fixture_private_body_sentinel",
      config,
      { publicWords: ["git", "status", "--short", "git"] },
    ) as any;
    expect(context.operation.publicSyntax).toEqual([
      { word: "git", id: context.operation.flat[0] },
      { word: "status", id: context.operation.flat[1] },
      { word: "--short", id: context.operation.flat[2] },
    ]);
    expect(context.policy.patterns[1].tokens).toEqual(context.operation.flat.slice(0, 2));
    expect(JSON.stringify(context)).not.toMatch(/fixture_private|private-rule-name/);
    expect(project("git status", gate()).operation.publicSyntax).toEqual([]);
  });

  it("rejects unsupported public grammar mappings atomically without invoking getters", () => {
    for (const publicWords of [
      [""],
      ["has whitespace"],
      ["private/path"],
      ["quoted'word"],
      ["é"],
      ["a".repeat(129)],
      Array.from({ length: 257 }, () => "git"),
    ]) {
      expect(() => buildJevCommandTokenContext("git status", gate(), { publicWords })).toThrowError(
        "unsupported-command-token-context",
      );
    }
    let invoked = false;
    const options = {};
    Object.defineProperty(options, "publicWords", {
      get: () => {
        invoked = true;
        return ["fixture_private_getter"];
      },
    });
    expect(() => buildJevCommandTokenContext("git status", gate(), options)).toThrowError(
      "unsupported-command-token-context",
    );
    expect(invoked).toBe(false);
    const words = ["git"];
    Object.defineProperty(words, Symbol.iterator, {
      get: () => {
        invoked = true;
        throw new Error("private-iterator");
      },
    });
    expect(() =>
      buildJevCommandTokenContext("git status", gate(), { publicWords: words }),
    ).toThrowError("unsupported-command-token-context");
    expect(invoked).toBe(false);
    const custom = ["git"];
    Object.defineProperty(custom, Symbol.iterator, {
      value: () => {
        invoked = true;
        throw new Error("private-iterator");
      },
    });
    const bounded = buildJevCommandTokenContext("git status", gate(), {
      publicWords: custom,
    }) as any;
    expect(bounded.operation.publicSyntax).toEqual([
      { word: "git", id: bounded.operation.flat[0] },
    ]);
    expect(invoked).toBe(false);
  });

  it("preserves the legacy expansion cutoff rather than claiming deeper views", () => {
    const command = `${"env ".repeat(7)}pi auth print-api-key`;
    const config = gate({ patterns: [rule("pi-auth-credential-output")] });
    expect(evaluateCommand(command, config)?.action).toBe("confirm");
    const context = project(command, config);
    expect(context.operation.expanded).toHaveLength(5);
    expect(context.operation.piArgs).toHaveLength(5);
  });

  it("rejects tokenless fallback shapes and oversized work atomically with sanitized errors", () => {
    expect(evaluateCommand("''", gate({ autoDenyPatterns: [rule("'")] }))?.action).toBe("autodeny");
    const invalid = [
      "",
      "   ",
      "''",
      `echo ${"fixture_private_large".repeat(7000)}`,
      Array.from({ length: 257 }, () => "echo safe").join(";"),
      `echo ${Array.from({ length: 4100 }, () => "safe").join(" ")}`,
      `${"env ".repeat(40)}pi auth print-api-key`,
    ];
    for (const command of invalid) {
      expect(() => project(command, gate())).toThrowError("unsupported-command-token-context");
    }
    expect(() =>
      project("echo safe", gate({ patterns: Array.from({ length: 257 }, () => rule("safe")) })),
    ).toThrowError("unsupported-command-token-context");
    expect(() =>
      project("echo safe", gate({ patterns: [rule("fixture_private_large".repeat(7000))] })),
    ).toThrowError("unsupported-command-token-context");
  });

  it("rejects getter-backed policy fields without evaluating them", () => {
    let invoked = false;
    const candidate = { id: "private" } as CommandPattern;
    Object.defineProperty(candidate, "pattern", {
      enumerable: true,
      get: () => {
        invoked = true;
        return "fixture_private_getter";
      },
    });
    expect(() => project("echo safe", gate({ patterns: [candidate] }))).toThrowError(
      "unsupported-command-token-context",
    );
    expect(invoked).toBe(false);
    const indexed: CommandPattern[] = [];
    Object.defineProperty(indexed, 0, {
      get: () => {
        invoked = true;
        return rule("fixture_private_getter");
      },
    });
    expect(() => project("echo safe", gate({ patterns: indexed }))).toThrowError(
      "unsupported-command-token-context",
    );
    expect(invoked).toBe(false);
  });

  it("rejects a large serialized context even when lexical work stays under its bounds", () => {
    const command = `echo ${Array.from({ length: 1300 }, (_, index) => `fixture_token_${index}`).join(" ")}`;
    expect(() => project(command, gate())).toThrowError("unsupported-command-token-context");
    expect(() => project("echo safe", gate({ patterns: [rule("   ")] }))).not.toThrow();
    expect(project("echo safe", gate({ patterns: [rule("   ")] })).policy.patterns[0].kind).toBe(
      "empty",
    );
  });
});
