# SF Pi — Pi-Native Reuse and Standardization Audit

Status: **proposal for review; no implementation authorized**  
Audit date: **2026-07-24**  
SF Pi baseline: **0.238.0**  
Audited Pi runtime: **@earendil-works/pi-coding-agent 0.81.1**

## Executive summary

SF Pi is not starting from an unoptimized baseline. The completed Pi 0.81 adoption program already moved several important runtime responsibilities to Pi:

- complete Provider registration and provider-owned authentication;
- Pi-owned credential persistence and logout;
- `appendEntry()` plus entry renderers for human-only transcript rows;
- `agent_settled` for deferred quality/update work;
- active-branch and compaction-aware session projection;
- Pi-owned active-tool exclusions, project trust, model selection, and thinking selection;
- Pi package-manager-backed package-root lookup;
- public Pi footer/context facts rather than private session parsing in several newer paths.

The next cleanup wave is therefore not “replace everything custom.” Most Salesforce, Data 360, Agent Script, browser, LSP, Slack, and Guardrail behavior is correctly custom. The strongest remaining opportunities fall into four groups:

1. **Missed direct Pi reuse** — notably a custom auth-store parser that misreads Pi's canonical API-key credential.
2. **Repeated SF Pi mechanics** — typed settings sections, config panels, Salesforce request policy, artifacts, result cards, and panel-aware output.
3. **Product surfaces that duplicate Pi-owned facts** — primarily SF Welcome and SF DevBar, plus part of SF Pi Manager.
4. **Standards that exist in prose but are weakly or inconsistently enforced** — scaffold output, panel checks, manifest/runtime attestation, catalog fail-closed behavior, and source-string tests.

### Baseline facts

- **21** bundled extensions.
- **41** LLM tools.
- **21** slash commands declared across the bundle.
- **120,815** extension source lines reported by the generated catalog.
- Approximately **230,000** TypeScript/JavaScript lines across extensions, shared code, scripts, and tests.
- Validation baseline: **477 test files passed, 5 skipped; 3,562 tests passed, 8 skipped**.
- Current working tree was clean before this report was added.

### Architecture vocabulary

This report uses the repository architecture skill's terms consistently:

- **Module** — an Interface plus its Implementation.
- **Interface** — everything callers must know: types, invariants, ordering, errors, configuration, and performance expectations.
- **Implementation** — behavior hidden inside a Module.
- **Depth** — Leverage behind a small Interface.
- **Seam** — where an Interface can be replaced or tested.
- **Adapter** — a concrete translation at a Seam.
- **Leverage** — capability gained by callers from one implementation.
- **Locality** — change, bugs, and knowledge concentrated in the owning Module.

The **deletion test** asks whether removing a Module makes complexity disappear or merely pushes it into every caller.

### Counting method

- `catalog/index.json > srcLoc` is used only for the package-wide extension baseline.
- Detailed production figures use `wc -l` over non-test TypeScript files. They are snapshots of the current checkout, rounded where stated.
- Duplicate-family figures come from repository-wide import, basename, and normalized-line scans, followed by direct source inspection.
- Deletion ranges are deliberately conservative and non-additive.

### Conservative reduction bands

These are planning ranges, not promised diffs, and overlap must not be added mechanically.

| Band                          | Scope                                                                  | Plausible net deletion |
| ----------------------------- | ---------------------------------------------------------------------- | ---------------------: |
| Immediate, low-risk           | Native auth status, shallow seams, small shared mechanics              |            300–700 LOC |
| Shared-module standardization | Settings/panels, transport, artifacts, result/output shells            |          900–1,800 LOC |
| Product simplification        | Welcome, DevBar, Manager                                               |        2,000–5,000 LOC |
| Strategic challenge           | Replace advisory SF Herdr planner with a Pi skill, if product-approved |        1,200–1,600 LOC |

The largest gains require product decisions because they remove duplicated presentation, not merely implementation boilerplate.

---

## What changed in Pi during the audited window

The release review covered roughly 2026-04-24 through 2026-07-24. The table lists only changes relevant to SF Pi architecture.

| Pi release                           | Relevant capability                                                     | SF Pi status                                                             |
| ------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 0.70.3 · 2026-04-27                  | Public working-row visibility and indicator controls                    | Adopted by SF Ohana Spinner; keep thin                                   |
| 0.77.0 · 2026-05-28                  | Authoritative `--exclude-tools`                                         | Adopted; SF Pi must never re-enable exclusions                           |
| 0.78.x · 2026-05-29 to 06-04         | Named sessions, `ctx.mode`, richer extension context                    | Adopted in newer command/UI paths                                        |
| 0.79.0 · 2026-06-08                  | Project trust and public package asset helpers                          | Trust adopted; package/resource reuse remains partial                    |
| 0.79.1 · 2026-06-09                  | `ctx.isProjectTrusted()`, autocomplete providers                        | Adopted selectively                                                      |
| 0.79.5–0.79.10 · 2026-06-16 to 06-22 | Provider-scoped auth env, global proxy, exact update flow, reload fixes | Mostly adopted; Welcome still duplicates Pi freshness checks             |
| 0.80.3 · 2026-06-30                  | Session-name events and richer RPC tree access                          | Adopted by DevBar; Welcome still scans JSONL manually                    |
| 0.80.4 · 2026-07-09                  | `agent_settled`, entry renderers, project-local resource config         | Correctly adopted by Code Analyzer, Manager, Feedback, and Gateway paths |
| 0.80.7 · 2026-07-14                  | Cache-friendly additive dynamic tool activation                         | Deliberately not adopted; current ADR stopped the pilot                  |
| 0.80.8 · 2026-07-16                  | `ModelRuntime`, provider-owned auth, live catalogs                      | Adopted in the Gateway migration                                         |
| 0.81.0 · 2026-07-21                  | Complete Provider extensions and expanded usage accounting              | Adopted by Gateway; DevBar still duplicates several native footer facts  |
| 0.81.1 · 2026-07-21                  | Resilient compaction/summary retries and lifecycle events               | Available; no major missing SF Pi migration found                        |

### Important negative finding

Pi 0.81.1 still does **not** ship a native Salesforce browser, MCP client, permission system, Salesforce LSP, or built-in subagent framework. Pi explicitly positions these as extension/package concerns. Do not delete SF Browser, SF Guardrail, SF LSP, the Docs transport, or external orchestration integrations on the assumption that Pi core replaces them.

---

# Top 10 opportunities

The numbering expresses review value, not delivery dependency. The wave plan near the end is the authoritative execution order.

## 1. Replace the custom Pi auth-store parser with `readStoredCredential`

**Priority:** P0  
**Confidence:** Very high  
**Risk:** Low  
**Type:** Direct Pi reuse and correctness fix  
**Delivery gate:** Complete — implemented in the Pi 0.83 audit workstream

### Files

- `lib/common/pi-auth-status.ts`
- `lib/common/tests/pi-auth-status.test.ts`
- consumers in `extensions/sf-docs/lib/auth.ts` and `extensions/sf-slack/lib/auth.ts`

### Problem

`readPiAuthProviderStatus()` manually parses `auth.json` and considers only `access` or `token` fields. Pi 0.81's canonical API-key credential is:

```text
{ type: "api_key", key: "..." }
```

A local proof against the installed public Pi interface showed:

```text
sf-docs  native credential type=api_key  custom configured=false
sf-slack native credential type=oauth    custom configured=true
```

The custom status Adapter therefore reports a saved API-key credential as missing. It also contradicts ADR 0078's statement that SF Pi does not access private auth storage directly.

### Solution

Implemented: status-only reads use Pi's exported `readStoredCredential(providerId, authPath?)`. SF Pi derives only credential presence and source; credential values never leave Pi's reader.

### Deletion test

After callers move to Pi's reader, the manual filesystem parser and its credential-shape assumptions disappear rather than moving elsewhere.

### Benefits

- Correct API-key and OAuth status.
- Pi remains the credential-format authority.
- Less security-sensitive parsing in SF Pi.
- Better Locality: auth format changes stay inside Pi.

### Verification

- Canonical `api_key` and `oauth` fixtures.
- Missing and malformed store behavior.
- Assert no token/key value leaves the Adapter.
- Exact Pi 0.81.1 login/status/logout test for Docs and Slack.

### Estimated reduction

30–60 LOC, plus removal of an entire bug class.

---

## 2. Build one descriptor-driven settings Module and render simple panels with Pi `SettingsList`

**Priority:** P0  
**Confidence:** High  
**Risk:** Medium  
**Type:** Pi TUI reuse plus shared-core standardization  
**Delivery gate:** Proof-gated two-extension pilot

### Evidence

- Eighteen settings/preferences modules total roughly **2,520 LOC**.
- The simple repeated subset is about **867 LOC**.
- Eighteen `config-panel.ts` files total **4,222 LOC**.
- Seven simple panels total about **740 LOC** and repeat the same cursor, arrows, dirty-state, source-label, save, and Esc/q behavior.

Representative duplicates:

- `extensions/sf-agentscript/lib/settings.ts`
- `extensions/sf-browser/lib/settings.ts`
- `extensions/sf-feedback/lib/settings.ts`
- `extensions/sf-skills/lib/settings.ts`
- corresponding `lib/config-panel.ts` files

### Problem

Each extension reimplements two shallow Interfaces:

1. read/write one `sfPi.<section>` slice with project/global/default precedence;
2. render enum/boolean settings with nearly identical custom `Focusable` classes.

Pi already provides `SettingsList`, keyboard-aware TUI primitives, theme handling, and project/global settings concepts. Pi does not expose arbitrary `sfPi.*` namespace setters, so a small SF Pi storage Adapter remains necessary—but eighteen copies do not.

### Solution

Create one deep shared settings Module that owns:

- safe nested-slice read/write mechanics;
- scope/path/source reporting;
- unrelated-key preservation;
- atomic/race-aware persistence;
- canonical per-field project → global → default precedence.

Render only simple enum/boolean/bounded-number settings through Pi's `SettingsList`. The first pilot is SF Browser plus SF Agent Script. Project rows expose **Inherit global** and global rows expose **Use default**; these delete the scoped field instead of materializing inherited siblings. Keep complex panels—Guardrail, Gateway, DevBar color editing—local.

### Deletion test

Deleting each extension's storage/panel scaffold should not cause the same mechanics to reappear in callers. Extension-local code should be reduced to defaults, validation, labels, descriptions, and side-effect policy. Existing whole-section adapters are deleted after migration to field-level inheritance.

### Benefits

- One settings interaction model.
- Fewer inconsistent save/reload behaviors.
- Better test leverage: precedence and persistence tested once.
- Eliminates current non-atomic whole-file write duplication.

### Verification

- Per-field project → global → default behavior.
- Migration fixtures for extensions that currently replace whole sections, including byte-for-byte proof that reads do not rewrite settings files.
- Malformed JSON and unrelated-key preservation.
- Concurrent/race-aware writes.
- Dirty/save/reset/reload-required behavior in narrow and wide TUI.
- Per-field **Inherit global** / **Use default** deletion and empty-section pruning.

### Estimated reduction

550–900 LOC after migrating the simple subset.

---

## 3. Reduce SF Welcome to a Salesforce-only, cache-first renderer

**Priority:** P1  
**Confidence:** High  
**Risk:** Medium-high  
**Type:** Direct Pi reuse and ownership correction  
**Delivery gate:** Product-gated after the direct Pi-overlap slice

### Current surface

`extensions/sf-welcome` contains about **7,029 production TypeScript LOC**. It currently owns:

- a second Pi latest-version fetch and npm release-age policy: `lib/release-status.ts`;
- manual Pi session JSONL scanning and cost estimation: `lib/session-data.ts`;
- manual extension/skill/template counting: `lib/splash-data.ts`;
- several Welcome-local status probes and freshness caches;
- a long chain of delayed startup timers in `index.ts`.

The SF CLI, SF Skills, font, Hunk, Homebrew, and browser-runtime probes are advertised Welcome behavior today. They do **not** all have an owner-published replacement yet. Pi also has no native recent-sessions row in its startup header, and `quietStartup` can suppress Pi's loaded-resource header.

### Problem

Welcome has become a second runtime/status orchestrator. The direct Pi overlap is narrower but clear:

- Pi owns its update check and package updates.
- `SessionManager.list/listAll` owns session metadata.
- Pi owns session usage totals; the Welcome monthly session-cost fallback is not needed by the current Gateway-backed splash path.
- Pi owns resource discovery and provenance, although preserving Welcome's visible counts requires either public runtime facts or an explicit product decision.

The remaining Welcome-local probes are an ownership problem, not an already-complete Pi replacement. The splash has low Locality because it knows how each subsystem detects and refreshes itself.

### Solution

Split the work into two independently reviewable slices:

1. **Direct Pi-overlap slice** — remove the duplicate Pi release network check, remove session cost parsing, replace raw JSONL session discovery with `SessionManager` if the visible recent-session feature stays, and stop hand-walking resources when an authoritative Pi fact is available.
2. **Product/ownership slice** — for each remaining status row, either move refresh ownership to the relevant extension/shared Doctor store or explicitly remove the row. Do not delete a Welcome-local probe and leave a permanently stale cache.

Keep the Salesforce-branded splash, announcements, privacy posture, and a compact “recommended next action” area.

### Deletion test

The first slice is complete only when no Welcome code calls Pi's latest-version endpoint, parses session JSONL for usage/session metadata, or hand-walks resource roots for a fact Pi exposes. The second slice deletes a probe only after an owning Module publishes equivalent cached status or the product explicitly removes that visible feature.

### Benefits

- Faster, calmer startup.
- Fewer timers, caches, and stale-session guards.
- One owner per readiness fact.
- Pi release/session/resource behavior changes no longer require SF Pi repairs.

### Verification

- First paint performs no network or subprocess work.
- Startup-only, reload, resume, and fork behavior.
- Cached status rendering and refresh deep-links.
- No session-history privacy leak.
- Narrow/wide TUI and reduced-motion behavior.

### Estimated reduction

700–1,800 LOC, depending on explicit decisions for the Welcome-only rows.

---

## 4. Reopen SF DevBar's scope: keep Salesforce facts, restore Pi's default footer and theme

**Priority:** P1, product decision required  
**Confidence:** Medium-high  
**Risk:** Medium-high  
**Type:** Direct Pi UI reuse  
**Delivery gate:** Product-gated; reopens ADR 0057

### Current surface

`extensions/sf-devbar` contains about **2,853 production TypeScript LOC**. Its top bar duplicates Pi-owned model/provider, thinking, folder, branch, context, and session-name facts. It also has genuinely distinct behavior:

- git added/modified/deleted counts;
- a non-default image-width pill;
- an explicit working pulse;
- Salesforce org/production, LSP, Gateway, Slack, and extension signals.

Pi's default footer owns model, branch, token/cache usage, cost, context usage, session name, provider, and thinking. Pi's working loader is a separate UI surface; its footer does not replace DevBar's working pulse, git change counts, or image-width pill.

### Solution

Run a feature-by-feature product review before replacing the surface:

- restore Pi's default footer for the facts it already owns;
- expose compact Salesforce-specific facts through `ctx.ui.setStatus()`;
- use a small widget for LSP or production-org warnings when needed;
- use Pi theme tokens instead of custom true-color settings;
- explicitly relocate or remove git change counts, the image-width pill, and the working pulse;
- keep the terminal title only if users value it.

Only after those decisions should SF Pi delete duplicated model/thinking/folder/branch/context/session rendering, custom context progress math, most color settings, and the full custom footer.

### ADR impact

This reopens ADR 0057 and the Pi 0.81 adoption plan's “do not replace DevBar” non-goal. The friction is now real enough to revisit: Pi's footer expanded substantially, while DevBar still carries a large duplicate presentation Implementation.

### Deletion test

Delete the custom footer renderer, duplicate runtime-fact math, and color settings only when a native-footer-plus-SF-status prototype passes the signed-off feature inventory. No parallel footer path or hidden duplicate fact remains.

### Benefits

- Large code deletion while preserving the approved Salesforce context.
- Automatic adoption of future Pi footer improvements.
- No competing token/cache/context representation.
- Better terminal/theme accessibility.

### Verification

- Side-by-side feature inventory before deletion.
- Narrow/wide terminal QA.
- Production org warning remains prominent.
- LSP, Gateway usage, Slack, and org state remain visible.
- Reload/session replacement restores Pi-owned UI cleanly.

### Estimated reduction

700–1,400 LOC, depending on the unique features retained.

---

## 5. Make SF Pi Manager a thin catalog/configuration layer over Pi package and TUI primitives

**Priority:** P1  
**Confidence:** Medium  
**Risk:** Medium-high  
**Type:** Pi package/resource and TUI reuse  
**Delivery gate:** Resolver-parity proof plus product review for UI changes

### Current surface

`extensions/sf-pi-manager` contains about **5,105 production TypeScript LOC**. `lib/overlay.ts` alone is about **1,053 LOC** and hand-builds:

- list selection;
- cursor movement;
- scrolling and scrollbars;
- detail routing;
- settings routing;
- scope switching;
- enable/disable presentation.

Shared package-state Modules add roughly **667 LOC** of source matching, filter interpretation, settings I/O, and root resolution.

### Pi capabilities to reuse

- `DefaultPackageManager` and `SettingsManager`;
- package `extensions` filters and project deltas;
- `pi config` semantics;
- `SelectList` and `SettingsList`;
- package provenance in `sourceInfo` for commands/tools;
- `ctx.reload()` and project trust.

### Solution

Retain Manager's valuable catalog, recommendations, extension details, and extension-owned config panels, but delegate more mechanics:

1. prove Pi's package resolver and SF Pi's enabled-state model agree;
2. use Pi's package objects/setters for filter mutation where public Interfaces permit it;
3. replace hand-built list/scroll behavior with Pi TUI lists;
4. keep a thin SF Pi Adapter for mapping catalog IDs to package resource paths;
5. avoid duplicating `pi config`; deep-link to it for generic package/resource work.

### Constraints

Pi does not know SF Pi manifests, recommendations, or extension-specific settings. Manager remains a real product Module; this is not a deletion proposal for the whole extension.

### Deletion test

Remove custom cursor/scroll/list code only after the Pi TUI replacement passes the current navigation contract. Remove package-filter parsing or mutation only after a real `DefaultPackageManager`/`SettingsManager` parity harness agrees for every supported source and scope. The old resolver must be deleted—not retained as a fallback.

### Verification

- Global/project filter parity, including local/npm/git package sources.
- Trusted/untrusted project behavior.
- Enable/disable + reload.
- Missing package and linked-development installs.
- Exact UI behavior for detail/settings/back/scope.

### Estimated reduction

400–900 LOC after a parity-proven first wave.

---

## 6. Make the standards executable: fix scaffold, panel checks, tool/event attestation, and catalog failure behavior

**Priority:** P0 foundation  
**Confidence:** Very high  
**Risk:** Low-medium  
**Type:** Standardization  
**Delivery gate:** Immediate, as independent enforcement slices

### Evidence

- `npm run check:panels` reports **19 ok, 0 violations, 18 exempt**.
- The dominant Manager deep-link pattern is exempt and simultaneously counted as passing.
- `scripts/scaffold.mjs` generates the older local-panel pattern, omits safe command wrapping and close-before-reload wiring, and uses a stale sample tool filename.
- `scripts/docs-health.mjs` checks that a tool name literal appears somewhere, not that each manifest tool is actually registered by the expected Module.
- delegated event registration has one hard-coded attestation exception.
- `scripts/generate-catalog.mjs` can warn and skip malformed extension directories instead of failing the build.
- package load paths and catalog entries are currently equal, but equality is not enforced.

### Solution

Deliver four independent milestones rather than one standards framework:

1. **Manager-first command contract** — every bundled interactive no-args `/sf-*` command opens its Manager detail page; explicit subcommands remain direct; specialized UI requires an explicit action. Migrate Apex/LWC/SOQL and make the checker blocking in the same release; no grandfathered variant or warning period remains.
2. **Scaffold parity** — generate the Manager-first contract with safe handler and reload behavior.
3. **Runtime attestation** — execute factories against a capturing Pi fake for tool/event registration instead of searching for literals.
4. **Catalog integrity** — fail closed for malformed extension directories and enforce set equality among directories, manifests, catalog, registry, and `package.json.pi.extensions`.

Command grammar can follow separately: require every simple command to use one action catalog for parser, completion, help, Manager actions, and docs—or explicitly classify complex grammars.

### Deletion test

Each milestone must delete the rule it supersedes: no-args local-panel exemptions disappear as commands migrate to Manager, stale scaffold templates disappear, lexical registration checks disappear after runtime attestation, and warn-and-continue catalog branches disappear after fail-closed validation. A renamed exemption or parallel checker does not count.

### Benefits

- New code starts standardized.
- “Green” checks regain meaning.
- Refactors can deepen Modules without breaking lexical regex assumptions.
- Prevents loaded-but-undocumented or documented-but-unloaded extensions.

### Verification

Fixture-based false-positive and false-negative tests, plus an isolated scaffold run that passes catalog, panel, typecheck, and smoke checks.

### Estimated reduction

Potentially net-neutral initially; high future Leverage and lower slop growth.

---

## 7. Deepen `lib/common/sf-conn` so Apex and SOQL stop owning generic request policy

**Priority:** P0  
**Confidence:** High  
**Risk:** Medium  
**Type:** Shared-core consolidation  
**Delivery gate:** Behavior-parity proof

### Files

- `extensions/sf-apex/lib/api.ts`
- `extensions/sf-soql/lib/api.ts`
- `lib/common/sf-conn/connection.ts`
- `lib/common/sf-conn/request.ts`
- `lib/common/sf-rest/*`

### Problem

Apex and SOQL still independently implement:

- connection timeout choices;
- API-version normalization with a hard-coded fallback;
- request-body-or-throw policy;
- error formatting;
- pagination.

Both already delegate identity lookup to `resolveOrgIdentity`, and both call shared `connRequest`. Shared `connRequest` already performs one 401/403 refresh/retry. Apex adds a second outer refresh/retry in its JSON and text wrappers; SOQL correctly relies on the shared behavior. The direct deletion opportunity is Apex's redundant retry, not another refresh layer.

### Solution

Deepen the existing shared Module rather than introduce another abstraction:

1. keep `connRequest()` as the response-as-data base Interface;
2. prove and delete Apex's duplicate outer auth retry;
3. add shared strict JSON/text Adapters that call the base and throw bounded, sanitized errors without another refresh;
4. move connection API-version normalization behind the existing Seam and fail actionably when the Connection provides no version—never guess a hard-coded version or read a second SF Pi fallback setting;
5. share page iteration only where bounds and completion semantics match.

Keep Tooling CRUD, query/queryAll limits, Apex lifecycle operations, and SOQL semantics local.

### Deletion test

The Apex outer retry and extension-local version/error mechanics disappear after shared parity tests pass. No second refresh helper or compatibility fallback remains in either extension.

### Verification

- Exactly one 401/403 refresh/retry.
- No retry for unrelated 4xx.
- Abort and timeout behavior.
- REST, Tooling, query, and queryAll paging.
- API version with/without `v` prefix.

### Estimated reduction

45–100 LOC now, with significant drift prevention for future tools.

---

## 8. Standardize lifecycle artifacts, result cards, and panel-aware output

**Priority:** P1  
**Confidence:** High  
**Risk:** Medium  
**Type:** Shared-core and UX standardization  
**Delivery gate:** Proof-gated, one independently deletable milestone at a time

### Evidence

- Apex, SOQL, and LWC artifact writers: **142 LOC** of nearly identical mechanics.
- Apex/LWC/SOQL result constructors and digest renderers: approximately **329 LOC**.
- Six exact and eight near-identical command-output branches choose info panel vs notification vs stdout.
- Slack, Data 360, and Browser each have separate “truncate, spill to file, report path” Implementations.
- `lib/common/display/result-card.ts` is **555 LOC** but currently has production callers only inside Code Analyzer.

### Solution

Treat these as independent, sequential milestones—not one lifecycle framework:

1. **Artifact writer** — namespace, safe leaf, timestamp, text/JSON serialization, bundle write.
2. **Panel-aware output** — one Adapter for info panel vs notification vs headless output.
3. **Result envelope primitives** — shared status/fact/rail/artifact types only after a second real caller appears.
4. **Card adapters** — migrate Apex, SOQL, and LWC one at a time; do not make this a prerequisite for milestones 1–2.
5. **Common-card Locality decision** — either gain a second production caller for `lib/common/display/result-card.ts` or move it back into Code Analyzer.

Keep Data 360's stage/request/response/lineage card semantics separate unless a later Adapter proves useful.

### Deletion test

Each migrated extension deletes its old writer or output branch in the same slice. No dual artifact path remains. Card generalization proceeds only when a second production caller uses the shared Interface without callback-heavy special cases; otherwise Locality wins and the current common card moves back to Code Analyzer.

### Benefits

- One artifact safety policy.
- Consistent collapsed/expanded output.
- Easier addition of output modes.
- Removes repeated UI routing branches.

### Verification

- Exact existing artifact paths and filenames.
- Traversal-safe names and atomicity decision.
- Snapshot parity for user-visible cards.
- TUI/RPC/print/JSON output behavior.
- Full evidence remains available when model-facing content is compact.

### Estimated reduction

300–600 LOC.

---

## 9. Replace source-string “tests” with exact Pi runtime behavior tests and central policy lints

**Priority:** P1  
**Confidence:** High  
**Risk:** Medium  
**Type:** Test standardization and slop removal  
**Delivery gate:** Incremental; each removed assertion needs a named replacement

### Evidence

A conservative scan found **23 source-inspection test files**, about **3,048 LOC**, with roughly **386** `toContain`/`toMatch` assertions. Examples read `index.ts` or another production source file and assert that a symbol or phrase exists.

ADR 0086 already says source-string assertions may enforce static policy but do not satisfy behavior proof.

### Problem

These tests are tightly coupled to Implementation layout and often keep shallow wrappers alive. They can pass when registration is unreachable, attached to the wrong event, or behavior is broken.

### Solution

- Move static forbidden-pattern rules into a few centralized lints.
- Use `InlineExtension`, `SessionManager`, `SettingsManager.inMemory()`, captured extension factories, and exact Pi event shapes for behavior.
- Test command routing in TUI/RPC/print modes.
- Test registered tools/events by executing the factory, not scanning strings.
- Keep source assertions only for true policy such as “no private auth import” or “no dangerous API.”

### Benefits

- Refactoring freedom.
- Better confidence for deletion.
- Fewer duplicated fake Pi contexts.
- Tests verify the Interface, which is the correct test surface for a deep Module.

### Deletion test

Every removed source assertion maps to either a named runtime behavior test or a named centralized static policy rule. Delete the old assertion and any orphan fake context in the same change; do not keep both indefinitely.

### Verification

Migrate incrementally and require no loss in behavior coverage. Keep the current full-suite baseline green.

### Estimated reduction

500–1,500 test LOC after replacing low-value checks with shared runtime fixtures.

---

## 10. Establish a real compatibility-debt sunset and delete only proven one-shot or pass-through code

**Priority:** P1, release-policy gated  
**Confidence:** High for shallow seams; medium for one-shot migrations  
**Risk:** Low to medium  
**Delivery gate:** Release-policy-gated per migration; immediate for proven internal barrels

### Candidates

- The remaining one-shot Gateway provider-id migration and its focused tests in
  `migrate-unify-provider.ts`; the named-model default migration was removed
  when ADR 0077 made the gateway catalog fully dynamic.
- Apex/SOQL one-caller `operations.ts` barrels.
- Data 360 `path.ts` and `target-org.ts` compatibility re-exports, if they are not a supported external Interface.
- hard-coded `.pi` paths that should use Pi's exported `CONFIG_DIR_NAME`.
- duplicate semver-ish parsers and runtime-floor constants.

Two nearby Modules are **not** one-shot deletion candidates under current ADRs:

- `legacy-token-migration.ts` implements retained, value-free legacy-field detection and explicitly confirmed cleanup required by ADRs 0078 and 0054;
- `model-resolution.ts` is an active Adapter that already delegates generic lookup to Pi while preserving Gateway dynamic-catalog fallback.

They can change only through a superseding behavior decision, not because the v0.235–v0.236 execution-fallback window ended.

### Problem

One-shot migrations are intentionally easy to add but have no consistent retirement rule. Shallow barrels add navigation cost with no Depth. Without a published upgrade horizon, however, deleting a migration can break users who skip releases.

### Solution

Adopt an explicit migration-support policy:

- minimum supported upgrade source or retention duration;
- introduction release, last required release, and removal release for each migration;
- a documented manual recovery path for older upgrades.

Then independently:

- retire only migrations outside that horizon;
- redirect internal imports and remove pass-through barrels;
- use `CONFIG_DIR_NAME` for project paths;
- centralize version-range validation;
- consider further Pi model-resolver delegation only if parity proves the Gateway fallback remains intact.

### Deletion test

For each candidate, name the last supported source release and prove zero production callers remain before deletion. Upgrade fixtures from every still-supported source release must pass. Retained legacy-field cleanup and active model fallback remain unless a new ADR explicitly replaces them.

### Verification

- Upgrade fixtures from every still-supported source release.
- Byte preservation for unrelated settings.
- Model/default/scoped-model parity for any resolver change.
- Typecheck proves no deleted compatibility import remains.
- Public docs clearly state the supported upgrade horizon.

### Estimated reduction

250–650 LOC in the first retirement wave.

---

# Strategic challenge outside the immediate top 10

## Can SF Herdr become a Pi skill instead of an extension/tool?

`sf-herdr` plus `lib/common/herdr-profile` is about **1,770 production LOC**. Its public tool is advisory: it emits a plan, then the model still calls the upstream Herdr tools explicitly. Much of the output restates stable guidance about fresh panes, aliases, observation, success, and cleanup.

Pi's native skill mechanism provides progressive disclosure and is a plausible replacement for the stable planning instructions. The model already knows the current workflow, so weighted inference from past tool calls may not justify a branch scanner, preferences store, config panel, command surface, result observer, and extra tool schema.

A useful deletion-test experiment would compare:

1. current `sf_herdr_plan` outcomes;
2. a compact `sf-herdr` skill with the same safety/lifecycle rules;
3. real task completion, pane hygiene, and prompt/tool-schema cost.

If the skill preserves behavior, retire the planner tool and profile machinery. If managed lane preferences and deterministic plan objects prove valuable, keep the extension. This contradicts ADRs 0016 and 0068 and therefore requires an explicit product decision, not a cleanup PR hidden inside another change.

Potential reduction: **1,200–1,600 LOC**.

---

# Cross-extension standardization matrix

| Area                | Current gap                                                                                          | Target ownership                                                                                |
| ------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Commands            | Manager deep-links and local panels are checked through exemptions; help/parser/docs adoption varies | One declared grammar per simple command; executable variant checks                              |
| Settings            | Repeated scope, source, dirty/save, and whole-file write mechanics                                   | Shared storage Module; extension-local defaults/validation; Pi `SettingsList` for simple panels |
| Results/artifacts   | Code Analyzer, Data 360, lifecycle tools, and spill files use different low-level contracts          | Shared envelope/artifact/output primitives; domain card adapters stay local                     |
| Salesforce requests | Common Connection exists, but version/strict-error helpers are repeated and Apex double-retries auth | Deepen `sf-conn`/`sf-rest`; lifecycle/query semantics stay local                                |
| Runtime visibility  | Human-only entries and `agent_settled` are good; Welcome and DevBar still duplicate some host facts  | Pi owns generic runtime facts; SF Pi owns Salesforce-specific status and presentation           |

---

# All-extension disposition

| Extension                 | Disposition                             | Main opportunity                                                                     | Correctly custom; retain                                                          |
| ------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `sf-agentscript`          | Keep + share mechanics                  | Common report/artifact primitives                                                    | Agent Script compile, mutate, inspect, preview, eval, lifecycle                   |
| `sf-apex`                 | Simplify                                | Shared `sf-conn`, artifacts, result/output shell                                     | Apex traces, logs, Anonymous Apex, tests, coverage                                |
| `sf-brain`                | Keep, compact later                     | Remove duplicated static extension-intent data; rely on active tool/skill provenance | Operator kernel and routing policy                                                |
| `sf-browser`              | Keep                                    | Low-level artifact/spill primitives only                                             | Salesforce UI auth, routing, waits, editor, evidence                              |
| `sf-code-analyzer`        | Keep; already Pi-native in key places   | Result-card sharing, simple Manager panels                                           | CLI contract, recipes, ApexGuru, settled scans                                    |
| `sf-data-explorer`        | Keep                                    | Settings and common connection primitives                                            | Read-only data grid, modes, exports                                               |
| `sf-data360`              | Keep                                    | Remove shallow barrels; share envelope/artifact primitives                           | Generated action registry, Data 360 APIs, safety, journeys                        |
| `sf-devbar`               | Product simplification candidate        | Restore Pi footer/theme; keep SF-only statuses                                       | Org/production warnings, LSP/Gateway/Slack signals, plus approved unique UI facts |
| `sf-docs`                 | Keep; native auth status fixed          | Shared auth/Manager shell                                                            | Docs query shaping, citations, direct MCP-over-HTTP client                        |
| `sf-feedback`             | Keep                                    | Shared settings/panel/runtime fixtures                                               | Sanitization, issue composition, explicit confirmation                            |
| `sf-guardrail`            | Keep                                    | Presentation/settings primitives only                                                | Safety policy, org classification, HITL, approvals, audit                         |
| `sf-herdr`                | Challenge                               | Compare advisory tool with Pi-native skill                                           | Keep only if inference/preferences prove product leverage                         |
| `sf-llm-gateway-internal` | Keep; native migration largely complete | Sunset eligible one-shot migrations; preserve retained cleanup and model fallback    | Gateway routes, payloads, models, diagnostics, spend                              |
| `sf-lsp`                  | Keep                                    | Settings, transcript helper, obsolete reload shims                                   | LSP discovery/process/protocol/diagnostics                                        |
| `sf-lwc`                  | Simplify                                | Lifecycle artifact/result shell                                                      | LWC inspection, compiler diagnostics, bounded Jest                                |
| `sf-ohana-spinner`        | Keep thin                               | Shared settings Module only                                                          | Pi working-indicator frames and Salesforce branding                               |
| `sf-pi-manager`           | Simplify                                | Pi package resolver and native TUI lists                                             | Catalog, extension settings/actions, recommendations, bounded updater             |
| `sf-skills`               | Keep under current ADR                  | Future capability-by-capability parity only                                          | Managed pack lifecycle, discovery, diagnostics, rescope, usage                    |
| `sf-slack`                | Keep; native auth status fixed          | Shared auth/controller/Manager shell                                                 | Slack tools, scope checks, exact-recipient/body HITL                              |
| `sf-soql`                 | Simplify                                | Shared `sf-conn`, artifacts, result/output shell                                     | Schema, validation, query plans, bounded execution, exports                       |
| `sf-welcome`              | Major simplification candidate          | Direct Pi-overlap first; owner-migrate or explicitly remove other rows               | Branded splash, announcements, privacy, next actions                              |

---

# What should not be “cleaned up” now

These Modules currently pass the deletion test and provide real Depth:

- `lib/common/state-store.ts` — atomic, versioned, scoped persisted state.
- `lib/common/sf-conn/connection.ts` — cached bounded org/connection/identity behavior.
- `lib/common/session/inject-once.ts` and active-branch projection — branch/compaction correctness.
- `lib/common/secure-credential-prompt.ts` — required because Pi 0.81.1's stock secret prompt is not acceptable under the current security proof.
- `lib/common/human-only-command-output.ts` — mode-safe, model-invisible status output.
- SF Guardrail's safety kernel, envelopes, approval ledger, and HITL.
- Slack send/schedule/canvas confirmation semantics.
- the Agent-Settled Update Coordinator while SF Pi maintains a bounded Pi runtime support window.

## Dynamic tool activation: do not adopt by default

Pi 0.80.7+ supports additive dynamic tool activation, and SF Pi has 41 tools, with Browser/Data 360/Slack accounting for 31. It is tempting, but the existing Browser pilot was explicitly stopped. A package-wide router would add code and another discovery turn; it is not automatically “lean.” Reopen only if measurement proves meaningful schema/cache savings and the design preserves exclusions, Guardrail interception, fallback models, resume, and compaction.

## SF Skills: no wholesale delegation

ADR 0082's real resolver parity work found both native parity and semantic disagreements. Pi does not replace managed Salesforce pack lifecycle, external-source discovery, stale-wiring diagnostics, rescope workflows, or usage awareness. Any future deletion must be capability-by-capability.

---

# Recommended execution sequence

## Wave 0 — one direct fix (complete)

1. Replaced `pi-auth-status.ts` parsing with `readStoredCredential`.
2. Added canonical API-key/OAuth exact-runtime tests.

## Wave 1 — make future cleanup safe

3. Fix scaffold, panel/check variants, runtime attestation, and catalog fail-closed behavior.
4. Replace low-value source-string tests as each area is touched.

## Wave 2 — shared mechanics

5. Introduce the scoped settings storage Module and migrate two simple extensions first.
6. Adopt Pi `SettingsList` for those panels.
7. Deepen `sf-conn` and migrate Apex/SOQL.
8. Add artifact/output primitives, then migrate Apex/SOQL/LWC.
9. Decide result-card Locality after a second real caller exists.

## Wave 3 — product simplification

10. Slim Welcome.
11. Review DevBar against Pi's current footer and theme.
12. Thin Manager onto Pi package/TUI primitives.

## Wave 4 — retire debt

13. Apply the migration sunset policy and delete only eligible one-shot and shallow compatibility paths.
14. Run the SF Herdr skill-vs-tool experiment only after an explicit product decision.

Each wave should use ADR 0086's behavior proof ladder. Do not retain dual production paths after parity passes.

---

# Validation performed for this audit

- Read root architecture and contributor instructions.
- Read the generated catalog and orientation map.
- Reviewed all 21 extension manifests and extension categories through parallel source audits.
- Inspected shared Modules and representative extension source/tests.
- Read the Pi 0.81.1 README, extension docs, TUI docs, packages, settings, skills, SDK, custom-provider docs, session format, and the release changelog for the audited window.
- Ran:
  - `npm run check:panels`
  - `npm run check:boot-path`
  - `npm run docs:health:check`
  - `npm run check`
  - `npm test`
  - `git diff --check`
- Proved the API-key auth-status mismatch against Pi's exported `readStoredCredential`.

No production source was changed as part of the audit.

---

# Public Pi sources

- [Pi 0.81.1 release](https://github.com/earendil-works/pi/releases/tag/v0.81.1)
- [Pi 0.81.1 changelog](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/CHANGELOG.md)
- [Extension lifecycle and dynamic tools](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/extensions.md)
- [SDK and SettingsManager/SessionManager](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/sdk.md)
- [Pi package/resource configuration](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/packages.md)
- [Pi skills and progressive disclosure](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/skills.md)
- [Pi session format](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/session-format.md)
- [Pi custom Provider contract](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/docs/custom-provider.md)
- [Pi philosophy and intentionally unbundled capabilities](https://github.com/earendil-works/pi/blob/v0.81.1/packages/coding-agent/README.md#philosophy)

---

# Grill decisions

1. **Canonical no-args command surface:** every bundled interactive `/sf-X` command opens that extension's SF Pi Manager detail page. Explicit subcommands remain direct; specialized/full-screen UI launches through an explicit action. This confirms ADR 0051 and supersedes ADR 0005's old no-args rule.
2. **Settings inheritance:** every `sfPi.<extension>` field resolves as project → global → default. A project section overrides only fields it declares; omitted fields inherit global values. This amends ADR 0006's consistency baseline.
3. **Manager-first cutover:** Apex, LWC, and SOQL migrate in the same release that makes the no-args rule blocking. No current command is grandfathered and no warning-only transition remains.
4. **Settings panel boundary:** the shared descriptor-driven UI supports only simple fixed-choice scalar fields. Conditional, nested, security-sensitive, credential, diagnostic, and specialized editor panels remain extension-owned; no universal config framework is introduced.
5. **Salesforce request contract:** `connRequest()` remains the soft response-as-data base Interface. Shared strict JSON/text Adapters sit on top for Apex/SOQL-style workflows, reuse the base request's single auth refresh, and add no second retry.
6. **Salesforce API version:** if a Connection provides no API version, the shared helper fails with an actionable error. It never guesses `67.0` and does not introduce a second SF Pi fallback setting.
7. **Settings migration:** field-level inheritance changes read semantics only. Existing settings files are not rewritten or expanded. Release notes must call out effective-value changes when omitted project fields begin inheriting non-default global values.
8. **Settings pilot:** SF Browser and SF Agent Script migrate first. Project rows expose **Inherit global**; global rows expose **Use default**. These delete one scoped field, never materialize inherited siblings, and prune empty extension sections when safe.

# Recommended review choice

Approve **Waves 0–2** for detailed planning first. Review the Welcome, DevBar, Manager, and SF Herdr product-scope decisions separately before authorizing implementation.
