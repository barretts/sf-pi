---
id: "0098"
status: accepted
date: 2026-08-03
---

# Agent Script Eval Uses Bounded SOQL Seed Profiles

## Context

Stateful Agent Script scenarios often require target-org record IDs and prerequisite context. Hardcoded IDs drift, while unseeded generated tests can exercise authentication gates instead of the intended business path. SF Agent Script already supports literal `context_variables`, immutable source/executed Run snapshots, Studio one-run seed overrides, and one EvalSpec JSON source format.

Adding a fixture registry, second source file, live-data picker, setup scripts, or arbitrary query language would duplicate those seams and increase release complexity.

## Decision

EvalSpec JSON gains optional source-only `seed_profiles`, one optional `seed_profile` reference per Scenario, and optional `generated_baseline` default/exact-test assignments.

Each profile executes one bounded read-only REST SOQL query against the same org selected for eval execution, requires exactly one row, and maps scalar fields or literal constants into ordinary `context_variables`. Reused profiles execute once per Run. Explicit one-run overrides take precedence.

Resolution occurs in shared eval preflight before Run artifacts or Evaluation API calls, so direct runs, Studio Suite/Scenario runs, and release runs share one behavior. Source-only declarations are stripped from the executed wire spec. The unresolved source snapshot/digest remains stable; the executed snapshot/digest records exactly what ran.

Seed v1 rejects unsafe query features, zero or multiple rows, missing/null fields, type mismatches, duplicate Scenario/step/binding IDs, and unknown profiles. It has no fallback IDs or skip-on-empty behavior.

All org-derived values are sensitive by provenance. Human-facing Studio previews mask context-variable values; restricted executed/raw artifacts retain exact values for evidence.

`run_release` reads the designated EvalSpec once before baseline generation and copies only referenced seed profiles plus generated-baseline default/override assignments into the read-only baseline. Exact `skip_tests` entries can omit generated one-turn probes only when the designated suite owns the stateful coverage. Both baseline and designated runs remain pinned to the same exact pending BotVersion.

Generated action probes are limited to top-level zero-input actions and assert `lastExecution.invokedActions`; inline or input-requiring actions are skipped for designated multi-turn coverage rather than having prerequisite behavior invented.

## Consequences

- Projects can keep reusable, dynamic test selectors in the same EvalSpec JSON as their scenarios.
- Different scenarios can resolve different records without hardcoded Salesforce IDs.
- Release evidence retains stable source identity plus exact executed identity.
- Missing or ambiguous fixture data blocks before a Run exists.
- The first version intentionally supports one query and one row per profile.

## Non-goals

- No second eval format, sidecar registry, profile inheritance, profile composition, query chaining, multi-query profile, or multi-row fan-out.
- No data picker, query builder, row preview, or org-data browser.
- No DML, fixture creation, cleanup, queryAll, SOSL, Tooling API, or cross-org seed source.
- No runtime/model/environment interpolation in SOQL.
- No persisted cross-Run cache or activation-time requery.
