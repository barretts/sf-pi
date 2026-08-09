# sf-pi

[![CI](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/salesforce/sf-pi?sort=semver)](https://github.com/salesforce/sf-pi/releases)
[![CodeQL](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml/badge.svg)](https://github.com/salesforce/sf-pi/actions/workflows/codeql.yml)
[![Coverage](https://codecov.io/gh/salesforce/sf-pi/branch/main/graph/badge.svg)](https://codecov.io/gh/salesforce/sf-pi)
[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](./LICENSE.txt)
[![Node](https://img.shields.io/badge/node-%3E%3D22.19-brightgreen.svg)](https://nodejs.org/)
[![Last commit](https://img.shields.io/github/last-commit/salesforce/sf-pi)](https://github.com/salesforce/sf-pi/commits/main)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

📚 **Documentation:** [salesforce.github.io/sf-pi](https://salesforce.github.io/sf-pi/)

## What is this?

`sf-pi` is a bundle of opinionated extensions for the
[pi coding agent](https://pi.dev) aimed at developers who work on
Salesforce and Salesforce-adjacent codebases. It ships Apex/LWC LSP
diagnostics, Agent Script authoring, Salesforce-aware tools and status
surfaces, and a central manager for enabling or disabling extensions per
project or globally.

![sf-pi updated screenshot 1](https://github.com/user-attachments/assets/cbf2db6b-939c-4c66-8dab-fc505749fc77)

![sf-pi updated screenshot 2](https://github.com/user-attachments/assets/8ee81b93-e336-4726-ba57-013ccbb5b0bf)

## Who built it

sf-pi is hosted at [github.com/salesforce/sf-pi](https://github.com/salesforce/sf-pi)
and maintained by
[Jag Valaiyapathy (@Jaganpro)](https://github.com/Jaganpro) —
a Senior Forward Deployed Engineer at Salesforce and Salesforce Certified
Technical Architect. It builds on
[Mario Zechner's](https://github.com/mariozechner) [pi coding agent](https://pi.dev)
and draws inspiration from the growing ecosystem of community pi
extensions — see [Credits](#credits) at the bottom of this README.

## Getting started

Follow this one-time setup in order.

### 1. Install Node.js and npm

Install [Node.js](https://nodejs.org/) **22.19 or newer**, then use npm 11:

```bash
node --version
npm install --global npm@11
npm --version
```

### 2. Allow immediate package updates

Some managed npm configurations delay newly published packages for seven days.
Set the user-level release age to zero so Pi and its packages can update
immediately:

```bash
npm config set min-release-age 0 --location=user
npm config get min-release-age
```

The final command must print `0`. This changes the npm policy for every install
run by your user, not only Pi.

### 3. Install the latest Pi and SF Pi

These unpinned commands install the latest available releases:

```bash
npm install --global --ignore-scripts @earendil-works/pi-coding-agent
pi --version
pi install git:github.com/salesforce/sf-pi
```

### 4. Install or update Salesforce CLI

```bash
npm install --global @salesforce/cli@latest
sf --version
```

### 5. Start Pi and verify the installation

Run `pi`, then enter:

```text
/reload
/sf-pi doctor
```

### 6. Install Salesforce skills

`sf-skills` is already bundled with SF Pi. Install the managed Salesforce skill
library globally so it is available in every project:

```text
/sf-skills defaults install global
/sf-skills summary
```

### 7. Install the recommended extensions

Install the complete curated package bundle:

```text
/sf-pi recommended install bundle:default
/sf-pi recommended status
```

<details>
<summary><strong>Advanced setup and manual updates</strong></summary>

- Install SF Pi only for the current project with
  `pi install -l git:github.com/salesforce/sf-pi`.
- If terminal glyphs appear as `?`, run `/sf-setup-fonts` and select
  **MesloLGM Nerd Font Mono** in your terminal.
- Update the three core installations with:

  ```bash
  pi update --self
  pi update git:github.com/salesforce/sf-pi
  npm install --global @salesforce/cli@latest
  ```

macOS, Linux, and WSL are the primary targets. Native Windows is supported,
with WSL recommended for parity with Unix shell tooling. SF Pi's stable Pi
range is currently
`>=0.82.0 <1.0.0`. `/sf-pi doctor` reports whether the installed Pi and SF Pi
versions are current.

</details>

## Telemetry and aggregate metrics

sf-pi does **not** collect active runtime telemetry. No bundled extension sends
prompts, responses, tool calls, file paths, Salesforce org identifiers, Slack
identifiers, environment variables, or command usage from your machine.

<details>
<summary><strong>Privacy settings and aggregate metrics</strong></summary>

### Pi runtime defaults

The pi runtime itself emits one anonymous install/update version ping to
`https://pi.dev/api/report-install` after a fresh install or changelog-detected
update. **sf-pi opts you out of this ping by default**: on the first session
after installing sf-pi, `enableInstallTelemetry: false` is written to pi's
global `settings.json` if (and only if) the key is currently unset. An explicit
user opt-in (`true`) is always preserved.

The sf-welcome splash shows a `Privacy: telemetry off (sf-pi default)` row at
every launch so the posture is auditable at a glance. Manage it via:

```text
/sf-pi telemetry status     # show the current state and source
/sf-pi telemetry on         # opt back in (writes enableInstallTelemetry: true)
/sf-pi telemetry off        # opt out (writes enableInstallTelemetry: false)
```

What sf-pi's default does **not** touch (intentional):

- **Latest-version probe** to `https://pi.dev/api/latest-version` stays
  enabled so users still see security/feature update nudges. Disable
  separately with `PI_SKIP_VERSION_CHECK=1` or master-kill with `PI_OFFLINE=1`.
- **`PI_OFFLINE` / `PI_TELEMETRY` env vars or shell rc files** — sf-pi never
  edits your shell environment. The default lives only in pi's `settings.json`.
- **LLM provider traffic** — always determined by the provider you configure.

Maintainers archive aggregate GitHub metrics, such as repository views,
repository clones, and release download counts, through a scheduled GitHub
Actions workflow. These platform metrics help measure discovery and distribution
without adding client-side telemetry.

See [`docs/telemetry.md`](./docs/telemetry.md) for the full privacy policy and
future telemetry requirements.

</details>

## Announcements

<details>
<summary><strong>Announcement controls</strong></summary>

The startup splash can show a small **Announcements** panel for sf-pi
maintainer notes and update nudges. Announcements come from the bundled
[`catalog/announcements.json`](./catalog/announcements.json), optionally merge
with a hosted JSON feed, and fail silently when offline.

Useful commands and controls:

```text
/sf-pi announcements                  # list active announcements
/sf-pi announcements dismiss <id>     # hide one item
/sf-pi announcements reset            # clear local dismissals
SF_PI_ANNOUNCEMENTS=off pi            # disable the feature for one run
SF_PI_ANNOUNCEMENTS_FEED=off pi       # keep bundled notes, skip remote feed
```

Persistent opt-out can also live in Pi settings:

```json
{ "sfPi": { "announcements": false } }
```

Or keep bundled/update notices while disabling only the hosted feed:

```json
{ "sfPi": { "announcements": { "feedEnabled": false } } }
```

</details>

## Command Reference

See the generated [`docs/commands.md`](./docs/commands.md) for the complete
command reference.

<details>
<summary><strong>Show all bundled slash commands</strong></summary>

Every slash command lives inside a bundled extension. This table is the
fastest way to map a command to the extension that owns it. For subcommands
and flags, follow the link into each extension's README, or see the
auto-generated [`docs/commands.md`](./docs/commands.md) for a richer
per-extension view.

<!-- GENERATED:command-reference:start -->

Every slash command exposed by a bundled extension. See each extension README for subcommands and flags.

| Command             | Extension                                          | Category   |
| ------------------- | -------------------------------------------------- | ---------- |
| `/sf-pi`            | [SF Pi Manager](./extensions/sf-pi-manager/)       | manager    |
| `/sf-llm-gateway`   | [SF LLM Gateway](./extensions/sf-llm-gateway/)     | provider   |
| `/sf-agentscript`   | [SF Agent Script](./extensions/sf-agentscript/)    | agent-tool |
| `/sf-apex`          | [SF Apex](./extensions/sf-apex/)                   | agent-tool |
| `/sf-browser`       | [SF Browser](./extensions/sf-browser/)             | agent-tool |
| `/sf-code-analyzer` | [SF Code Analyzer](./extensions/sf-code-analyzer/) | agent-tool |
| `/sf-data360`       | [SF Data 360](./extensions/sf-data360/)            | agent-tool |
| `/sf-docs`          | [SF Docs](./extensions/sf-docs/)                   | agent-tool |
| `/sf-herdr`         | [SF Herdr](./extensions/sf-herdr/)                 | agent-tool |
| `/sf-lwc`           | [SF LWC](./extensions/sf-lwc/)                     | agent-tool |
| `/sf-slack`         | [SF Slack](./extensions/sf-slack/)                 | agent-tool |
| `/sf-soql`          | [SF SOQL](./extensions/sf-soql/)                   | agent-tool |
| `/sf-tldraw`        | [SF tldraw](./extensions/sf-tldraw/)               | agent-tool |
| `/sf-guardrail`     | [SF Guardrail](./extensions/sf-guardrail/)         | safety     |
| `/sf-feedback`      | [SF Feedback](./extensions/sf-feedback/)           | assistive  |
| `/sf-lsp`           | [SF LSP](./extensions/sf-lsp/)                     | assistive  |
| `/sf-data-explorer` | [SF Data Explorer](./extensions/sf-data-explorer/) | ui         |
| `/sf-devbar`        | [SF DevBar](./extensions/sf-devbar/)               | ui         |
| `/sf-org`           | [SF DevBar](./extensions/sf-devbar/)               | ui         |
| `/sf-skills`        | [SF Skills](./extensions/sf-skills/)               | ui         |
| `/sf-welcome`       | [SF Welcome](./extensions/sf-welcome/)             | ui         |
| `/sf-setup-fonts`   | [SF Welcome](./extensions/sf-welcome/)             | ui         |

<!-- GENERATED:command-reference:end -->

</details>

## Managing Extensions

Open `/sf-pi` for the interactive manager. The essential commands are:

```text
/sf-pi doctor
/sf-pi status
/sf-pi enable <id> global
/sf-pi disable <id> global
```

Use `/sf-pi help` or the [command reference](./docs/commands.md) for advanced
settings, project scope, recommendations, and repair commands.

## Recommended Extensions

Beyond the extensions that ship inside this package, sf-pi maintains a
curated list of **recommended** open-source pi extensions. sf-pi does not
redistribute these packages — it points at their upstream sources, so
updates and credit flow through the original authors.

Install them all in one shot:

```text
/sf-pi recommended install bundle:default
```

Or inspect individual packages with `/sf-pi recommended`.

<details>
<summary><strong>Default bundle contents and checklist behavior</strong></summary>

### The default bundle

All eight packages are **MIT**-licensed and install per-user (global
scope) by default.

| Extension                                                               | Why install it                                                                                                                                                                                        |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **[`pi-skills`](https://github.com/badlogic/pi-skills)**                | Baseline skill library for pi. Unlocks search, Google Workspace, browser automation, YouTube transcripts, and more. Most other pi packages assume it's installed.                                     |
| **[`pi-web-access`](https://github.com/nicobailon/pi-web-access)**      | Web search, URL fetching, GitHub repo cloning, PDF extraction, YouTube + local video analysis. sf-pi itself expects the `web_search` and `fetch_content` tools this package provides.                 |
| **[`pi-aliases`](https://github.com/xRyul/pi-aliases)**                 | Muscle-memory helpers like `/clear → /new` and `/exit → /quit`. Tiny, low-risk quality-of-life win — especially if you're coming from Claude Code or Codex CLI.                                       |
| **[`pi-interview`](https://github.com/nicobailon/pi-interview-tool)**   | Gives pi a structured `interview` tool for multi-question requirement gathering and trade-off exploration. Pairs naturally with `sf-agentscript` and other sf-pi scaffolding workflows.               |
| **[`glimpseui`](https://github.com/hazat/glimpse)**                     | Cross-platform micro-UI for scripts and agents — native WebView windows for rich visual explainers, charts, and HTML previews without launching a full browser. Used by the `visual-explainer` skill. |
| **[`pi-tool-display`](https://github.com/MasuRii/pi-tool-display)**     | Compact tool-call rendering, diff visualization, and output truncation. Significant quality-of-life boost for Salesforce workflows that inspect large metadata or log files.                          |
| **[`pi-subagents`](https://github.com/nicobailon/pi-subagents)**        | Delegates work to single, chained, parallel, async, and forked-context subagents. Useful for advisory review, implementation handoffs, and larger planning flows.                                     |
| **[`pi-herdr`](https://github.com/ogulcancelik/pi-extensions)** / Herdr | Alpha workspace, tab, and pane orchestration for pi. Enables command-scoped Salesforce workflow lanes for tests, log tails, previews, evals, servers, and cleanup.                                    |

Full manifest with source URLs, license info, and per-item `rationale`
strings: [`catalog/recommendations.json`](./catalog/recommendations.json).

### How the checklist works

- **Open it:** `/sf-pi recommended`
- **One-liner install:** `/sf-pi recommended install <id>`
- **Whole bundle:** `/sf-pi recommended install bundle:default`
- **Decline + forget:** pick `Never` in the checklist or `/sf-pi recommended remove <id>`

First-run behavior:

- On every `session_start`, sf-pi checks whether the manifest's `revision`
  differs from what you've already acknowledged. If it does, a one-line
  nudge appears in the footer status (`✨ sf-pi: N new recommended …`).
- Nothing installs automatically. You stay in control — run
  `/sf-pi recommended` when you're ready, pick what you want with Space,
  press Enter to apply.
- Decisions are sticky: items you installed or declined are never
  re-prompted across sessions.
- Opt out entirely with `SF_PI_RECOMMENDATIONS=off` in your environment.

Proposing a new recommendation: see
[CONTRIBUTING.md](./CONTRIBUTING.md#proposing-a-recommended-extension).

</details>

## Using Skills from Claude Code, Codex, or Cursor

<details>
<summary><strong>Advanced: connect existing skill directories</strong></summary>

Pi natively loads skills from `~/.pi/agent/skills/` and `~/.agents/skills/`.
Skill libraries from other harnesses — Claude Code (`~/.claude/skills`),
OpenAI Codex (`~/.codex/skills`), and Cursor (`~/.cursor/skills`) — require
a one-line settings edit to load in pi:

```json
// ~/.pi/agent/settings.json
{
  "skills": ["~/.claude/skills", "~/.codex/skills"]
}
```

`/sf-pi skills` does this for you. Run it and sf-pi:

1. Scans those three directories on disk, counts the skills it sees in each,
   and cross-references the list with your current `settings.skills[]`.
2. Opens a checklist — Space toggles a root, Enter applies.
3. Writes the delta back to `~/.pi/agent/settings.json` and reloads so the
   newly wired skills load immediately.

The splash also shows a single-line nudge under **Recommended** whenever it
detects an external root on disk that isn't yet in your settings:

```
• Interop  2 external skill roots (41 skills detected)
  → /sf-pi skills
```

Skills work side-by-side across harnesses — wiring a Claude Code directory
here does not copy, move, or touch the files in any way. Pi reads them in
place and Claude Code continues to use them unchanged.

</details>

## Bundled Extensions

Browse extensions in the interactive `/sf-pi` manager or the generated
[extension catalog](./docs/extensions.md).

<!-- GENERATED:bundled-extensions:start -->

For the canonical machine-readable bundle list, see [`catalog/index.json`](./catalog/index.json).

**Default** column: `on` = enabled on install, `opt-in` = disabled on install (enable with `/sf-pi enable <id>`), `always-on` = cannot be disabled.

| Extension                                          | Category   | Default   | Description                                                                                                                                                                                                                                                                                                                            |
| -------------------------------------------------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [SF Pi Manager](./extensions/sf-pi-manager/)       | manager    | always-on | Core manager — provides /sf-pi commands (always active)                                                                                                                                                                                                                                                                                |
| [SF LLM Gateway](./extensions/sf-llm-gateway/)     | provider   | on        | Salesforce LLM Gateway provider with model discovery                                                                                                                                                                                                                                                                                   |
| [SF Agent Script](./extensions/sf-agentscript/)    | agent-tool | on        | Single-plugin lifecycle for `.agent` files: compile diagnostics, native quality, preview, local-first Eval Studio, exact-version release eval, inactive publication, and gated activation.                                                                                                                                             |
| [SF Apex](./extensions/sf-apex/)                   | agent-tool | on        | API-native Apex lifecycle workflows for pi: authoring guidance, diagnostics, trace/log/watch, Anonymous Apex, and targeted tests.                                                                                                                                                                                                      |
| [SF Browser](./extensions/sf-browser/)             | agent-tool | on        | Salesforce-aware browser automation for last-mile UI work using agent-browser.                                                                                                                                                                                                                                                         |
| [SF Code Analyzer](./extensions/sf-code-analyzer/) | agent-tool | on        | Salesforce Code Analyzer workflows for pi: setup readiness, explicit scans, rule discovery, config generation, report artifacts, deferred agent quality passes, and ApexGuru analysis.                                                                                                                                                 |
| [SF Data 360](./extensions/sf-data360/)            | agent-tool | on        | Data Cloud/Data 360 v2 family tools — discover, connect, prepare, harmonize, segment, activate, query, semantic, observe, orchestrate, and raw API escape hatch                                                                                                                                                                        |
| [SF Docs](./extensions/sf-docs/)                   | agent-tool | on        | Salesforce documentation lookup for agents and humans, with local credential storage, cited results, and a Manager settings surface.                                                                                                                                                                                                   |
| [SF Herdr](./extensions/sf-herdr/)                 | agent-tool | on        | Non-mutating Salesforce workflow plans for the current split Herdr tools.                                                                                                                                                                                                                                                              |
| [SF LWC](./extensions/sf-lwc/)                     | agent-tool | on        | Local-native Lightning Web Component lifecycle workflows for pi: project scan, component inspection, focused diagnostics, targeted Jest tests, and artifacts.                                                                                                                                                                          |
| [SF Slack](./extensions/sf-slack/)                 | agent-tool | on        | Slack integration — search messages, read threads, browse channel history                                                                                                                                                                                                                                                              |
| [SF SOQL](./extensions/sf-soql/)                   | agent-tool | on        | API-native SOQL lifecycle workflows for pi: schema search/describe, relationship discovery, query drafting, validation, query plans, bounded query/SOSL execution, exports, file diagnostics, and artifacts.                                                                                                                           |
| [SF tldraw](./extensions/sf-tldraw/)               | agent-tool | on        | Deterministic, editable Salesforce diagrams rendered through the local tldraw offline Canvas API.                                                                                                                                                                                                                                      |
| [SF Guardrail](./extensions/sf-guardrail/)         | safety     | on        | Salesforce-aware safety hooks — file protection policies, dangerous-command gating, org-aware confirmation, and native high-value mutation mediation                                                                                                                                                                                   |
| [SF Brain](./extensions/sf-brain/)                 | assistive  | on        | Salesforce operator kernel, extension-priority context, and advisory Instruction Surface diagnostics                                                                                                                                                                                                                                   |
| [SF Feedback](./extensions/sf-feedback/)           | assistive  | on        | Guided feedback and bug-report flow that collects sanitized SF Pi diagnostics and opens a GitHub issue                                                                                                                                                                                                                                 |
| [SF LSP](./extensions/sf-lsp/)                     | assistive  | on        | Real-time Salesforce LSP diagnostics on write/edit with a working indicator, transcript rows, and one-line startup readiness in SF Welcome                                                                                                                                                                                             |
| [SF Data Explorer](./extensions/sf-data-explorer/) | ui         | on        | Read-only interactive TUI explorer for SOQL, SOSL, and Data 360 SQL using sf-pi Salesforce transport plumbing.                                                                                                                                                                                                                         |
| [SF DevBar](./extensions/sf-devbar/)               | ui         | on        | Bespoke Salesforce developer status bar with org context, model info, git, and context window progress                                                                                                                                                                                                                                 |
| [SF Ohana Spinner](./extensions/sf-ohana-spinner/) | ui         | on        | Salesforce-themed rainbow spinner during LLM thinking                                                                                                                                                                                                                                                                                  |
| [SF Skills](./extensions/sf-skills/)               | ui         | on        | Manage skills through one Skill Funnel: catalog every source (Claude/Codex/Cursor/custom/managed) → gate sources → toggle skills per scope (global/project) → resolve name conflicts, all compiled to native settings.skills[]. Plus a passive live-context HUD, forcedotcom/afv-library install, per-skill usage counters, and prune. |
| [SF Welcome](./extensions/sf-welcome/)             | ui         | on        | Salesforce-branded splash screen with environment status, release freshness, and community info                                                                                                                                                                                                                                        |

<!-- GENERATED:bundled-extensions:end -->

## Access-controlled integrations

SF LLM Gateway, SF Docs, and SF Slack require organization-provided access and
credentials. Their onboarding instructions are maintained separately from this
public README.

If your organization does not provide these services, disable them globally:

```text
/sf-pi disable sf-llm-gateway global
/sf-pi disable sf-docs global
/sf-pi disable sf-slack global
```

For extension internals and command references, use the generated
[extension catalog](./docs/extensions.md).

## Troubleshooting

Start with `/sf-pi doctor`. Common repairs:

- **Package not found:** run `pi install git:github.com/salesforce/sf-pi`.
- **Updates are seven days behind:** run
  `npm config set min-release-age 0 --location=user` and verify with
  `npm config get min-release-age`.
- **Node or engine warning:** install Node.js `>=22.19`, then repeat the
  [Getting started](#getting-started) commands.
- **Startup or skill collision:** launch once with `SF_PI_SAFE_START=1 pi`, then
  run `/sf-pi doctor`.

See the [troubleshooting guide](./docs/troubleshooting.md) for more help.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md). Please also read our
[Code of Conduct](./CODE_OF_CONDUCT.md) and the
[Security Policy](./SECURITY.md) before contributing.

## Credits

- **[Mario Zechner (@mariozechner)](https://github.com/mariozechner)** —
  [pi coding agent](https://pi.dev) runtime that powers every extension
  in this repo.
- **[Armin Ronacher (@mitsuhiko)](https://github.com/mitsuhiko)** —
  Early inspiration from
  [agent-stuff](https://github.com/mitsuhiko/agent-stuff).
- **[Nico Bailon (@nicobailon)](https://github.com/nicobailon)** —
  [`pi-powerline-footer`](https://github.com/nicobailon/pi-powerline-footer)
  inspired the visual design of `sf-devbar` (separator glyphs, color
  palette, pastel rainbow thinking badge). See
  [`extensions/sf-devbar/CREDITS.md`](./extensions/sf-devbar/CREDITS.md)
  for details.
- **[pi community](https://pi.dev)** — recommended-extension authors
  (see [Recommended Extensions](#recommended-extensions)) whose packages
  sf-pi leans on day-to-day.

## License

Licensed under the [Apache License 2.0](./LICENSE.txt).
