# Agent Script Upstream Adoption and Simplification Plan

Status: complete; Milestones 0–5 are merged; Milestone 6 is implemented, independently reviewed, and validated on 2026-08-03

## Goal

Simplify `sf-agentscript` by making the released `@sf-agentscript/*` packages the authoritative source for Agent Script language semantics while preserving every valuable SF Pi workflow, safety, human-facing, and model-facing capability.

The initiative is deletion-led. Success is measured by preserved public behavior, removal of duplicate semantic implementations and textual fallbacks, fewer repeated parses and control-flow branches, stable tool schemas and evidence, coherent upstream packages, and green focused/full validation. Source-line reduction is secondary evidence rather than a target.

## Decision sources

- `CONTEXT.md`
- `docs/adr/0013-agentscript-branch-durable-tool-state.md`
- `docs/adr/0014-agent-script-four-family-tool-surface.md`
- `docs/adr/0028-official-agentscript-packages.md`
- `docs/adr/0029-minimal-structured-agent-script-mutation.md`
- `docs/adr/0053-agentscript-language-override-canary.md`
- `docs/adr/0058-agentscript-bounded-salesforce-transport.md`
- `docs/adr/0086-behavior-proof-ladder.md`
- `docs/adr/0090-agentscript-stateful-eval-scenarios.md`
- `docs/adr/0091-agentscript-native-quality-analysis.md`
- `docs/adr/0094-agent-script-eval-gated-activation.md`
- `docs/adr/0097-agent-script-eval-studio-local-first-workspace.md`
- `docs/adr/0098-agentscript-eval-soql-seed-profiles.md`

## Locked authority contract

### Official package ownership

Official `@sf-agentscript/*` packages own:

- parsing and canonical Agent Script AST construction;
- local compilation, AgentJSON serialization, ranges, and the upstream mutable document;
- dialect/schema diagnostics and generic language semantics;
- symbol tables, scope/reference resolution, definitions, references, semantic rename, and generic code actions;
- AST walkers, lint infrastructure, and expression type inference.

SF Pi owns:

- the four public family-tool interfaces and their workflow ordering;
- stable model-facing structural projections rather than raw compiler AST;
- Salesforce Agent API preview, Evaluation API, BotVersion lifecycle, server compile, org readiness, and Service Agent user provisioning;
- quality presentation/policy where it remains useful, exact-version release evidence, Guardrail handoff, artifact persistence, branch state, bounded transport, redaction, and human/LLM rendering.

This is a consumer-only initiative. It adopts released public packages and does not create upstream issues or pull requests. A missing upstream interface or diagnostic remains behind the smallest local Adapter until a future released version proves parity.

### Deletion threshold

A local implementation is deleted only after a **Behavior Proof** through the public SF Pi seam establishes equivalent behavior, except for an explicitly approved bug correction. A milestone does not retain old and new production paths as a long-lived fallback.

### Structured rename

A reference-safe rename changes declarations and semantic references only. It never performs whole-source token replacement across comments, strings, prompt text, or template prose.

Same-namespace rename delegates to the official LSP rename provider. A namespace-changing migration such as `topic` to `subagent` is a distinct internal conversion operation even when the public `rename` mode routes to it. Topic-to-subagent conversion delegates to the official code action; reverse conversion remains narrowly local until an equivalent released interface exists or the feature is separately retired.

Mutation file-queue, dry-run, diff, collision, post-emit verification, and no-new-severity-1 guards remain. An individual guard is removed only after a pinned upstream regression fixture and public mutation Behavior Proof pass.

### Agent Script Dual Upstream Analysis

For one source identity, the analysis Module lazily retains both official results:

```text
Agent Script Dual Upstream Analysis
├── compileSource result
│   ├── AgentJSON output
│   ├── source ranges
│   ├── compiler document
│   └── compiler diagnostics
└── processDocument result
    ├── LSP DocumentState
    ├── dialect/version diagnostics
    ├── symbol and position indexes
    └── definitions, references, rename, and code actions
```

Diagnostics form one deterministic union:

- identity key: code + source range + message;
- duplicates appear once;
- diagnostics unique to either official result remain present;
- any severity-1 diagnostic blocks **Agent Script Compile Validity**;
- detailed diagnostics sort by source position, then severity/code;
- compact summaries continue to prioritize severity;
- no user-facing pipeline-divergence status or report exists;
- neither official result is declared the winner.

Downstream structure, hardening, quality, and feature projections consume the cached official AST/document facts rather than launching additional parse pipelines. The target is at most the two official package pipelines per immutable source identity, not one local parser plus multiple independent projections.

### Quality handoff

When an official diagnostic proves strict parity for an SF Pi quality rule’s code, source range, semantic meaning, and actionability:

1. delete the duplicate local evaluator;
2. retain a thin SF Pi policy projection only when existing quality presentation, repair, suppression, or publication behavior remains valuable;
3. never compute or display the same semantic finding twice.

The quality engine is not retired wholesale. Each rule requires independent parity evidence.

### AgentFabric graph insight

`@sf-agentscript/agentfabric-dialect` is test-time insight only:

- exact-versioned devDependency;
- included in Agent Script package-coherence/version reporting;
- prohibited from production `extensions/sf-agentscript/lib/**` imports;
- no runtime inspection output;
- no production Agentforce graph authority.

A compatibility spike showed that the current public extractor can enumerate Agentforce nodes but returns no edges for representative deterministic transitions, connected-agent invocations, or planner transitions. The SF Pi **Agent Script Flow Projection** remains authoritative until future released packages prove equivalent Agentforce edge kinds, conditions, and source ranges. No upstream contribution is planned.

### Live validation scope

Use a dedicated disposable fixture in a designated non-production Agentforce org. Allowed Behavior Proof operations:

- server compile;
- inactive publication of the dedicated test fixture;
- preview and eval against the fixture;
- deactivation/cleanup of test artifacts when supported.

Activation is excluded. Any durable org mutation remains subject to SF Guardrail and explicit execution review.

## Non-goals

- No new public Agent Script tool.
- No change to the four family tool names, action/verb schemas, result contracts, or lifecycle ordering.
- No raw AST as a model-facing interface.
- No replacement of target-org server compile with local compile.
- No inference that local lint proves org target existence, permission, channel readiness, or activation readiness.
- No AgentFabric production import or supplemental runtime graph.
- No upstream contribution work.
- No generic workflow framework, repository layer, event bus, dependency container, or family-tool base class.
- No immediate deletion of mutation filesystem-safety guards.
- No implementation without separate approval.

## Behavior-Proof contract

Every behavioral milestone begins with a failing or characterization proof through the public seam it changes and ends with all applicable proof tiers green:

1. pure deterministic contract tests;
2. registered family-tool execution tests;
3. focused `sf-agentscript` tests and TypeScript check;
4. Agent Script package coherence/version check;
5. bounded live proof in the designated non-production org when fixtures cannot prove behavior;
6. full `npm run validate` before a milestone is complete.

A milestone stops if it requires an unapproved public-interface change, loses a current feature, introduces an old/new production fallback, or cannot explain changed artifacts/evidence.

---

## Milestone 0 — Baseline proofs and package sentinel

### Purpose

Create evidence before changing behavior and add bounded test-time upstream insight.

### Work

- Add exact-versioned `@sf-agentscript/agentfabric-dialect` as a devDependency.
- Apply the narrowly approved production lockfile repair for `brace-expansion@5.0.9` when the required production audit identifies GHSA-rgw5-rvv9-x895; do not add a direct package declaration or broaden dependency updates.
- Extend `npm run agentscript:versions` and package-coherence tests to include it and detect duplicated foundational versions.
- Add a source/import contract proving production `extensions/sf-agentscript/lib/**` does not import AgentFabric.
- Add AgentFabric-versus-Agentforce graph characterization fixtures for:
  - unconditional deterministic transition cycle;
  - connected-agent invocation and planner transition;
  - `collect` routing.
- Record the desired semantic rename negative behavior for comments, quoted instructions, template text, and similarly named symbols as an explicit expected-failure proof; Milestone 1 converts it to passing while deleting the textual fallback.
- Characterize current diagnostics, quick fixes, structure, quality, and feature-profile outputs.
- Characterize current parse counts for compile, review, mutation, and publication preflight.
- Characterize timed versus untimed eval batch outputs and persisted artifacts.

### Likely files

- `package.json`
- `package-lock.json`
- `scripts/agentscript-versions.mjs`
- `extensions/sf-agentscript/lib/package-catalog.ts`
- `extensions/sf-agentscript/tests/package-coherence.test.ts`
- new focused AgentFabric parity/import test
- `extensions/sf-agentscript/tests/mutate.test.ts`
- `extensions/sf-agentscript/tests/analysis-snapshot.test.ts`
- `extensions/sf-agentscript/tests/eval-run-boundary.test.ts`

### Exit gate

All baseline proofs are green, with the semantic rename correction reported as one intentional expected failure for Milestone 1. No production code imports AgentFabric and no production Agent Script behavior changes.

---

## Milestone 1 — Semantic rename and conversion delegation

### Purpose

Correct the reference-safe rename contract and delete local textual language semantics.

### Work

- Add a narrow semantic rename Adapter around official `provideRename`.
- Resolve explicit `@namespace.name` input to the official position-based provider.
- Apply the returned WorkspaceEdit through one shared edit application helper.
- Delegate topic-to-subagent migration to the official code action.
- Keep reverse subagent-to-topic conversion as a distinct narrow local operation with its own tests.
- Delete whole-source exact-token scanning, manual declaration line search, reference edit de-duplication, and equivalent local plumbing.
- Retain collision checks, dry run, file queue, post-edit compile, field verification, and no-new-severity-1 protection.

### Behavior Proofs

- Declaration and true references change.
- Comments, quoted instructions, template text, and similarly named symbols do not change.
- Inline actions, variables, subagents, topics, transitions, and scoped references rename correctly.
- Collision, missing symbol, malformed source, dry-run, write, topic conversion, reverse conversion, and mutation queue behavior remain stable.
- Result and branch-state shapes remain unchanged.

### Exit gate

The public `agentscript_authoring mutate.rename` seam is green, textual fallback code is deleted, focused tests and full validation pass.

---

## Milestone 2 — Dual upstream analysis

### Purpose

Adopt both official upstream results as one deep local analysis Interface and remove repeated local parse/compile/navigation pipelines.

### Work

- Extend `AgentScriptAnalysisSnapshot` to lazily cache `compileSource` and `processDocument` results by immutable source identity.
- Apply the narrowly scoped production lockfile repair from `fast-uri@3.1.4` to `3.1.5` when the required audit identifies GHSA-7p8r-x3mc-p8w7; do not add a direct dependency or broaden package updates.
- Introduce deterministic diagnostic normalization, deduplication, and ordering.
- Preserve all severity, code, range, message, tags, and useful diagnostic data.
- Expose compiler output/ranges/document and LSP state/indexes through the private snapshot Interface.
- Route compile/check through the combined diagnostic result.
- Route quick fixes, definition, references, and rename through the cached LSP state.
- Route structural inspection, hardening, quality facts, and feature profiling through cached official AST/document facts.
- Delete duplicate dialect resolution and redundant parse calls.
- Verify and remove obsolete upstream console-log suppression when the pinned package remains silent.
- Replace handwritten upstream result facsimiles and repeated casts with exported official types where practical.
- Retain lazy loading, LRU bounds, file-key invalidation, and cache-first startup.

### Behavior Proofs

- Exact diagnostic identity and position-first detail ordering.
- Severity-first compact summary.
- Unique diagnostics from either result survive composition.
- Any severity-1 diagnostic blocks compile validity.
- Quick fixes and navigation use current source positions.
- Compile output, structure projection, quality findings, metrics, feature profile, and mutation behavior remain equivalent.
- Invalid/partial source retains current partial-result behavior.
- At most two official parse pipelines execute per unchanged source identity during review/publish preflight.
- Designated non-production server compile accepts representative locally valid minimal and rollout-sensitive fixtures.

### Exit gate

All public authoring/review behavior remains green, repeated local parses and duplicate dialect code are deleted, package coherence and full validation pass.

---

## Milestone 3 — Eval orchestration de-duplication

### Purpose

Simplify the Evaluation API transaction without changing its runtime ownership, persisted evidence, or release authority.

### Work

- Extract one `runEvalBatches` implementation for both timed and untimed execution.
- Build the utterance index once and reuse it for synthesized traces and summaries.
- Keep `runEval` as the transaction coordinator for preflight, run-start persistence, cancellation, terminal persistence, and public results.
- Extract `prepareEvalRun` or `buildEvalEvidence` only when doing so removes branches and improves Locality; do not create a phase DSL.
- Preserve timeout, retry, concurrency, progress, cancellation, interruption, trace, and failure semantics.

### Behavior Proofs

- Timed and untimed runs produce equivalent result/status/artifact semantics; only timing evidence differs.
- Success, behavioral failure, missing result, batch HTTP failure, timeout, cancellation, interruption, seed failure, trace mode, persistence failure, and no-persist behavior remain stable.
- Manifest, source/executed snapshots, status, evidence, batch failures, traces, metadata, and release verdict remain byte- or semantic-equivalent as appropriate.
- Failed or incomplete execution never produces passing release evidence.
- Dedicated inactive fixture preview/eval proof passes in the designated non-production org; no activation.

### Exit gate

Duplicated batch/index control flow is deleted, eval/release proofs remain green, and full validation passes.

---

## Milestone 4 — Quality and hardening parity handoffs

### Purpose

Delete local semantic evaluators only where released upstream diagnostics already provide strict parity, while preserving valuable SF Pi workflow policy.

### Work

- Build a parity matrix for every current hardening and quality rule.
- Record upstream code, range, severity, message/actionability, quick-fix data, and relevant execution context.
- For strict-parity rules:
  - delete the local evaluator;
  - map upstream evidence into the existing quality policy only when required;
  - prevent duplicate display and duplicate suppression/repair behavior.
- Retain the smallest local evaluator for rules without strict parity.
- Keep deployment hygiene, org readiness, release evidence, and Salesforce/Pi policy local.
- Do not open upstream issues or pull requests.

### Behavior Proofs

- Every deleted evaluator has strict fixture parity.
- Quality coverage, global rule settings, suppressions, repair payloads/cards, and publication gate behavior remain stable where retained.
- Compiler diagnostics are not displayed as duplicate local findings.
- Disabled rules still disable their policy projection without hiding the underlying official compiler diagnostic.

### Exit gate

Only proven duplicate semantic evaluators are deleted; no quality feature or compile diagnostic is lost; full validation passes.

---

## Milestone 5 — Private action Locality

### Purpose

Deepen the private Implementations behind the already-correct four family-tool Interfaces.

### Target shape

```text
preview/
  actions/
    session.ts       # start, send, end
    maintenance.ts   # end_all, cleanup
    trace.ts         # trace

eval/
  actions/
    run.ts           # run, run_release
    evidence.ts      # get_failure, trace
    generation.ts    # generate_spec, resolve_active

lifecycle/
  actions/
    release.ts       # publish, activate, deactivate, list_versions
    agent-user.ts    # status, diagnose, provision tool-facing actions
```

The existing `preview-tool.ts`, `eval-tool.ts`, and `lifecycle-tool.ts` remain the single tool-registration files and retain public schemas, required-field validation, prompt guidance, rendering, timing, and obvious dispatch.

### Constraints

- Split by responsibility, not one file per switch case.
- No generic family-tool framework.
- No forwarding wrapper that mirrors every action.
- Action modules own meaningful tool-facing behavior and narrowed internal inputs.
- Dependencies point inward to domain modules, never back to registration files.

### Behavior Proofs

- Registered-tool execution preserves every action result, renderer route, progress update, timing line, branch-state event, AbortSignal, and error/recovery hint.
- Strict OpenAI tool schemas remain unchanged.
- Preview, eval, lifecycle, release sequence, quality gate, and agent-user suites remain green.

### Exit gate

Registration Modules are materially smaller and easier to navigate, aggregate branching does not increase, public tool contracts are unchanged, and full validation passes.

---

## Milestone 6 — Internal compatibility cleanup

### Purpose

Remove shallow internal seams and stale terminology after all functional behavior has settled.

### Completed work

- Removed the top-level preflight forwarding shim after migrating callers to the canonical preflight index.
- Removed the preview-only error-map alias after migrating preview to the canonical shared Agent API error map.
- Removed unused active-ID and placeholder compatibility exports plus the unused orchestrator resolver re-export surface.
- Removed private action compatibility re-exports left after Milestone 5 once repository consumers used canonical action Modules.
- Replaced stale vendored-SDK language and deleted obsolete vendor sync/ignore configuration.
- Removed compatibility-only tests and updated implementation-path documentation together with each shim.

### Exit gate

One canonical path remains per concept, no supported interface is removed, focused tests/typecheck/full validation pass, and the working tree contains no accidental generated drift.

## Validation and reporting

Every milestone report must include:

- changed files;
- deleted Implementations and why upstream/local authority now owns the behavior;
- focused Behavior Proof commands and outcomes;
- package coherence/version output when dependencies or upstream seams change;
- full validation outcome;
- live non-production evidence when applicable;
- artifact paths;
- residual risks and deferred decisions;
- public-sanitization review.

## Approval boundary

This plan and its supporting glossary/ADR updates do not authorize implementation by themselves. Milestone 0 was separately approved; Milestone 1 and every later implementation milestone require separate user approval. Durable Salesforce actions remain separately mediated by SF Guardrail.
