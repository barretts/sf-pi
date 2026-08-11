# SF Data 360 Roadmap

The public runtime interface is the `data360_*` v2 family surface backed by the
v2 action registry and dispatcher. The existing E2E capability sweep still
executes the retained legacy `d360` facade and legacy operation names. That
makes the sweep useful as compatibility evidence, but not authoritative proof of
the current public interface.

## Now — align live proof with the v2 public interface

Migrate or replace `scripts/e2e/d360-capability-sweep.ts` so its primary path:

- selects actions from `registry/v2/actions.json` through their owning
  `data360_*` family;
- exercises the same v2 dispatcher, parameter envelope, plan/dry-run gates,
  target-org resolution, rendering, and artifacts used by normal tool calls;
- preserves explicit non-production mutation gates and sweep-owned resource
  cleanup;
- reports registry/action coverage without treating one org's optional features
  or current data state as universal product support;
- leaves no claim that the legacy facade is the live-parity source of truth.

Completion requires focused plan/execution tests plus a bounded non-production
smoke artifact showing at least one read-only and one confirmed v2 lifecycle
through the migrated path. The legacy facade sweep can then be retained only as
an explicitly named compatibility probe or deleted.

## After the alignment

Re-measure lifecycle gaps from the current v2 action registry and observed
non-production evidence. Add a lifecycle only when it has a reusable,
public-safe fixture and deterministic cleanup. Do not carry forward the old
org-specific checklist, opaque server errors, or exact green-count baseline as
roadmap commitments.

## Non-goals

- Making live org state the only correctness signal.
- Mutating pre-existing org resources during a sweep.
- Restoring legacy `d360` tools to the public runtime surface.
- Treating optional or state-gated Data 360 features as universal failures.
