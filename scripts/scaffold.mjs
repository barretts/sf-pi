/* SPDX-License-Identifier: Apache-2.0 */

// Scaffold a new sf-pi extension.
//
// Usage: node scripts/scaffold.mjs --id <extension-id> --category <category> --intent <intent-group> [--name "Display Name"]
// See docs/adr/0006-extension-consistency-baseline.md for the category taxonomy.
//
// Creates:
//   extensions/<id>/
//     index.ts          — entry point with behavior contract template
//     manifest.json     — metadata (source of truth for the catalog)
//     README.md         — per-extension documentation
//     lib/              — implementation modules
//     tests/
//       smoke.test.ts   — basic smoke test (red → green starting point)
//
// Then regenerates catalog/registry.ts and catalog/index.json.

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const EXTENSIONS_DIR = path.join(ROOT, "extensions");

// -------------------------------------------------------------------------------------------------
// Parse args
// -------------------------------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2);
  const result = { id: "", category: "", intent: "", name: "" };

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--id" && args[i + 1]) {
      result.id = args[++i];
    } else if (args[i] === "--category" && args[i + 1]) {
      result.category = args[++i];
    } else if (args[i] === "--intent" && args[i + 1]) {
      result.intent = args[++i];
    } else if (args[i] === "--name" && args[i + 1]) {
      result.name = args[++i];
    }
  }

  return result;
}

function toDisplayName(id) {
  return id
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// -------------------------------------------------------------------------------------------------
// Templates
// -------------------------------------------------------------------------------------------------

function indexTs(id, name) {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/**
 * ${id} behavior contract
 *
 * - TODO: Describe when this extension activates
 * - TODO: Describe what it does
 * - TODO: Describe when it stays silent
 *
 * Behavior matrix:
 *
 *   Event/Trigger          | Result
 *   -----------------------|--------------------------------------------
 *   session_start          | TODO
 *   /${id} (no args)       | Open the extension in the SF Pi Manager
 *   /${id} status          | Print status as plain text (headless-safe)
 *   /${id} help            | Print command usage as plain text
 */
import type {
  ExtensionAPI,
  ExtensionCommandContext,
} from "@earendil-works/pi-coding-agent";
import {
  type CommandPanelAction,
  type CommandPanelState,
  openCommandPanel,
} from "../../lib/common/command-panel.ts";
import { openInfoPanel, type InfoPanelSeverity } from "../../lib/common/info-panel.ts";
import {
  buildToggleExtensionAction,
  LIFECYCLE_GROUP,
  performToggleExtension,
  type LifecycleActionId,
} from "../../lib/common/extension-toggle.ts";

const COMMAND_NAME = "${id}";

// Action ids exposed by the panel. Extend as the extension grows.
type ${pascal(id)}Action = "status" | "help" | "close" | LifecycleActionId;

const ${constName(id)}_ACTIONS: CommandPanelAction<${pascal(id)}Action>[] = [
  {
    value: "status",
    label: "Show status",
    description: "Print current state for this extension.",
    group: "Diagnostics",
  },
  {
    value: "help",
    label: "Show help",
    description: "Print command usage and links to references.",
    group: "Reference",
  },
  {
    value: "close",
    label: "Close",
    description: "Dismiss this panel.",
    group: LIFECYCLE_GROUP,
  },
];

export default function (pi: ExtensionAPI) {
  pi.registerCommand(COMMAND_NAME, {
    description: "${name} — status & controls",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (sub === "" && ctx.hasUI) {
        await handlePanel(ctx);
        return;
      }
      await handleAction(ctx, sub === "" ? "status" : sub, false);
    },
  });
}

async function handlePanel(ctx: ExtensionCommandContext): Promise<void> {
  const state: CommandPanelState<${pascal(id)}Action> = {};
  await openCommandPanel(ctx, {
    title: "✨ ${name} — status & controls",
    subtitle: "TODO: one-line description.",
    statusLines: () => [
      // TODO: replace with key/value lines describing the extension’s state.
      "• Status placeholder",
    ],
    actions: () => buildActions(ctx.cwd),
    closeValue: "close",
    state,
    onAction: (action) => handleAction(ctx, action, true),
  });
}

function buildActions(cwd: string): CommandPanelAction<${pascal(id)}Action>[] {
  const toggle = buildToggleExtensionAction({ extensionId: "${id}", cwd });
  return toggle ? [...${constName(id)}_ACTIONS, toggle] : ${constName(id)}_ACTIONS;
}

async function handleAction(
  ctx: ExtensionCommandContext,
  action: string,
  fromPanel: boolean,
): Promise<void> {
  if (action === "close") return;
  if (action === "lifecycle.toggle") {
    await performToggleExtension(ctx, "${id}");
    return;
  }
  if (action === "status") {
    await emitOutput(ctx, "${name} status", "TODO: status text", "info", fromPanel);
    return;
  }
  if (action === "help") {
    await emitOutput(ctx, "${name} help", "TODO: help text", "info", fromPanel);
    return;
  }
  await emitOutput(
    ctx,
    "${name} — unknown subcommand",
    \`Unknown /\${COMMAND_NAME} subcommand: \${action}\`,
    "warning",
    fromPanel,
  );
}

async function emitOutput(
  ctx: ExtensionCommandContext,
  title: string,
  body: string,
  severity: InfoPanelSeverity,
  fromPanel: boolean,
): Promise<void> {
  if (fromPanel && ctx.hasUI) {
    await openInfoPanel(ctx, { title, body, severity });
    return;
  }
  if (ctx.hasUI) {
    ctx.ui.notify(body, severity === "success" ? "info" : severity);
    return;
  }
  console.info(body);
}
`;
}

// Helpers used by the index.ts template above.
function pascal(id) {
  return id
    .split("-")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
}
function constName(id) {
  return id.replace(/-/g, "_").toUpperCase();
}

function manifestJson(id, name, category, intent) {
  return (
    JSON.stringify(
      {
        id,
        name,
        description: `TODO: Describe ${name}`,
        category,
        // Maturity defaults to "stable" when omitted. Use "experimental" or
        // "beta" while the extension is still settling.
        maturity: "experimental",
        defaultEnabled: true,
        // Set configurable: true once you add a lib/config-panel.ts that
        // exports `createConfigPanel: ConfigPanelFactory`. Until then,
        // /sf-pi will skip the drill-down panel for this extension.
        commands: [`/${id}`],
        // docs.intentGroup, docs.summary, and docs.primaryFiles are required
        // by scripts/generate-catalog.mjs. Replace the TODO descriptions before
        // opening a PR.
        docs: {
          intentGroup: intent,
          summary: `TODO: Describe ${name} for generated orientation docs`,
          primaryFiles: ["index.ts"],
        },
      },
      null,
      2,
    ) + "\n"
  );
}

function readmeMd(id, name) {
  return `# ${name}

## What It Does

TODO: Describe the current user-visible behavior, how it starts, and when it stays silent.

## Start

\`\`\`text
/${id}
\`\`\`

## Settings and Safety

TODO: Keep only real settings, credentials, safety boundaries, or recovery guidance. Remove this section if none apply.

## File Structure

<!-- GENERATED:file-structure:start -->

\`\`\`
extensions/${id}/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
\`\`\`

<!-- GENERATED:file-structure:end -->
`;
}

function exampleToolTs(id) {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Starter tool registration for ${id}.
 *
 * Convention (AGENTS.md):
 *   - one file per tool: lib/<tool-name>-tool.ts
 *   - export const <NAME>_TOOL_NAME = "<tool>" so panels/configs reference it
 *   - export register<PascalCase>Tool(pi) and call it from the entry point
 *   - add the same tool name to manifest.tools
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export const EXAMPLE_TOOL_NAME = "${id}_example";

const ExampleParams = Type.Object({
  message: Type.String({ description: "Echoed back to the agent." }),
});

export function registerExampleTool(pi: ExtensionAPI): void {
  pi.registerTool<typeof ExampleParams>({
    name: EXAMPLE_TOOL_NAME,
    label: "Example",
    description: "Replace this with the real tool description.",
    parameters: ExampleParams,
    async execute(_id, params) {
      return {
        content: [{ type: "text", text: params.message }],
        details: {},
      };
    },
  });
}
`;
}

function smokeTestTs(id) {
  return `/* SPDX-License-Identifier: Apache-2.0 */
/**
 * Smoke test for ${id}.
 *
 * Verifies the extension module can be imported and exports a default function.
 * This is the starting point for TDD — add specific tests as you build features.
 */
import { describe, it, expect } from "vitest";

describe("${id}", () => {
  it("exports a default function", async () => {
    const mod = await import("../index.ts");
    expect(typeof mod.default).toBe("function");
  });
});
`;
}

// -------------------------------------------------------------------------------------------------
// Main
// -------------------------------------------------------------------------------------------------

const { id, category, intent, name: rawName } = parseArgs();

if (!id || !category || !intent) {
  console.error(
    'Usage: node scripts/scaffold.mjs --id <extension-id> --category <category> --intent <intent-group> [--name "Display Name"]',
  );
  console.error("");
  console.error(
    'Example: node scripts/scaffold.mjs --id sf-code-analyzer --category agent-tool --intent "Build agents" --name "SF Code Analyzer"',
  );
  process.exit(1);
}

// Categories must match catalog/types.ts > ExtensionCategory and the
// VALID_CATEGORIES set in scripts/generate-catalog.mjs. Documented in
// docs/adr/0006-extension-consistency-baseline.md.
const validCategories = ["ui", "provider", "agent-tool", "safety", "assistive", "manager"];
if (!validCategories.includes(category)) {
  console.error(`Invalid category: "${category}". Must be one of: ${validCategories.join(", ")}`);
  process.exit(1);
}

const validIntents = [
  "Build agents",
  "Build apps",
  "Query data",
  "Work with Salesforce orgs",
  "Work with Data Cloud",
  "Work safely",
  "Collaborate and improve",
  "Personalize pi",
];
if (!validIntents.includes(intent)) {
  console.error(`Invalid intent: "${intent}". Must be one of: ${validIntents.join(", ")}`);
  process.exit(1);
}

const name = rawName || toDisplayName(id);
const extDir = path.join(EXTENSIONS_DIR, id);

if (existsSync(extDir)) {
  console.error(`❌ Extension directory already exists: extensions/${id}/`);
  process.exit(1);
}

// Create directories
mkdirSync(path.join(extDir, "lib"), { recursive: true });
mkdirSync(path.join(extDir, "tests"), { recursive: true });

// Write files
writeFileSync(path.join(extDir, "index.ts"), indexTs(id, name));
writeFileSync(path.join(extDir, "manifest.json"), manifestJson(id, name, category, intent));
writeFileSync(path.join(extDir, "README.md"), readmeMd(id, name));
writeFileSync(path.join(extDir, "tests", "smoke.test.ts"), smokeTestTs(id));

// For agent-tool extensions, drop a starter tool module so the convention is
// obvious from day one. See AGENTS.md → "Tool registration convention".
if (category === "agent-tool") {
  writeFileSync(path.join(extDir, "lib", "example-tool.ts"), exampleToolTs(id));
}

console.log(`✅ Scaffolded extensions/${id}/`);
console.log(`   index.ts, manifest.json, README.md, lib/, tests/smoke.test.ts`);
console.log("");

// Regenerate catalog
console.log("Regenerating catalog...");
execSync("node scripts/generate-catalog.mjs", { cwd: ROOT, stdio: "inherit" });

console.log("");
console.log("Next steps:");
console.log(`  1. Edit extensions/${id}/manifest.json — update the description and docs summary`);
console.log(
  `  2. Edit extensions/${id}/README.md and comments — explain the behavior for agents and reviewers`,
);
console.log(`  3. Edit extensions/${id}/index.ts — implement your extension`);
console.log(`  4. Run: npm run format:check — verify formatting`);
console.log(`  5. Run: npm test — your smoke test should pass`);
console.log(`  6. Run: npm run check — verify types`);
