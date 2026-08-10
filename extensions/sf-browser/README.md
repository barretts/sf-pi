# SF Browser

## What It Does

SF Browser is an experimental developer-assistive Bundled Extension for Salesforce UI last-mile work that Salesforce APIs cannot cover. It uses [`agent-browser`](https://www.npmjs.com/package/agent-browser) as a lazy CDP runtime and exposes a small, typed hot-path tool set for agents.

It is not a general browser framework, a Playwright replacement, or a stable Salesforce UI automation contract.

## SF Browser vs UI Testing Frameworks

Use SF Browser for agent-driven last-mile UI work: opening authenticated Salesforce pages, taking compact snapshots, performing small fallback interactions, and capturing Browser Evidence when APIs or owning SF Pi extensions cannot fully answer the question.

Use purpose-built UI testing frameworks for repeatable CI regression suites. Page-object and locator-based tools are better suited for durable test code, cross-release maintenance, role/browser matrices, and test reporting. SF Browser can help investigate or document a UI state, but it should not become the source of truth for automated regression tests.

## Key Architecture Decisions

- `agent-browser` is a lazy external runtime. SF Browser does not start Chrome, probe CDP, or check installation during startup. `/sf-browser doctor` and the deferred SF Welcome splash row may run `agent-browser --version`; neither launches a browser session.
- V1 exposes a Hot-Path Browser Tool Set: open, snapshot, click, fill, select, press, editor, wait, and Browser Evidence capture.
- Long-tail browser work remains direct `agent-browser` usage.
- Browser Evidence is session-scoped and artifact-first. Use `imageMode: "artifact"` for repeated captures and `thumbnail` when the model should inspect the current screen. Thumbnail mode defaults the screenshot viewport to 1440x1000 so model-visible evidence is not a cramped half-height capture. Use `includeSetupAuditTrail: true` on the after-capture when a UI Mutation Fallback should include recent Setup Audit Trail context.
- Targeted Browser Evidence can scroll an explicit ref into view before screenshot capture with `scrollToRef`.
- Snapshots are smart and pi-native: `outputMode: "summary"` reports page URL, surface, tabs, record actions, field edit actions, related lists, object-list controls, quick-action forms, alerts, tables, and an artifact pointer by default.
- Snapshots also publish compact ref metadata for SF Guardrail. Guardrail can classify committing click refs such as Save, Delete, Activate, Assign, Submit, or Deploy from the latest snapshot label even when the model omits `mutation=true`; non-committing draft actions such as fill/select/editor writes still stay prompt-free until a committing gesture occurs.
- Ambient Overlay Dismissal is best-effort and scoped to known non-workflow Salesforce overlays before evidence capture.
- Setup Destinations are curated shortcuts for known Setup paths; they are not a full Setup sitemap. The runtime registry owns each destination's path, intent, expected surface, suggested wait, focus terms, and runbook references so agents can navigate without brittle Setup search.
- Structured routes can resolve common Lightning paths before opening the browser: `home`, `setup`, `object-list`, `object-new`, `record-view`, `list-view`, and `record-related-list`. `sf_browser_resolve_path` remains deterministic/local; `sf_browser_open_org` verifies structured routes through the shared Salesforce Connection Module before opening, using one selected target/version and bounded REST/query calls. Bounded fuzzy matching is limited to curated Setup Destinations and verified list-view / related-list labels; ambiguous matches fail closed with candidates. `object-new` opens Salesforce's deterministic new-record URL; org overrides or record-type flows can render differently, so verify with waits and snapshots after opening.
- Failed browser actions include best-effort diagnostics: failure kind, recovery hint, current URL, compact snapshot artifact, and screenshot artifact when capture succeeds.
- Tool results include a user-visible duration so users can understand the cost and compare optimized workflows.
- V1 avoids permission gates and semantic browser-action mediation to reduce permission fatigue.
- See [`../../docs/adr/0011-sf-browser-agent-browser-lazy-hot-path-runtime.md`](../../docs/adr/0011-sf-browser-agent-browser-lazy-hot-path-runtime.md).

## Commands

| Command                          | Description                                                                                          |
| -------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `/sf-browser`                    | Open SF Browser in the SF Pi Manager.                                                                |
| `/sf-browser status`             | Show cache-first SF Browser status, including cached `agent-browser` runtime state, without probing. |
| `/sf-browser doctor`             | Check whether `agent-browser` is installed and refresh the runtime cache.                            |
| `/sf-browser open [path\|setup]` | Open the active target org home, a provided Salesforce path, or a Setup Destination.                 |
| `/sf-browser setup`              | Open Salesforce Setup home.                                                                          |
| `/sf-browser screenshot [label]` | Capture Browser Evidence with a private full screenshot and thumbnail image mode.                    |
| `/sf-browser evidence [limit]`   | List current-session Browser Evidence captures, artifact paths, and audit status.                    |
| `/sf-browser guidance`           | Print the Salesforce Browser Contract.                                                               |
| `/sf-browser help`               | Print command and tool usage.                                                                        |

## Agent Tools

| Tool                          | Purpose                                                                                                                                                                            |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sf_browser_open_org`         | Open a Salesforce org/path or curated Setup Destination in the shared `agent-browser` session without exposing login URLs.                                                         |
| `sf_browser_snapshot`         | Capture a smart pi-native snapshot: page URL, surface, actions, tables, alerts, and artifact pointer.                                                                              |
| `sf_browser_click`            | Click a ref from the latest snapshot.                                                                                                                                              |
| `sf_browser_fill`             | Fill a ref from the latest snapshot.                                                                                                                                               |
| `sf_browser_select`           | Select values in Salesforce select/listbox refs, including Classic Setup dual-list controls.                                                                                       |
| `sf_browser_press`            | Press keys such as `Enter`, `Escape`, or `Control+a`.                                                                                                                              |
| `sf_browser_editor`           | Detect, read, or replace visible Salesforce editor-like surfaces such as Monaco, textareas, and contenteditable fields; never clicks Save/Apply.                                   |
| `sf_browser_wait`             | Wait for expected text, URL, load state, Lightning semantic state such as `navigation-ready` / `app-ready`, or last-resort milliseconds; reports near-timeout waits as ambiguous.  |
| `sf_browser_capture_evidence` | Capture session-scoped screenshot evidence, optionally scroll to a ref, dismiss ambient overlays, enrich with recent Setup Audit Trail context, and return bounded image content.  |
| `sf_browser_resolve_path`     | Resolve structured Salesforce routes and bounded fuzzy Setup Destinations to deterministic paths without opening the browser; route verification happens in `sf_browser_open_org`. |

## Setup Runbooks

SF Browser includes documentation-first setup runbooks for API-first/browser-ready workflows:

```text
extensions/sf-browser/docs/setup-runbooks.md
extensions/sf-browser/docs/setup-destinations.md
extensions/sf-browser/docs/data-cloud-destinations.md
extensions/sf-browser/docs/live-smoke.md
```

## Destination Packs

A **Destination Pack** gives comprehensive navigation for one product area
without bloating the small curated Setup Destination list or scraping menus at
runtime. Each entry is typed by surface (`setup-node`, `app-tab`,
`builder-page`) and is `verified`, `candidate`, or `broken`; the runtime agent
navigates only to `verified` entries.

The first pack is **Data Cloud**, addressed by a structured route:

```json
{ "route": { "type": "data-cloud", "destination": "data-spaces" } }
```

## Navigation Hardening Harness

The dev-time **Navigation Hardening Harness** re-verifies navigation against a
live org, never by runtime scraping. It covers every navigation surface,
selected with `--surface` (default `all`):

| `--surface`          | What it checks                                                                                                                   |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `data-cloud`         | The Data Cloud Destination Pack (verify pack entries + discover app/setup nav)                                                   |
| `setup-destinations` | Every curated Setup Destination opens and renders                                                                                |
| `routes`             | Structured route templates: `home`, `object-list`, `object-new`, and sampled `record-view` / `list-view` / `record-related-list` |
| `all`                | All of the above                                                                                                                 |

```bash
npm run e2e:sf-browser-harden -- --org <alias>                              # all surfaces
npm run e2e:sf-browser-harden -- --org <alias> --surface setup-destinations # one surface
npm run e2e:sf-browser-harden -- --org <alias> --surface routes --object Contact
npm run e2e:sf-browser-harden -- --org <alias> --mutate                     # + reversible mutation lifecycle
```

For each entry the harness opens it against the org, applies the suggested
Lightning-Aware Wait, captures one Browser Evidence screenshot, asserts the
expected surface, and (for Data Cloud) crawls for candidate entries. It writes a
group-tagged contact-sheet `report.html` and prints confirmed/proposed paths to
review before promoting to `verified`. Routes that need live data sample the
org (`--object`, default `Account`) and skip cleanly when none exist.
Screenshots are not committed to git. See ADR 0030.

Runbooks document the preferred API or owning-extension path, the Browser Evidence path, and the UI Fallback Path for common setup/admin tasks. `live-smoke.md` documents a read-only checklist for validating route resolution, Lightning waits, snapshots, and session-scoped evidence against a connected sandbox/dev org.

## Salesforce Browser Contract

- Use Salesforce APIs first for setup and verification.
- Prefer curated Setup Destinations over search-and-click navigation when the target Setup path is known.
- Run `sf_browser_snapshot` before acting. It reports page URL, surface type, tabs, record actions, field edit actions, related lists, object-list controls, quick-action forms, tables/lists, alerts, and focus matches while storing the full raw tree as an artifact.
- Treat refs as stale after clicks, saves, modal opens, navigation, tab switches, and Lightning rerenders.
- For Salesforce lookup and combobox controls: fill the visible input, wait for options, snapshot, then click the desired option.
- For code-like editor surfaces where normal fill is insufficient, use `sf_browser_editor` with `action: "detect"`, then read or write by `editorIndex`. Editor writes replace visible editor content only; they never click Save or Apply and do not echo full content.
- Use `imageMode: "artifact"` for batches; use `thumbnail` for model-visible current-screen inspection. Use `scrollToRef` when evidence needs to prove a lower-page section.
- Leave `dismissOverlays` enabled for evidence capture unless the overlay is part of the task being documented.
- Use `sf_browser_select` for Classic Setup listbox and dual-list controls, then click Add or Remove and snapshot before saving.
- After opening a deep link or Setup Destination, prefer `sf_browser_wait` with `lightning: "navigation-ready"`, then snapshot. If `sf_browser_wait` reports an ambiguous wait, snapshot or verify through API before continuing.
- Use direct `agent-browser` commands for scroll, hover, drag, upload, tabs, console, network, trace, video, HAR, eval, advanced CDP, or long-tail editor/shadow-DOM work outside `sf_browser_editor`.

## Settings

SF Browser has a Manager Settings page for Browser Evidence defaults stored under `sfPi.browser`:

- **Evidence image mode** (`evidenceImageMode`) — `artifact`, `thumbnail` (default), or `full` when a command/tool omits `imageMode`.
- **Dismiss overlays** (`dismissOverlays`) — defaults to `true` for known ambient Salesforce overlays.
- **Setup Audit Trail** (`includeSetupAuditTrail`) — defaults to `false`; enable when after-capture evidence should include recent Setup Audit Trail context.

Explicit tool arguments still win for a single capture.

## State and Artifacts

Browser Evidence is stored outside the project by default and scoped by pi session:

```text
<globalAgentDir>/sf-pi/browser-artifacts/sessions/<session-id>/
  index.json
  000001-label.png
  000001-label.thumb.jpg
<globalAgentDir>/sf-pi/sf-browser/agent-browser-status.json
```

The session index keeps capture metadata and monotonically increasing evidence IDs for that session. The legacy `browser-artifacts/latest/pointer.json` location points to the current session evidence directory for quick access; screenshots are not duplicated there. `agent-browser-status.json` is a cache-first install/freshness snapshot written by `/sf-browser doctor` and deferred version probes; it is not proof of a browser launch. Use `/sf-browser evidence [limit]` to list recent captures, artifact paths, and Setup Audit Trail enrichment status for the current session. V1 does not automatically clean old artifacts.

## Installing agent-browser

SF Browser does not auto-install dependencies. Install `agent-browser` explicitly:

```bash
npm i -g agent-browser
agent-browser install
```

If you installed `agent-browser` with Homebrew, update with Homebrew instead:

```bash
brew upgrade agent-browser
```

Then run:

```text
/sf-browser doctor
```

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-browser/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

**`agent-browser` is missing:**
Run `npm i -g agent-browser && agent-browser install`, then `/sf-browser doctor`.

**Chrome/Chromium cannot launch in a container or CI runner:**
If SF Browser reports `DevToolsActivePort`, `Failed to launch the browser process`, `requires the chromium snap`, `No usable sandbox`, or `cannot open display`, point `agent-browser` at a working Chrome/Chromium executable and use container-safe launch flags:

```bash
export AGENT_BROWSER_EXECUTABLE_PATH=/path/to/chrome
export AGENT_BROWSER_ARGS=--no-sandbox,--disable-dev-shm-usage
```

You can also run `agent-browser install`, then `/sf-browser doctor` to verify `agent-browser` itself is installed.

**Snapshot refs fail:**
Refs are stale after Salesforce page changes. Run `sf_browser_snapshot` again and retry with fresh refs. If a click/fill/select/press action fails, SF Browser includes a recovery hint plus best-effort diagnostic snapshot and screenshot artifacts. If the compact summary omits the control you need, retry with `focus` terms or `outputMode: "full"`.

**Screenshots are too heavy:**
Use `sf_browser_capture_evidence` with `imageMode: "artifact"` for repeated captures. Use `thumbnail` when the model should inspect the page; thumbnail captures use a fuller default viewport and can be overridden with `viewportWidth` / `viewportHeight`. Use `/sf-browser evidence` to inspect artifact paths without adding image bytes to the transcript.

**A browser action is outside the hot path:**
Use direct `agent-browser` commands and keep SF Browser for opening, snapshots, simple actions, waits, and evidence.
