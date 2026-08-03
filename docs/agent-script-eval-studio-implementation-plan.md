# Agent Script Eval Studio Implementation Plan

Status: implemented end to end; automated Behavior Proofs and full repository validation passed on 2026-07-30

## Goal

Deliver a Pi-native **Agent Script Eval Studio**, opened by `/sf-agentscript evals`, for reviewing, authoring through conversational handoff, executing, and diagnosing local **Agent Script Eval Suites** and their Run evidence.

The Studio must make multi-turn conversations and evaluator intent easy to understand without introducing another source format, another eval backend, optimistic verdicts, hidden org targeting, or a Testing Center clone.

## Decision sources

- `CONTEXT.md` — canonical Eval Studio language
- `docs/adr/0013-agentscript-branch-durable-tool-state.md`
- `docs/adr/0014-agent-script-four-family-tool-surface.md`
- `docs/adr/0051-extension-commands-deep-link-to-manager-surface.md`
- `docs/adr/0055-manager-detail-and-settings-save-contract.md`
- `docs/adr/0085-agent-workflow-visibility-contract.md`
- `docs/adr/0086-behavior-proof-ladder.md`
- `docs/adr/0090-agentscript-stateful-eval-scenarios.md`
- `docs/adr/0094-agent-script-eval-gated-activation.md`
- `docs/adr/0097-agent-script-eval-studio-local-first-workspace.md`

## Locked product contract

### Authority and identity

- Eval Studio inventory is local-first.
- Salesforce is contacted only for explicit Run Target resolution or execution.
- One **Agent Script Eval Suite** is one executable EvalSpec JSON file.
- EvalSpec JSON remains the only source-controlled eval format.
- Canonical project suites use:
  - `tests/agentforce/<AgentApiName>.eval.json` for the designated release Suite;
  - `tests/agentforce/<AgentApiName>.<suite-slug>.eval.json` for additional Suites.
- Agent API name is canonical; local `.agent` source is optional.
- Conflicting Agent identities are visible and never merged silently.
- Suite rename continuity requires an exact source digest and exact Agent identity match.
- Inline/pathless Runs are Ad Hoc Runs and never create synthetic Suites.

### Hierarchy and views

```text
Agent → Suite → Scenario → Turn → Evaluator
                         ↘ Run evidence
```

- Agent tabs: `Suites | Recent Runs | Release Contract`.
- Suite tabs: `Scenarios | Evaluators | Runs | Source`.
- Scenario tabs: `Conversation | Evaluators | Evidence`.
- Source subviews: `Current | Run Source | Executed`.
- Agent-level inferred Coverage is deferred.
- Generated Baseline is a visible, read-only Suite.
- Source is read-only; mutation occurs through the Agent.

### Scenario and evaluator contract

- A Scenario has one shared session, one or more ordered user turns, and at least one evaluator.
- Before execution, Agent-side content is **Expected Behavior**, never a scripted Agent utterance.
- After execution, actual Agent response and evidence are shown.
- Evaluators are Turn-scoped or Scenario-scoped; ambiguous attribution remains Scenario-scoped.
- Evaluator capability is Live-Proven, Client-Recognized, or Candidate/Unverified.
- Default authoring guidance shows Live-Proven evaluators.
- Advanced/Unverified evaluators require a one-run acknowledgement and cannot produce release-ready evidence merely because they were acknowledged.
- Unprojectable raw test entries remain source-visible but block Studio execution.

### Run contract

- Run Suite and diagnostic Run Scenario are both MVP actions.
- Scenario Runs never satisfy release evidence.
- New Runs default to Active version resolution.
- Latest/pinned versions are explicit.
- Historical Rerun prefills the exact historical target when resolvable and requires visible review.
- Org selection is run-local and never changes the Salesforce CLI default.
- Existing global trace/concurrency settings are defaults; one-run overrides do not persist.
- Eval Studio launches at most one Studio-owned Run per project.
- Existing direct tool/slash eval paths remain power-user paths and are not silently serialized by the Studio lease.
- Closing the overlay does not cancel a Studio Run.
- Cancellation is explicit and confirmed.
- Process/session loss produces Interrupted when owner loss is proven; age alone is insufficient.
- Suite files refresh manually through `R` or reopen; Studio-owned Run progress updates live.

### Execution state, evidence verdict, and freshness

Execution state:

- Running
- Completed
- Cancelled
- Interrupted
- Infrastructure Failed

Evidence verdict:

- Passed — every expected result returned effectively true with complete step and transport evidence;
- Failed — explicit behavioral evaluator failure;
- Incomplete — missing Scenario/evaluator result, evaluator error, failed batch, step error, or other incomplete evidence;
- Unverified — returned evidence exists but cannot be interpreted through a live-proven rule.

Freshness:

- Stale Source is orthogonal to execution state and evidence verdict.
- Historical evidence preserves both its recorded verdict and the current interpretation.
- Legacy evidence is never rewritten.

### Authoring and evidence boundaries

- MVP actions: New Suite with Agent, New Scenario with Agent, Edit with Agent, Diagnose with Agent.
- A compact **Agent Script Eval Authoring Brief** captures purpose, turn examples, proof intents, and seed assumptions.
- The Studio closes and prefills the Pi editor; reopen is manual.
- No direct JSON editing, auto-reopen, persistent companion mode, live-data picker, or automated Preview replay.
- Scenario seeds are primary; Suite defaults are expanded into Scenarios.
- Context & State shows effective seeds, provenance, checkpoints, observed state, and deltas.
- Conversation content is visible; sensitive operational values are masked by default.
- Markdown report, Copy Summary, and Open Artifact Directory are MVP actions.
- Run deletion and retention management are deferred.

## Non-goals

- No new public LLM tool family or compatibility wrapper.
- No second eval model, YAML format, sidecar registry, or metadata compiler.
- No org-first Testing Center inventory.
- No Agent-level inferred coverage percentages.
- No multi-Run scheduler.
- No Turn-only execution.
- No automated Preview replay.
- No test-data browser.
- No editable Source tab.
- No run comparison/trend product.
- No Voice authoring.
- No arbitrary Suite-root configuration.
- No CSV/PDF/JUnit export product.
- No destructive Run cleanup in MVP.
- No implementation before separate authorization.

## Behavior-Proof contract

Every behavioral milestone begins with a failing or characterization proof through the public seam it changes and ends with all of its proofs green. Milestone 0 records only green characterization of current behavior; each later milestone introduces and resolves its own red contract proof.

Required proof tiers, used according to risk:

1. pure contract/model tests;
2. exact-Pi command/overlay/entry-renderer integration;
3. focused extension tests and typecheck;
4. support-window tests where Pi runtime behavior is involved;
5. scoped live Agentforce proof where fixtures cannot establish evaluator/API behavior;
6. manual narrow/normal/wide TUI QA for visible changes;
7. full repository validation before implementation is considered complete.

No milestone retains an old and new production path merely because the replacement is hard to verify.

---

## Milestone 0 — Baseline characterization

### Purpose

Pin current contradictions before changing execution, persistence, or rendering.

### Behavior Proofs

Add green characterization tests that pin current behavior, including:

- failed batch with zero returned Scenarios can appear green in the current slash renderer;
- missing evaluator results are not compared against expected evaluator IDs;
- unresolved `is_pass: null` handling is inconsistent;
- all-null `__optN` groups do not have the locked Unverified meaning;
- slash, tool, report, and release-gate success rules diverge;
- Run status is created before target/normalization preflight;
- report saving still points at the legacy Eval path;
- release evidence lookup depends on the 50-entry convenience index.

### Likely files

- `extensions/sf-agentscript/tests/eval-batch-failure.test.ts`
- `extensions/sf-agentscript/tests/render-eval.test.ts`
- `extensions/sf-agentscript/tests/release-contract.test.ts`
- new `extensions/sf-agentscript/tests/eval-verdict.test.ts`
- new `extensions/sf-agentscript/tests/eval-run-boundary.test.ts`

### Exit gate

All characterization proofs pass and precisely expose the current contradictions. No intended-red proof remains at the milestone boundary.

---

## Milestone 1 — Total verdict and evaluator authority

### Purpose

Create one evidence interpretation used by every surface before adding the Studio.

### New seams

```text
extensions/sf-agentscript/lib/eval/
├── evaluator-catalog.ts
└── verdict.ts
```

### Work

- Centralize known evaluator identity, family, capability, operator, threshold, and display metadata.
- Move duplicated evaluator sets/default metric knowledge out of `normalize.ts` and `threshold.ts`.
- Represent execution state, evidence verdict, and freshness separately.
- Enumerate expected Scenario/evaluator IDs from the executed spec.
- Compare expected versus returned evidence exactly.
- Define effective evaluator truth:
  - explicit true/false;
  - live-proven threshold conversion;
  - missing/error → Incomplete;
  - unknown null → Unverified;
  - any-of with any true → true;
  - any-of with no true and any missing/error member → Incomplete;
  - any-of with no true, at least one unresolved member, and no missing/error → Unverified;
  - any-of with all members explicitly false → false.
- Define Run-level evidence precedence:
  1. any missing/error/transport/step evidence → Incomplete;
  2. otherwise any effectively false evaluator → Failed;
  3. otherwise any unresolved evaluator → Unverified;
  4. otherwise every expected evaluator true → Passed.
- Route tool, direct slash command, Markdown report, and compact renderer through this seam.
- Preserve recorded verdict and semantics version in new metadata; compute current interpretation read-only.
- Define and test the future release-eligibility predicate, but defer production activation-authority cutover until Milestone 7, after Milestone 3 can emit current-schema snapshots, scope, and immutable identity evidence.

### Modify

- `lib/eval/types.ts`
- `lib/eval/normalize.ts`
- `lib/eval/threshold.ts`
- `lib/eval/render.ts`
- `lib/eval-tool.ts`
- `lib/render/eval.ts`
- `lib/command/eval-action.ts`
- `lib/release-contract.ts`

### Proof matrix

- true, false, missing, evaluator error, null-known, null-unknown;
- missing/extra/duplicate evaluator result;
- missing/extra/duplicate Scenario result;
- one passing any-of member plus null members → passed;
- false plus unresolved any-of members → unverified;
- false plus missing/errored any-of members → incomplete;
- all-null any-of → unverified;
- all-false any-of → failed;
- mixed Run evidence follows Incomplete → Failed → Unverified → Passed precedence;
- step and batch failures;
- cancelled/interrupted execution state independent of verdict;
- recorded versus current verdict;
- stale source orthogonal;
- the future eligibility predicate accepts complete Suite-scope exact-identity evidence and rejects Scenario, Ad Hoc, Legacy, Unverified, stale-identity, and wrong-org/version evidence;
- otherwise-valid evidence remains discoverable and eligible after eviction from the convenience index.

### Exit gate

No result renderer, command, or tool independently implements pass/fail logic. The new release-eligibility predicate is fully tested but not yet the production activation authority.

---

## Milestone 2 — Studio projectability and structural preflight

### Purpose

Create the conservative inverse projection from raw EvalSpec steps to Studio concepts.

### New seams

```text
extensions/sf-agentscript/lib/eval-studio/
├── types.ts
└── projectability.ts
```

### Rules

A Studio-projectable Suite requires:

- parseable JSON object;
- non-empty `tests`;
- unique non-empty Scenario IDs;
- unique non-empty step/evaluator IDs per Scenario;
- exactly one shared session per Scenario;
- one or more ordered user turns;
- unambiguous send/state pairing by execution order;
- at least one evaluator per Scenario;
- resolvable evaluator references;
- deterministic Turn versus Scenario evaluator scope;
- unknown evaluator type retained with capability warning;
- no silent source mutation or repair.

Unprojectable entries remain visible in Source and diagnostics, but Studio Run actions are disabled. `/sf-agentscript eval <spec>` remains the explicit lower-level raw escape hatch.

### Proofs

- valid one-turn and multi-turn Scenarios;
- duplicate/missing IDs;
- multiple sessions;
- missing send/state/evaluator;
- unresolved/ambiguous references;
- evaluator spanning turns;
- candidate evaluator remains projectable with acknowledgement requirement;
- source aliases can be projected through a normalized clone without changing authored bytes.

### Exit gate

Every Studio-visible Scenario has an honest Turn/Evaluator projection or a blocking diagnostic—never a guessed partial conversation.

---

## Milestone 3 — Validated Run boundary and immutable artifacts

### Purpose

Prevent draft/preflight attempts from becoming historical Runs and provide trustworthy source/execution provenance.

### Refactor

Split eval orchestration internally:

```text
prepare attempt
  → parse raw EvalSpec
  → apply Studio projectability only for Studio entry points
  → preserve permissive raw normalization/API validation for direct eval entry points
  → resolve Agent/org/version
  → substitute/inject IDs
  → normalize
  → resolve org identity
  → enumerate expected evidence
  → compute source/executed digests

begin Run
  → atomically create manifest/status/snapshots
  → only then issue the first Evaluation API request
```

Preparation has an explicit mode. `studio` mode requires Milestone 2 projectability; `raw` mode preserves hand-written EvalSpec compatibility for `agentscript_eval run` and `/sf-agentscript eval <spec>`. Both modes share target resolution, normalized execution, immutable snapshots, persistence, and verdict derivation.

### New Studio-era artifacts

```text
.pi/state/sf-agentscript/runs/<run_id>/
├── manifest.json
├── status.json
├── metadata.json
├── spec.source.snapshot.json
├── spec.executed.snapshot.json
├── raw.json
├── transcript.jsonl
├── failures.jsonl
├── batch-failures.json
└── traces/
```

Manifest/status must carry:

- schema and verdict-semantics versions;
- Run scope (`suite` or `scenario`) and parent identities;
- Suite path or Ad Hoc classification;
- exact Run Target;
- redacted effective Scenario-seed provenance/digests, with exact values confined to the restricted executed snapshot;
- source/executed digests;
- evaluator capability acknowledgement;
- recorded execution state/verdict;
- coordinator identity for Studio-owned Runs;
- structured progress counts.

### Rules

- Failed preflight for the selected preparation mode creates no Run directory and no snapshots; Studio-only projectability never blocks direct raw eval compatibility.
- Snapshot persistence failure aborts before network execution.
- Scenario Run snapshots the full source Suite and an executed one-Scenario spec.
- Started Runs retain snapshots when Failed, Cancelled, Interrupted, or Infrastructure Failed.
- `status.json`, `_index.json`, and lease/pointer files use atomic temp + rename.
- Progress writes are serialized and monotonic.
- Sensitive raw artifacts use restrictive file permissions where supported.
- Seed values never enter index, lease, status, or summary artifacts.
- Release-contract identity is present in the immutable start manifest, not patched after completion.

### Modify

- `lib/eval/orchestrator.ts`
- `lib/eval/persist.ts`
- `lib/eval/types.ts`
- `lib/release-contract.ts`

### Proofs

- no directory on malformed/unprojectable/unresolved target;
- both snapshots and start manifest exist before first POST;
- source edits after start do not alter snapshots;
- atomic pointer writes survive interruption;
- scenario scope and release ineligibility persist;
- legacy v1 artifacts remain read-only and loadable;
- exact raw execution input is absent from list/status/index outputs.

### Exit gate

Every new Run is an immutable evidence envelope tied to a validated attempt.

---

## Milestone 4 — Local inventory and pure projections

### Purpose

Build the complete local read model before TUI work.

### New seams

```text
extensions/sf-agentscript/lib/eval-studio/
├── discovery.ts
├── artifact-reader.ts
├── suite-projector.ts
├── run-projector.ts
├── model.ts
└── redaction.ts
```

### Discovery

On explicit `evals` open only:

- inspect `.agent` bundles inside registered package directories;
- discover canonical flat Eval Suite filenames;
- include branch-state Suite pointers outside the canonical root;
- include Generated Baseline artifacts;
- merge `_index.json` with a bounded newest-first directory scan;
- lazy-load raw/trace evidence.

Agent identity order:

1. parsed `config.agent_name`;
2. canonical Suite filename;
3. Run metadata;
4. explicit conflict rather than silent merge.

Classification:

- current Studio-era Run;
- Legacy/Unverified Run;
- Ad Hoc Run;
- Unassigned Run;
- unavailable/corrupt artifact with reason.

Rename continuity requires exact source digest + exact Agent identity + unique match.

### Projection

Produce deterministic I/O-free models for:

- Agent tabs: Suites, Recent Runs, Release Contract;
- Suite tabs: Scenarios, Evaluators, Runs, Source;
- Scenario tabs: Conversation, Evaluators, Evidence;
- Source subviews: Current, Run Source, Executed;
- remembered session selection, otherwise newest completed matching Run;
- Spec-only view;
- source order plus failure-only filter;
- Generated Baseline and designated release badges;
- recorded/current verdicts;
- exact target/version or Unknown;
- Context & State timeline;
- connected-agent evidence availability.

### Wide row contracts

Scenarios:

```text
State · Scenario · Turns · Topic · Actions · State · Evaluators · Selected Run
```

Evaluators:

```text
State · Evaluator · Capability · Scope · Scenario/Turn · Expected · Actual/Score
```

Recent Runs:

```text
State · Started · Scope · Suite/Scenario · Version · Results · Errors · P95 · Duration
```

### Redaction

Default-mask:

- authorization/token/secret-like fields;
- session-bearing URLs;
- sensitive seed/context values;
- full prompts;
- raw action input/output payloads.

Default-show:

- conversation content;
- Expected Behavior;
- effective seed names/types/provenance with masked value as needed;
- state checkpoints/deltas;
- topic/action names;
- evaluator expected/actual summaries.

Explicit raw reveal is interactive and never enters automatic reports/screenshots.

### Exit gate

The entire Studio can be represented and tested without Pi TUI or Salesforce calls.

---

## Milestone 5 — Read-only responsive Eval Studio

### Purpose

Prove navigation and rendering before execution is exposed.

### New seams

```text
extensions/sf-agentscript/lib/eval-studio/
├── viewport.ts
├── layout.ts
├── glyphs.ts
├── component.ts
└── open.ts
```

### Command and Manager shell

Modify `extensions/sf-agentscript/index.ts` and focused smoke tests in this milestone:

- register canonical `evals` action metadata, completion, help, and handler;
- `/sf-agentscript evals` opens a near-full, top-centered overlay;
- add Manager **Open Eval Studio** with `closeBeforeRun: true` and no competing `createPanel`;
- keep no-args `/sf-agentscript` Manager-first;
- keep `/sf-agentscript eval <spec>` as direct execution;
- make non-TUI `evals` return a bounded local inventory summary with no org call.

### Layout

- wide: hierarchy/list/detail with evidence-oriented columns;
- normal: list/detail;
- narrow: explicit drill-down;
- no responsive mode may hide a capturing overlay;
- terminal rows are injected from `tui.terminal.rows` rather than relying on post-render truncation.

### Interaction

- configurable select navigation plus arrows and `j/k`;
- Enter/right drills; left/Backspace returns;
- tabs and direct tab numbers outside inputs;
- `/` filter with Pi `Input` and IME focus propagation;
- `f` failures-only;
- `R` local file refresh;
- `?` contextual help;
- Source read-only;
- rich glyphs plus shared ASCII fallback.

### Proofs

- every line fits visible width;
- focus/IME and Escape layering;
- preserved source order and selection;
- full wide columns and graceful narrow collapse;
- light/dark/theme invalidation;
- Generated Baseline and Legacy/Ad Hoc states;
- Manager close-before-open;
- RPC/print/JSON make zero Salesforce calls and never mount custom UI.

### Exit gate

A user can navigate every locked local view without execution or mutation.

---

## Milestone 6 — Studio Run coordinator and explicit Run Target

### Purpose

Enable safe Suite/Scenario execution independent of overlay lifetime.

### New seams

```text
extensions/sf-agentscript/lib/eval-studio/
├── run-lease.ts
├── run-coordinator.ts
├── run-target.ts
└── run-actions.ts
```

### Studio lease

- one Studio-owned Run per canonical project root;
- atomic cross-process lease with PID, nonce, project root, job/run ID, and owner session when available;
- direct tool/slash eval runs consume shared execution/verdict persistence but are not automatically blocked by the Studio lease;
- second Studio launch reports the active Studio Run;
- stale ownership is reclaimed only when owner loss is proven;
- age alone never proves interruption.

### Lifecycle

- Run begins outside the overlay component.
- Overlay subscribes/unsubscribes to typed progress.
- Closing overlay leaves the same-process Run active.
- Explicit `c` confirmation aborts through coordinator control.
- Reopen reconnects to same-process coordinator or persisted status.
- Pi process/session teardown attempts terminal persistence and produces Interrupted when completion cannot continue.
- Completion emits one Human-Only Transcript Row; progress never enters model context.

### Run Target

Always display:

- run-local authenticated org selection;
- sandbox/production status when known;
- Agent API name;
- Active/latest/pinned policy;
- freshly resolved exact BotVersion and planner identity;
- Suite or Scenario scope;
- effective Scenario seeds and provenance;
- optional one-run Scenario seed overrides;
- trace mode and concurrency defaults;
- other non-persistent overrides;
- Advanced/Unverified evaluator acknowledgement.

Rules:

- new Run defaults Active;
- non-Active requires existing acknowledgement/Guardrail behavior;
- historical Rerun preselects exact historical target only after fresh resolution and visible review;
- unresolved historical target stays empty—never silently switches Active;
- org choice never changes CLI default;
- Run-level seed overrides are scoped to named Scenarios, produce the effective executed snapshot, and never mutate the source Suite;
- per-turn seed overrides are deferred from MVP.

### Execution actions

- Run Suite;
- Run Scenario;
- Rerun historical Run;
- explicit Cancel Run.

A failed Run auto-enables failures-only while preserving source order when cleared.

### Proofs

- overlay close does not cancel;
- explicit cancel yields Cancelled execution state;
- owner loss yields Interrupted;
- one Studio Run per project across two processes;
- Suite and Scenario scopes persist;
- Scenario Run cannot satisfy release gate;
- unverified acknowledgement is one-run-only and does not change capability/release eligibility;
- progress is typed and monotonic.

### Exit gate

Studio can create trustworthy background Run evidence without becoming a scheduler.

---

## Milestone 7 — Release Contract integration

### Purpose

Expose existing exact-version release evidence without collapsing constituent Suites.

### Refactor

Extract `run_release` orchestration from the public tool adapter into a structured internal seam, while preserving `agentscript_eval action="run_release"` behavior.

Return:

- pending exact non-Active version;
- Generated Baseline identity/Run;
- designated Suite identity/Run when present;
- skipped reason when baseline blocks designated execution;
- combined contract verdict.

### Studio behavior

- Release Contract tab is cache-first.
- Generated Baseline is visible/read-only and may be regenerated only through explicit action.
- Designated `<AgentApiName>.eval.json` remains source-controlled.
- **Run Release Contract** enables only after explicit org resolution finds a pending latest non-Active version.
- Baseline failure marks designated execution Skipped, never Passed or Missing.
- Ordinary Active-version Suite Runs remain separate.
- Scenario, Ad Hoc, Legacy, Unverified, or incomplete Runs never satisfy the contract.

### Release evidence authority

- Cut production activation over to the Milestone 1 eligibility predicate only now, after Milestone 3 current-schema snapshots/scope/identity evidence exists.
- Replace the 50-entry convenience index as release authority with a separate atomic release-evidence index keyed by org ID, Agent API name, BotVersion ID, contract kind, and digest.
- Make that index rebuildable through a complete scan of current-schema Run manifests for the requested identity; a capped recent-run scan is never sufficient release authority.
- Prove otherwise-valid exact-version evidence remains accepted after it falls out of `_index.json`.
- Pin current generated-baseline source/generator identity, not only the constant baseline ID.

### Exit gate

Activation and Studio present the same exact release readiness for the same org/version/source identities, and convenience-index eviction cannot expire valid evidence.

---

## Milestone 8 — Conversational authoring and diagnosis

### Purpose

Make Agent-authored EvalSpec practical without adding a JSON editor or second format.

### New seams

```text
extensions/sf-agentscript/lib/eval-studio/
├── authoring-brief.ts
└── handoff-prompts.ts
```

### Actions

- New Suite with Agent;
- New Scenario with Agent;
- Edit with Agent;
- Diagnose with Agent.

### Compact brief

Collect only:

- purpose/name;
- user-turn outline/example utterances;
- proof intents;
- Scenario seeds and data assumptions;
- selected diagnostics/evidence.

Suite seed defaults are expanded into Scenario-owned seeds. The brief can describe Scenario seeds, but per-turn seed overrides are deferred from MVP.

### Handoff

- close Studio before prefilling Pi editor;
- include exact Agent/Suite/Scenario/Run identities and validation expectations;
- exclude raw secret/trace payloads;
- manual `/sf-agentscript evals` reopen;
- no auto-reopen or companion overlay;
- no direct file mutation from the TUI;
- no org data lookup;
- Diagnose suggests `agentscript_preview` through the Agent but does not replay automatically.

### Exit gate

Every authoring mutation remains an ordinary visible Agent file-tool workflow followed by Suite preflight.

---

## Milestone 9 — Reports, artifacts, and completion visibility

### Purpose

Complete the review loop without creating a reporting or retention product.

### Actions

- Open Markdown Report;
- Copy Summary;
- Open Artifact Directory with platform-safe fallback to displaying the path.

### Fixes

- reconcile report paths to `.pi/state/sf-agentscript/runs/<run_id>`;
- reports show execution state, recorded verdict, current interpretation, freshness, scope, target, and bounded evidence;
- reports use redacted values by default;
- completion uses one Human-Only Transcript Row;
- no Run deletion, retention, CSV, PDF, JUnit, or raw screenshot export.

### Exit gate

A completed background Run is discoverable, reportable, and auditable without entering future model context.

---

## Milestone 10 — Documentation, integration, and release proof

### Integration regression

Re-run and broaden the Milestone 5 command/Manager/mode proofs after execution, release, authoring, and report actions are present. Milestone 10 does not defer initial registration of the Studio surface.

### Documentation

Update:

- `extensions/sf-agentscript/README.md`
- `extensions/sf-agentscript/AGENT_GUIDE.md`
- `extensions/sf-agentscript/manifest.json`
- `CONTEXT.md` only if implementation exposes a missing domain term
- ADR 0097 only for a genuine decision correction
- this plan’s status as milestones complete

Regenerate rather than hand-edit generated catalog/docs.

### Focused test families

New tests should remain responsibility-aligned rather than one giant Studio test:

```text
eval-verdict.test.ts
eval-run-boundary.test.ts
eval-studio-projectability.test.ts
eval-studio-discovery.test.ts
eval-studio-artifact-reader.test.ts
eval-studio-model.test.ts
eval-studio-redaction.test.ts
eval-studio-layout.test.ts
eval-studio-component.test.ts
eval-studio-run-target.test.ts
eval-studio-run-coordinator.test.ts
eval-studio-release-contract.test.ts
eval-studio-authoring.test.ts
eval-studio-report-actions.test.ts
```

### Manual TUI proof

- narrow, normal, and wide terminals;
- resize during navigation and active Run;
- light/dark themes and ASCII mode;
- one-turn and multi-turn Scenarios;
- full evidence tables;
- Spec-only/current/historical Run selection;
- Suite and Scenario Runs;
- close/reopen while Run continues;
- explicit cancel;
- failed Run auto-filter;
- current, Legacy, Ad Hoc, Unassigned, Interrupted, and Stale Source states;
- Current/Run Source/Executed source views;
- authoring handoff and manual reopen.

### Live proof

Only when safe test fixtures cannot prove the behavior:

- one Active-version Suite Run;
- one Scenario Run;
- one pending non-Active Release Contract Run against a safe test Agent/version;
- any evaluator promoted from Client-Recognized to Live-Proven.

Do not activate or publish as part of this UI proof unless separately authorized and Guardrail permits it.

### Final commands

```bash
npm run generate-catalog
npm run format:check
npm run check
npm test -- extensions/sf-agentscript/tests
npm run validate
```

Also run exact Pi Runtime Floor/Audit Edge checks required by the current support-window scripts for command, overlay, entry-renderer, and Manager integration.

### Public-sanitization gate

Review code, docs, fixtures, rendered snapshots, report examples, artifact samples, and commit text for private identifiers, customer-specific scenarios, org IDs, usernames, URLs, tokens, or non-public implementation details.

## Suggested implementation file map

```text
extensions/sf-agentscript/lib/
├── eval/
│   ├── evaluator-catalog.ts       # new
│   ├── verdict.ts                 # new
│   ├── release-orchestrator.ts    # new
│   ├── orchestrator.ts            # prepare/begin/execute
│   ├── persist.ts                 # schema/atomic/snapshot artifacts
│   └── ...
└── eval-studio/
    ├── types.ts
    ├── projectability.ts
    ├── discovery.ts
    ├── artifact-reader.ts
    ├── suite-projector.ts
    ├── run-projector.ts
    ├── model.ts
    ├── redaction.ts
    ├── viewport.ts
    ├── layout.ts
    ├── glyphs.ts
    ├── component.ts
    ├── open.ts
    ├── run-lease.ts
    ├── run-coordinator.ts
    ├── run-target.ts
    ├── run-actions.ts
    ├── authoring-brief.ts
    ├── handoff-prompts.ts
    ├── report-actions.ts
    └── transcript.ts
```

The exact split can shrink during implementation if adjacent responsibilities remain small. Do not collapse artifact I/O, pure projection, coordination, and rendering into one overlay file.

## Delivery order and dependency summary

```text
M0 characterize
  ↓
M1 verdict/evaluator authority
  ↓
M2 projectability
  ↓
M3 validated Run artifacts
  ↓
M4 local discovery/projections
  ↓
M5 read-only Studio
  ↓
M6 Suite/Scenario execution
  ↓
M7 Release Contract
  ↓
M8 conversational authoring
  ↓
M9 reports/completion rows
  ↓
M10 docs + full proof
```

The read-only Studio must pass before Run actions are exposed. Suite Run must pass before Scenario Run and Release Contract actions are enabled. Each milestone stops on a failed gate; later milestones do not compensate for earlier evidence gaps.

## Residual risks

- Evaluation API evaluator/result shapes can drift; capability labels require maintained evidence.
- Overlay-close continuation is same-process, not durable process resumption.
- Exact executed specs and raw responses can contain sensitive values despite display redaction.
- Cross-process Studio lease recovery must fail closed when owner liveness is ambiguous.
- Generated-baseline freshness is difficult when local Agent source is unavailable; normal release readiness should fail closed rather than infer.
- Large `raw.json` files may eventually justify a derived compact result index, but only after measurement.
- Direct eval power-user paths can overlap Studio-owned Runs because the one-run lease is intentionally Studio-scoped; unique Run directories and strict artifact ownership must keep those executions independent.
