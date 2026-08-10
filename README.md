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

Install [Node.js](https://nodejs.org/) 22.19 or newer, the latest supported
[pi coding agent](https://pi.dev), and Salesforce CLI. Then install SF Pi:

```bash
npm install --global @earendil-works/pi-coding-agent
pi install git:github.com/salesforce/sf-pi
pi
```

Inside Pi:

```text
/reload
/sf-pi doctor
/sf-skills defaults install global
```

See the [installation guide](./docs/install.md) for npm policy, updates,
project-local installation, platform notes, fonts, and troubleshooting. The
[quickstart](./docs/quickstart.md) covers the first useful commands.

SF Pi's supported Pi range is currently
`>=0.82.0 <1.0.0`.

## Privacy and telemetry

SF Pi collects no active runtime telemetry. It opts out of Pi's anonymous
install/update ping when the user has not already chosen a setting, while
preserving explicit user preferences. Repository automation may archive
aggregate GitHub metrics.

See the complete [privacy and telemetry policy](./docs/privacy.md).

## Announcements

The startup surface can show bundled release and maintainer notices. Nothing is
installed automatically. Use `/sf-pi announcements` to inspect or dismiss them;
use `/sf-pi` for all package-level settings and status.

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

## Recommended extensions

SF Pi can install a curated optional companion bundle:

```text
/sf-pi recommended install bundle:default
/sf-pi recommended status
```

All eight packages are installed only after explicit user action:

- `pi-skills`
- `pi-web-access`
- `pi-aliases`
- `pi-interview`
- `glimpseui`
- `pi-tool-display`
- `pi-subagents`
- `pi-herdr`

The machine-readable sources, licenses, and rationale live in
[`catalog/recommendations.json`](./catalog/recommendations.json).

## Skills

`sf-skills` manages Salesforce skill libraries and optional external skill roots
through Pi's native settings. Start with `/sf-skills`; see the
[SF Skills extension page](./docs/extensions/sf-skills.md) for details.

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
| [SF Docs](./extensions/sf-docs/)                   | agent-tool | on        | Salesforce documentation lookup for agents and humans, with Pi-owned auth-store credentials, cited results, and a Manager settings surface.                                                                                                                                                                                            |
| [SF Herdr](./extensions/sf-herdr/)                 | agent-tool | on        | Non-mutating Salesforce workflow plans for the current split Herdr tools.                                                                                                                                                                                                                                                              |
| [SF LWC](./extensions/sf-lwc/)                     | agent-tool | on        | Local-native Lightning Web Component lifecycle workflows for pi: project scan, component inspection, focused diagnostics, targeted Jest tests, and artifacts.                                                                                                                                                                          |
| [SF Slack](./extensions/sf-slack/)                 | agent-tool | on        | Slack integration — search messages, read threads, browse channel history                                                                                                                                                                                                                                                              |
| [SF SOQL](./extensions/sf-soql/)                   | agent-tool | on        | API-native SOQL lifecycle workflows for pi: schema search/describe, relationship discovery, query drafting, validation, query plans, bounded query/SOSL execution, exports, file diagnostics, and artifacts.                                                                                                                           |
| [SF tldraw](./extensions/sf-tldraw/)               | agent-tool | on        | Deterministic, editable Salesforce diagrams rendered through the local tldraw offline Canvas API.                                                                                                                                                                                                                                      |
| [SF Guardrail](./extensions/sf-guardrail/)         | safety     | on        | Salesforce-aware safety hooks — file protection policies, dangerous-command gating, org-aware confirmation, and native high-value mutation mediation                                                                                                                                                                                   |
| [SF Brain](./extensions/sf-brain/)                 | assistive  | on        | Salesforce Engineering Constitution, compact SF Pi routing summary, and advisory Instruction Surface diagnostics                                                                                                                                                                                                                       |
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
