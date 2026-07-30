# ADR 0005: Standard Pi-Native Command Panels

## Status

Accepted; the no-args navigation decision is superseded by ADR 0051

## Context

SF Pi now ships enough slash-command surfaces that discoverability is becoming a
product problem. Some extensions have a compact Pi-native action panel, while
others rely on text-only help, ad hoc setup wizards, or a bespoke full-screen
manager overlay. Users should not need to memorize every subcommand under names
like `/sf-llm-gateway-internal`, and troubleshooting flows such as doctor,
probe, refresh, and health checks should explain themselves before the user runs
them.

The current baseline is mixed:

| Extension                      | Current primary surface                                                       | Gap against the standard                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `sf-lsp`                       | `/sf-lsp` opens a compact `DynamicBorder` + `SelectList` status/actions panel | This is the target pattern.                                                                |
| `sf-pi-manager`                | `/sf-pi` opens a bespoke custom overlay with list/detail/config routing       | Powerful, but different from every other extension and more code to maintain.              |
| `sf-llm-gateway-internal`      | Text status/help plus a custom setup/config flow                              | Too many subcommands; completions are incomplete and mostly lack descriptions.             |
| `sf-guardrail`                 | Text status/list/audit commands plus a config panel in the manager            | Needs a no-args action panel that groups status, rules, audit, forget, and preset install. |
| `sf-slack`                     | Text status/help plus settings panel and many agent tools                     | Needs a no-args action panel for auth, refresh, settings, sent audit, and help.            |
| `sf-agentscript`               | Minimal doctor/check text commands                                            | Needs a small status/actions panel.                                                        |
| `sf-devbar`                    | Toggle command and `/sf-org` text summary                                     | Needs a small status/actions panel for toggle, org status, and help.                       |
| `sf-feedback`                  | Guided feedback wizard                                                        | Wizard can stay, but diagnostics/help should be discoverable as actions.                   |
| `sf-skills-hud`, `sf-welcome`  | Mostly passive UI with simple commands                                        | Lightweight action panels are optional but should follow the same shape when added.        |
| `sf-brain`, `sf-ohana-spinner` | Passive/no-command extensions                                                 | No panel needed; manager/catalog detail is enough.                                         |

## Decision

> **ADR 0051 amendment:** Every bundled interactive no-args `/sf-*` command now
> opens that extension's SF Pi Manager detail page. Explicit subcommands remain
> direct. Specialized/full-screen workflows launch through an explicit action.
> The panel construction, action metadata, mode fallback, settings, and
> diagnostics rules below still apply to explicit interactive action surfaces.

Use Pi-native panel primitives for explicit interactive action surfaces:

1. **Interactive actions are mode-aware.** Custom panels open only when
   `ctx.mode === "tui"`. RPC mode has `ctx.hasUI === true`, but custom TUI
   components are not available there; RPC uses Pi-native dialog/notification
   methods such as `ctx.ui.select()` and `ctx.ui.notify()`. Print/JSON modes fall
   back to concise text status plus help.
2. **Panels are Pi-native TUI components**, built from existing primitives such
   as `DynamicBorder`, `SelectList`, `SettingsList`, `Text`, and `Spacer`, and
   guarded by `ctx.mode === "tui"`. Avoid one-off custom routers unless the
   surface truly needs custom rendering like the startup splash.
3. **Every action has a label and description.** Descriptions must explain what
   the action does and any safety/troubleshooting implication. The description is
   rendered in the panel and reused in command completions when possible.
4. **One action catalog drives Manager actions, explicit panels, help, and
   completions.** Extensions should define their command metadata once and reuse
   it for:
   - `getArgumentCompletions()` with `AutocompleteItem.description`
   - `/extension help`
   - the Manager detail action list
   - any explicit interactive action panel
   - extension README command tables
5. **Canonical subcommands are visible; aliases remain accepted.** Help and
   panels show canonical names like `doctor`, `refresh`, `setup`, `models`, and
   `tokens`. Parsers may keep short aliases such as `dr`, but aliases should not
   be the only discoverability path.
6. **Config panels are for settings, not navigation.** Existing
   `lib/config-panel.ts` implementations remain Manager-mounted settings pages.
   An explicit `settings` subcommand may deep-link to that same page, but must not
   create a second settings UI. New or touched preference surfaces should expose
   descriptor-backed fields (key, label, description, values, default) so the
   Manager and future Pi-native settings surfaces can reuse the same semantics.
7. **Diagnostics and health actions are first-class.** Troubleshooting commands
   such as `doctor`, `probe`, `health`, `refresh`, `install status`, and `sent`
   should be grouped under clear section labels and should use action
   descriptions that explain when to run them.
8. **Enable/disable remains centralized in SF Pi Manager**, because it mutates
   Pi package filters and reloads the runtime. Other extension panels may offer
   extension-local on/off behavior, but bundled extension enable/disable should
   link users back to `/sf-pi`.

## Canonical filenames

ADR 0005 (originally) didn't pin a filename for the per-extension panel
module, and three names emerged in the wild: `lib/panel.ts`,
`lib/config-panel.ts`, and `lib/settings-panel.ts`. That ambiguity made
it hard to tell at a glance which file owned which surface, so the
standard now reserves three names — each for one purpose:

| Filename                   | Purpose                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `lib/command-panel.ts`     | An explicit grouped status/action panel built on `lib/common/command-panel.ts`; never the bundled no-args route.    |
| `lib/config-panel.ts`      | The `ConfigPanelFactory` invoked by sf-pi-manager when `manifest.configurable === true`. Required for that surface. |
| `lib/preferences-panel.ts` | A separate mutable user-preferences UI, when distinct from `config-panel.ts` (e.g. opened by `/sf-<id> settings`).  |

The deprecated names `lib/panel.ts` and `lib/settings-panel.ts` are
rejected by `npm run check:panels`. Most extensions inline their panel
directly inside `index.ts` and never need a separate file; pull it out
only when the panel logic exceeds ~50 lines.

## Target explicit-action panel shape

When an explicit action genuinely needs a grouped extension panel, it should fit
this skeleton:

```text
<Extension Name> — status & controls

Status
  <short health/config/runtime lines>

Actions
  Refresh status        Re-probe connection or runtime state
  Open settings         Edit saved config for this extension
  Run doctor            Diagnose setup problems and print repair steps
  Show help             Print the complete command reference
  Close                 Dismiss this panel

↑↓ navigate • enter select • esc close
```

For implementation, prefer a small shared helper under
`lib/common/command-panel/` after at least two more extensions need the same
component. Until then, copy the simple `sf-lsp/lib/panel.ts` pattern instead of
building a broad abstraction prematurely.

A shared action type should be intentionally small:

```ts
type SfPiCommandAction = {
  id: string;
  label: string;
  description: string;
  command?: string;
  section?: "status" | "setup" | "diagnostics" | "tools" | "help";
  danger?: "none" | "confirm" | "write";
  run(ctx: ExtensionCommandContext): Promise<void>;
};
```

## Current migration direction

1. Migrate every bundled interactive no-args `/sf-*` command to its Manager
   detail page.
2. Preserve explicit subcommands as direct, scriptable paths with noninteractive
   text fallbacks.
3. Launch full-screen or specialized UI only through explicit subcommands or
   Manager actions.
4. Reuse one action catalog for Manager rows, completion, help, and docs when
   the grammar is simple.
5. Retain explicit grouped panels only where they add behavior that Manager
   actions and direct commands cannot express cleanly.

## Consequences

- Users get one mental model: type the no-args extension command to enter its
  Manager page; type an explicit subcommand to execute directly.
- Slash completion becomes self-documenting because subcommands carry
  descriptions.
- Existing text commands remain scriptable and stable.
- RPC/SDK workflows do not get routed into TUI-only `ctx.ui.custom()` surfaces
  just because `ctx.hasUI` is true.
- Descriptor-backed preference modules become the migration path toward future
  Pi-native extension settings menus.
- Some bespoke UI code can be removed from `sf-pi-manager` over time.
- The first migration should avoid a large shared framework. Extract common code
  only once the pattern has repeated enough to prove the abstraction.
