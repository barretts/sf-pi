# Legacy Data 360 Facade Coverage

This document describes retained compatibility infrastructure. It is **not** current agent operating guidance and the legacy `d360` tool names are not registered as the public runtime surface.

## Current authority

- `registry/operations.json` — retained legacy operation registry used by compatibility adapters and tests.
- `registry/upstream-parity.json` — generated operation-level parity evidence.
- [`upstream-parity.md`](./upstream-parity.md) — generated human summary.
- `lib/facade-tool.ts` — compatibility execution and legacy destructive-operation restrictions.
- `lib/v2/dispatcher.ts` — current v2 adapters that may delegate selected actions to retained facade behavior.

Current agents use the owning `data360_*` family and v2 action from `registry/v2/actions.json`. They discover actions with `actions.search` and `action.describe`, then use plan or `dry_run: true` before confirmed execution.

## Compatibility safety contract

The retained facade classifies operations as `read`, `safe_post`, `confirmed`, or `destructive`.

- Confirmed and destructive execution requires reviewed dry-run intent.
- Destructive compatibility paths retain an additional dedicated non-production test-org restriction in code.
- SF Guardrail remains the approval authority for high-value native tool mutations.
- Headless execution fails closed unless the operator configures the Guardrail process outside the model call.
- Tests and examples use generic placeholders; this document does not publish an environment-specific alias.

Do not copy the facade’s dedicated test restriction into new v2 actions. New public behavior must use target-org facts, current safety classification, and Guardrail mediation through the v2 dispatcher.

## Retirement condition

The active [`../../ROADMAP.md`](../../ROADMAP.md) requires the live capability sweep to exercise the public v2 family interface. After equivalent plan, execution, cleanup, and artifact evidence exists, retain the facade only for a named compatibility consumer or delete it with its aliases and this directory.
