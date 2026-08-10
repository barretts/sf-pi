# sf-agentscript

Agent Script lifecycle tooling for pi — **agent-first** authoring, local-first
compile, deterministic inspection/review, AST-safe edits, live-org preview,
multi-turn evals, and publish/activation workflows. Salesforce calls use
`@salesforce/core` / SDR / REST surfaces; no `sf` subprocess runs on the hot path.

## What It Does

`sf-agentscript` exposes four LLM-callable family tools:

| Tool                    | What it owns                                                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agentscript_authoring` | Local `.agent` authoring: create bundles, compile/check or format, inspect structure/references/targets/native quality, deterministic readiness review, and structural mutations. Uses `verb` + `mode`.                                                 |
| `agentscript_preview`   | Live-org preview: start/send/end sessions, fetch traces, bulk end sessions, and clean stale preview artifacts. Send renders a rich human Preview Trace Report while keeping the LLM payload compact through a structured digest and raw-trace pointers. |
| `agentscript_eval`      | Regression workflow: generate starter specs, run evals, drill into failures, synthesize trace artifacts, fetch explicit live traces, and resolve active/latest BotVersion ids.                                                                          |
| `agentscript_lifecycle` | Publish/activation workflow: publish versions, activate/deactivate, list versions, and diagnose/provision Service Agent users.                                                                                                                          |

## Authoring API

`agentscript_authoring` uses a family shape instead of many single-purpose tools:

```json
{ "verb": "compile", "mode": "check", "agent_file": "force-app/.../Billing_Bot.agent" }
```

Rules:

- `verb="create"` omits `mode` and requires `bundle_name`. Generated templates use subagents rather than deprecated topic blocks: `minimal` deterministically enters one primary subagent, while `agentforce-default` exposes one planner-selectable transition per requested responsibility. Both include required welcome/error system messages so create → review is ready by construction. Use `job_spec.subagents`; `job_spec.topics` remains a legacy alias and is ignored when `subagents` is supplied.
- `verb="compile"` defaults `mode` to `check`; `mode="format"` writes canonical SDK formatting.
- `verb="inspect"` defaults `mode` to `structure`; modes include `context_profile`, `find_references`, `definition`, `check_targets`, `quality`, and `review`.
- `verb="mutate"` requires `mode`; modes include `set_field`, `rename`, `insert`, `delete`, and `apply_quick_fix`.
  - `set_field` is a structured scalar field update/upsert for existing top-level Agentforce schema components. It supports first-level scalar fields on singular blocks (for example `config`, `access`, `system`, `model_config`, `knowledge`) and named entries (for example `start_agent.main`, `subagent.billing`, `connection.messaging`, `variables.customer_id`, `actions.lookup`). It does not create missing blocks or nested paths.
  - `rename` is reference-safe for declarable symbols (`@subagent.X`, `@topic.X`, `@actions.X`, `@variables.X`) and accepts legacy component paths.
  - `insert` / `delete` intentionally guide callers to generic file edits followed by compile/check for broader source construction.
- `agent_file` may be omitted only when exactly one current `.agent` file exists on the active Pi branch. Ambiguity is refused with structured candidates.
- Explicit compile/check composes the official `compileSource` and `processDocument` results for one source identity. Shared diagnostics are deduplicated by code, full range, and message; unique diagnostics from either result remain visible, and any severity-1 diagnostic blocks compile validity. Detailed diagnostics stay position-first while the compact summary remains severity-first. Automatic compile-on-save feedback is intentionally limited to errors and warnings.
- `inspect/structure` is a stable workflow projection, not raw compiler AST. It includes connected-agent topology, skills, runtime/file-upload settings, and recommended-prompt settings needed for planning, review, and preflight.
- `inspect/check_targets` reports target existence separately from connected-agent runtime readiness and always surfaces actionable target rows before resolved samples. Apex invocable contracts come from Salesforce's registered Apex Action description, which supports direct primitive and wrapper-based methods without parsing source. An existing connected agent without an Active version produces a non-blocking warning and activation hint rather than being mislabeled as missing. Local project sources are traversed cycle-safely to depth five for transitive readiness; remote-only descendants remain explicitly unverifiable.

## Branch-Durable Tool State

Successful tool results may include `details.sf_agentscript_branch_state`, an array of small pointer events. The extension reconstructs those events from the current Pi branch so follow-on calls can safely infer the current `.agent` file, active preview session, eval spec/run, or lifecycle version.

Branch state stores only lightweight pointers such as file paths, session ids, run ids, plan ids, and readiness summaries. Heavy evidence remains on disk:

- preview traces/transcripts and compact per-turn reports under `.sfdx/agents/**`
- eval Run manifests, source/executed snapshots, status, raw responses, failures, and synthesized traces under `.pi/state/sf-agentscript/**`
- optional review reports at the caller-provided `output_path`

Auto-resolution validates referenced disk artifacts before use and proceeds only when exactly one candidate exists.

## Native quality analysis

`agentscript_authoring { "verb": "inspect", "mode": "quality" }` runs the global enabled 20-rule quality catalog for one `.agent` file. It returns High/Moderate/Low/Info findings, exact rule coverage, suppression evidence, and report-only per-procedure cyclomatic complexity. The same result is composed into review and local-file publication preflight. Collapsed quality cards show every finding header by default; expansion adds messages, suggestions, and evidence.

Quality settings are global-only. **SF Pi Manager → SF Agent Script → Settings → Quality Rules** shows one On/Off row per rule. All v1 rules default On; future experimental rules default Off. Disabled rules do not execute, report findings, steer repair, compute metrics, or gate publication.

Human and LLM output use separate channels. Deferred results persist as theme-aware, expandable quality cards through `appendEntry`; those cards never enter LLM context. New High/Moderate signatures send a hidden `sf-agentscript-quality-repair` custom message containing compact JSON, while clean, Low, Info, and metric-only results remain human-only. Cards distinguish passed, issues, repairing, fixed, stopped, partial, failed, and publication-blocked states.

High findings pause publication without changing compile validity and render as a blocked quality card. After reviewing the evidence, the user can retry with `acknowledge_quality_risk=true`; the approval applies only to that bundle, current session, and reviewed High rule IDs. High and Moderate findings are explicitly recommended for resolution before activation; successful inactive publication retains a compact advisory when recommendations remain.

See [`QUALITY_RULES.md`](./QUALITY_RULES.md) for the stable catalog and lifecycle contract.

## Deterministic review

`agentscript_authoring { "verb": "inspect", "mode": "review" }` runs a deterministic v1 readiness review. It reports:

- compile blockers and warnings
- native quality findings and coverage
- structural/readiness findings that can be proven from the parsed file
- publish-risk signals from the feature profile, including non-blocking warnings when locally compile-valid `runtime`, `file_upload`, or experimental `collect` behavior may be ahead of the target org's server compiler
- read-only action-target checks when `target_org` is provided
- read-only surface readiness checks, such as Agentforce settings, phone number, voice/messaging channel, ServiceChannel, published voice planner, routing-flow, and fallback-queue probes for channel-linked agents when `target_org` is provided
- Service Agent user readiness checks for `access.default_agent_user` license/user/system permission-set wiring when `target_org` is provided

Readiness values are `ready`, `ready_with_warnings`, `blocked`, and `partial`. There is no numeric score and no hidden model call. Pass `output_path` to write a Markdown report.

Use `agentscript_authoring { "verb": "inspect", "mode": "runtime_smoke", "target_org": "..." }` after a test call or message to query recent VoiceCall, AgentWork, and MessagingSession records and get a read-only runtime diagnosis.

## Preview Trace Reports

`agentscript_preview action="send"` separates human readability from model context efficiency:

- The TUI/report surface renders a rich Preview Trace Report with turn summary, the complete parsed LLM response sequence, route path, state changes, key state snapshot, tool activity, connected-agent invocations, action I/O appendix, aligned planner timeline, diagnostics, stats, and drill pointers. Ending a multi-turn Preview session renders a bounded full-session Conversation Replay with every user/agent utterance, per-turn path, latency, and response-integrity proof.
- Response-sequence rows distinguish tool-only, empty, malformed, intermediate candidate content, and content matching the final planner response. Multiple non-empty completions are an explicit human advisory; preview does not claim that candidate text was definitely streamed by a voice surface.
- The LLM-facing text remains compact: a response, short summary, counts, and pointers. Structured details live in `details.digest`; raw prompts, full state, and full action payloads stay in persisted trace artifacts.
- Internal planner variable spam is hidden from the human timeline by default, while user-visible state changes show previous → new previews when available.
- Action input/output previews are screenshot-friendly and bounded/redacted; use `agentscript_preview trace` with the returned `plan_id` for the full raw trace.

## Agent Script Eval Studio

`/sf-agentscript evals` opens the local-first **Agent Script Eval Studio**. It inventories `tests/agentforce/<AgentApiName>.eval.json`, additional `<AgentApiName>.<suite-slug>.eval.json` Suites, generated baselines, and persisted Run evidence without contacting Salesforce. The responsive overlay drills through Agent → Suite → Scenario → Turn/Evaluator evidence, preserves source order, distinguishes execution state from evidence verdict, and keeps stale source as an independent fact.

Studio supports reviewed Suite and diagnostic Scenario Runs, exact historical reruns, explicit cancellation, Release Contract execution, Markdown reports, copy/open artifact actions, and compact conversational authoring handoffs. The Conversation view shows per-turn LLM call, non-empty candidate, and integrity counts; the selected turn expands every parsed completion. New runs read this from `transcript.jsonl`, while detailed legacy-run reads reconstruct it from `raw.json` when possible. The Run Target always reviews the run-local org, Agent API name, exact version policy/result, trace mode, concurrency, and optional Scenario seed overrides. Closing the overlay does not cancel a Run; one Studio-owned Run may execute per project while direct `agentscript_eval run` and `/sf-agentscript eval <spec>` remain independent power-user paths.

EvalSpec JSON remains the only source-controlled format. Source is read-only in the Studio; New/Edit/Diagnose actions close the overlay and prefill Pi's editor with an authoring brief. General file watching, direct JSON editing, inferred Agent coverage, automated Preview replay, Run deletion, and retention management are not part of the MVP.

### Dynamic org seed profiles

A Suite can resolve scenario context from the eval target org at run preflight without hardcoding Salesforce record IDs. Define a read-only `seed_profiles` entry, reference it from a Scenario with `seed_profile`, and map the profile's single SOQL row into ordinary `context_variables`:

```json
{
  "seed_profiles": {
    "open_case": {
      "soql": "SELECT Id, AccountId FROM Case WHERE Status = 'New' ORDER BY CreatedDate DESC LIMIT 1",
      "context_variables": [
        { "name": "case_id", "type": "Text", "field": "Id" },
        { "name": "account_id", "type": "Text", "field": "AccountId" },
        { "name": "verified", "type": "Boolean", "value": true }
      ]
    }
  },
  "tests": [
    {
      "id": "case_help",
      "seed_profile": "open_case",
      "steps": [
        { "type": "agent.create_session", "id": "session" },
        { "type": "agent.send_message", "id": "turn1", "utterance": "Help with my case" }
      ]
    }
  ]
}
```

Seed v1 permits one bounded REST SOQL query and one scalar result row per profile. The resolver rejects unsafe query features, zero or ambiguous rows, null/missing fields, type mismatches, duplicate IDs, and unknown profiles before creating a Run or calling the Evaluation API. Reused profiles query once per Run. Explicit one-run Studio overrides win over profile values.

For release baselines, the designated Suite can provide `generated_baseline.default_seed_profile`, exact test-id `overrides`, and `skip_tests` for generated one-turn probes replaced by designated multi-turn coverage. `run_release` copies only the referenced profiles and assignments into the regenerated baseline and still pins both baseline and designated runs to the same exact BotVersion.

Org-derived values are masked on Studio/source-preview surfaces. Exact resolved values remain confined to the restricted executed/raw Run artifacts and the Evaluation API request.

## Eval Run Hardening

After local normalization/projectability (Studio only), target resolution, and org identity preflight succeed, `agentscript_eval action="run"` creates an immutable `manifest.json`, `spec.source.snapshot.json`, `spec.executed.snapshot.json`, and lightweight atomic `status.json` before the first Evaluation API batch. Failed preflight creates no historical Run. Terminal persistence adds `evidence.json`, metadata, raw response, transcript/failure artifacts, and only then marks status Completed. Status records pointer-sized lifecycle/progress facts and never contains raw eval responses, prompts, traces, transcripts, or failure payloads.

Eval batches keep the compatibility default timeout of 300 seconds, but callers can pass `batch_timeout_ms` for shorter local runs. Client-side request timeouts are terminal for a batch instead of being retried three times. Non-2xx batch responses are persisted in `batch-failures.json`, make the run fail, and can never produce a green zero-result run.

Generated specs compile an internal stateful scenario model into the existing Evaluation API step graph. `include_multi_turn_tests` defaults to true. Multi-turn scenarios are generated only from statically provable `after_response` state updates and simple source branches; unsupported dynamic behavior is reported in `skipped_multi_turn` instead of guessed. This uses a real shared Evaluation API session rather than synthetic conversation-history injection. Salesforce documents conversation history as contextual input for Testing API test cases, but that is a different proof boundary: [Build Tests in Metadata API](https://developer.salesforce.com/docs/ai/agentforce/guide/testing-api-build-tests.html).

Eval-created sessions usually disappear before the live planner trace endpoint can read them, so eval runs synthesize trace artifacts from inline Evaluation API data by default; use `agentscript_eval action="trace"` for explicit live trace drill-down when the session is known to be resident. The Evaluation API does not expose `RelatedAgentStep`, so eval digests report connected-agent call evidence as unavailable rather than zero or inferred; preview remains authoritative for direct invocation counts.

For each paired `agent.send_message` and `agent.get_state`, `transcript.jsonl`, failure records, and synthesized traces retain a parsed `response_sequence` built from every `lastExecution.llmEvents` entry. The sequence stores response content, tool names, ordering, timing, and final-response matching without duplicating full prompt bodies. Salesforce can mirror one system-safety generation under both the router and resolved safety-topic labels; strict aliases with identical raw prompt/response, usage-bearing response payload, start time, and end time within 1 ms remain visible as raw events but count once as a physical completion. Reports distinguish raw events, physical calls/completions, and mirrored aliases. Content equality alone never deduplicates sequential events. A turn without `get_state` evidence is recorded as `unavailable`, never as a passing zero-event turn. `raw.json` remains the authoritative unmodified API payload.

Eval run results aggregate this evidence as a human-facing LLM Response Integrity summary, including pass, warning, unavailable, and exact repeated-surface turn counts. Eval run completion renders a Conversation Replay: every bounded user/agent utterance, per-turn agent path, latency, and response-integrity proof; collapsed cards summarize scenarios and expansion shows the complete replay. Failure cards still render the full response sequence for each failed turn. Without a suite policy integrity remains advisory.

Suites can opt into a deterministic release gate:

```json
{
  "sf_pi": {
    "turn_response_integrity": {
      "max_nonempty_llm_contents": 1,
      "severity": "error"
    }
  }
}
```

`warning` records advisory evidence without changing the run verdict. `error` makes excess non-empty completions or exact repeated surface sentences fail evidence and missing response-sequence evidence incomplete. Strict policy requires exactly one `agent.get_state` after every `agent.send_message`; invalid suites fail local preflight before org calls or Run creation. Generated Voice suites now include this strict policy automatically, and exact-version Voice release contracts refuse a designated Suite that omits it. The policy remains source-only, is preserved in snapshots and release digests, and is never sent as an Evaluation API step. See [ADR 0099](../../docs/adr/0099-agentscript-turn-response-integrity-policy.md).

## Eval-Gated Release Sequence

`agentscript_lifecycle action="publish"` always creates an inactive BotVersion. `agentscript_eval action="run_release"` generates the current baseline from `agent_file`, runs it against the exact latest inactive version, and then runs `tests/agentforce/<AgentApiName>.eval.json` when present or an explicit `release_spec_path`. Complete passing metadata records the org id, BotVersion id, baseline identity, and spec digest.

`agentscript_lifecycle action="activate"` resolves the exact target version and checks persisted release-contract evidence. Missing, incomplete, failed, wrong-org, wrong-version, stale-baseline, or stale-designated-suite evidence blocks activation with a recoverable `run_release` call. `acknowledge_untested_activation=true` requests an emergency path but is only an intent flag; SF Guardrail uses a distinct Safety Envelope and human approval before execution.

Release evidence has no arbitrary time expiry. It remains valid while the exact org, BotVersion, baseline identity, and designated-suite digest remain unchanged. Activation uses an atomic exact-identity release-evidence index and validates terminal status, immutable snapshots, raw evidence, and both recorded/current strict verdicts before accepting an entry. A complete current-schema manifest scan rebuilds the release index when needed; the rolling recent-Run index is display convenience, never release authority.

## Runtime Flow

```text
create/compile/inspect/mutate → preview → publish inactive → run_release → activate
        ▲                         │             │             │
        └──────── branch-state + persisted exact-version evidence ────────┘
```

## Behavior Matrix

| Trigger                                 | Result                                                                 |
| --------------------------------------- | ---------------------------------------------------------------------- |
| `session_start`                         | Reset assist state and shared Salesforce connections once per session. |
| `session_shutdown`                      | Stop runs and clear Agent Script-specific caches/state.                |
| `tool_result` after `.agent` write/edit | Run compile-on-save diagnostics and enabled edit-time High hardening.  |
| `agent_settled`                         | Run enabled global quality rules for changed `.agent` files.           |
| `agentscript_authoring`                 | Create, compile, inspect quality/review, and mutate local source.      |
| `agentscript_preview`                   | Start/send/end preview sessions and persist traces/transcripts.        |
| `agentscript_eval`                      | Generate/run regression specs and exact-version release contracts.     |
| `agentscript_lifecycle`                 | Publish inactive, gate activation, list versions, and manage users.    |

## Settings

SF Agent Script has a Manager Settings page for low-risk tool defaults stored under `sfPi.agentScript`:

- **Preview mock mode** (`previewMockMode`) — default for `agentscript_preview` `start` when `mock_mode` is omitted: `Mock` or `Live Test`.
- **Eval trace mode** (`evalTracesMode`) — default for `agentscript_eval` `run` when `traces_mode` is omitted: `failed`, `all`, or `off`.
- **Eval concurrency** (`evalConcurrency`) — default concurrency for `agentscript_eval` `run` when omitted: `4`, `8`, or `16`.
- **Quality auto-run** (`quality.autoRun`) — global toggle for the deferred post-agent quality pass.
- **Quality rules** (`quality.rules.<rule-id>`) — sparse global per-rule overrides. All 20 stable v1 rules default On.

Quality controls are global-only; project settings cannot weaken or strengthen them. Changes are read dynamically and require no reload. Explicit tool parameters still win for a single call.

## Slash commands

```text
/sf-agentscript                   Open SF Agent Script in the SF Pi Manager
/sf-agentscript doctor            SDK + @salesforce/core + .sfdx/agents writability
/sf-agentscript check <file>      Manually compile a `.agent` file
/sf-agentscript evals             Open the local-first Agent Script Eval Studio
/sf-agentscript eval <spec.json>  Run a multi-turn regression suite directly
/sf-agentscript help              Show command usage
```

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-agentscript/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## AgentScript Package Updates

Check current, resolved, and npm-latest official AgentScript package versions, plus missing or duplicate foundational versions, with:

```bash
npm run agentscript:versions
```

Refresh direct AgentScript dependencies intentionally with `npm install --save-exact`; `@sf-agentscript/compiler` remains transitive through `@sf-agentscript/agentforce` unless SF Pi imports it directly.

The former npm override canary is retired because the pinned official packages now converge naturally. The version command verifies one effective compiler, dialect, parser, language, LSP, and types graph. See [`ADR 0053`](../../docs/adr/0053-agentscript-language-override-canary.md).

## Testing Strategy

Targeted extension suite:

```bash
npm test -- extensions/sf-agentscript/tests
```

Full repo validation:

```bash
npm run validate
```

## Authentication

Ordinary target-org identity, authentication, latest/configured-fallback API selection, REST, and SOQL come from the shared Salesforce Connection Module using the same auth files the Salesforce CLI writes. Timeout-sensitive Agent Script calls use the Module's bounded transport when a shared session exists. Product-specific SFAP, Evaluation, and Agent API adapters remain local; the Agent API bootstrap creates an isolated named-user JWT connection, copies the shared session's selected API version, and never mutates the normal org token. Tokens stay in process and are never logged or persisted.

## Troubleshooting

- **Agent Script SDK unavailable:** run `/sf-agentscript doctor` to inspect the official SDK package resolution.
- **Preview server compile rejects locally valid syntax:** the installed local compiler can recognize newer Agent Script features before the target org's server compiler rollout accepts them. Run `inspect/structure` to review source-based compatibility risks; currently `config.runtime`, `config.file_upload`, and experimental `collect` require live target-org validation.
- **Preview session not found:** confirm `target_org` matches the org used at preview start, or start a fresh preview session.
- **Eval run appears stuck:** inspect `.pi/state/sf-agentscript/runs/<run_id>/status.json` for the current phase. Pass `batch_timeout_ms` for shorter local probes.
- **Eval trace fetch returns null:** eval-created sessions may be closed by the service before live trace fetch succeeds; synthesized traces and failure records remain in the run directory.
- **Service Agent publish/activation fails:** run `agentscript_lifecycle action="diagnose_agent_user"`, then `provision_agent_user` in dry-run mode before executing changes.
- **Deactivation says the agent is in use by other agents:** deactivate dependent parent agents first, confirm their versions are Inactive, then retry after activation status propagation completes.
- **Service Agent provisioning appears stuck:** the live provisioner deploys a synthesized Permission Set through Metadata API. That deploy is bounded by sf-pi timeouts and should return a timeout diagnostic instead of inheriting SDR's 60-minute default poll window.
