# SF Guardrail

## What It Does

A Salesforce-aware safety layer on top of pi's `tool_call` hook. Three rule
families plus one known-surface native-tool registry feed the same Safety Kernel,
HITL, headless fail-closed, session approval, and audit path. Rule families are
controlled by per-rule behavior (`off`, `confirm`, or `block`):

1. **policies** — file-protection rules with three levels:
   - `noAccess` blocks `read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`
   - `readOnly` blocks `write`, `edit`
   - `none` is an explicit no-op (useful for disabling a bundled rule
     without removing it — override the `id` with `protection: "none"`)

   Ships with bundled rules for `destructiveChanges*.xml`, `.forceignore`,
   `.sf/**`, `.sfdx/**` (with a `.sfdx/agents/**` carve-out for sf-agentscript
   preview sessions — the Salesforce-standard agent session layout), and
   dotenv-style secret files.

2. **commandGate** — dangerous-command patterns matched structurally
   against tokenized shell commands from `bash.command` or
   `herdr_pane.run.command`, including commands later in simple shell chains.
   Ships with recursive deletion variants, permission/ownership changes,
   destructive git commands, pipe-to-shell and base64-to-shell patterns,
   process/system disruption commands, container/cloud/database destruction
   commands, Salesforce CLI project/package/plugin/org/agent destructive
   operations, explicit Salesforce CLI credential reveal commands, Pi
   credential-output commands (`pi auth check --credentials`, `pi auth print-api-key`, and
   `pi auth print-bearer-token`), and `SF_TEMP_SHOW_SECRETS=true`.
   Strictly validated OS temp-directory cleanup is auto-allowed and audited;
   other dangerous commands default to `confirm` behavior and prompt via
   `ctx.ui.select` (Allow once / Allow for this session / Block). Individual
   rules can be set to `off`, `confirm`, or `hard block` in settings.

3. **orgAwareGate** — shell-command rules that fire only when the resolved
   target-org type matches. Explicit non-default target aliases get a bounded,
   cached, in-process org lookup before a guessed-production prompt; lookup
   failure still fails closed. Ships with production-only rules for metadata,
   data, package, and Agentforce mutations:
   - `sf project deploy start | resume | quick` (recognized validate,
     preview, report, check-only, and dry-run rehearsals are allowed)
   - `sf apex run`
   - `sf data delete | update | upsert | import`
   - `sf org api --method DELETE | PATCH | PUT`
   - `sf data create record | file`
   - `sf package install`
   - `sf agent activate | deactivate`
   - `sf agent publish authoring-bundle`

4. **nativeToolGate** — a Guardrail-owned registry for known high-value durable
   mutations exposed through bundled SF Pi native tools. The first slices cover
   AgentScript lifecycle publish/activation/provisioning, Data 360 confirmed
   execution paths, SOQL artifact export / broad reads, `sf_apex anon.run`,
   `slack_canvas create/edit`, and SF Browser committing click/press gestures.
   Browser click mediation can use the latest snapshot label for refs such as
   Save/Delete/Activate even when the model omits `mutation=true`. Tool intent flags such as `allow_mutation`, `mutation`,
   and `dry_run=false` classify intent; they are not approval.

Plus:

- **Rule-derived guidance** — once-per-session sf-brain-style kernel telling
  the LLM which rules are active and which rehearsal patterns to prefer
  (`deploy validate`, `--check-only`, `Savepoint` + `rollback`).
- **Session allow-memory** — "Allow for this session" persists via
  `pi.appendEntry` so `/resume` and `/fork` inherit the allowance. Org-aware
  allows use a safety envelope (rule + resolved org + command family) instead
  of an exact command string where that reduces repeat prompts safely.
- **Session-scoped approvals** — confirm prompts keep three choices; the
  middle choice allows the same Safety Envelope for the current session path.
  Session approvals are auditable and can be cleared with `/sf-guardrail forget`.
- **Audit trail** — every decision (auto-allow, allow, session allow, block,
  timeout, cancel, headless-pass) is persisted as a session entry. Inspect with
  `/sf-guardrail audit`.
- **Headless mode** — fail-closed by default; set
  `SF_GUARDRAIL_ALLOW_HEADLESS=1` to let gated calls through with an
  audit warning when there is no TUI.
- **Power Tool Mode** — persisted advanced-user setting for auto-approving
  confirm-class decisions. It supports Native tools only or All confirm-class
  decisions, per-native-family selection, and a separate production/unknown-org
  opt-in. It is off by default, visible in `/sf-guardrail` and Manager settings,
  audited on every auto-approval, and never bypasses hard blocks.
- **Operator auto-approve env mode** — process-scoped override. Set
  `SF_GUARDRAIL_OPERATOR_AUTO_APPROVE=allow-confirm-actions-for-this-process`
  to auto-allow confirm-class decisions with audit. Hard blocks still apply.

## Config Layers

Bundled defaults live in `SF_GUARDRAIL_DEFAULTS.json` next to `index.ts`.
Routine Guardrail Preferences live in Pi's global settings file under
`sfPi.guardrail` (typically `~/.pi/agent/settings.json`). These cover
confirmation timeout, protected org aliases, and bundled-rule behavior (`off`,
`confirm`, or `block`).

Advanced rule overrides remain in `<globalAgentDir>/sf-guardrail/rules.json`
(typically `~/.pi/agent/sf-guardrail/rules.json`). Use that file only for
custom patterns or full bundled-rule replacement by stable rule `id`.

Effective config is resolved in this order: bundled defaults, advanced override
JSON, then Pi settings for routine preferences. Project-local Guardrail
weakening remains deferred by ADR 0041 and ADR 0049.

## Commands

- `/sf-guardrail` → open `SF Pi › SF Guardrail` in the Manager Surface when UI is available; status summary in no-UI mode
- `/sf-guardrail list` → full dump of active rules
- `/sf-guardrail audit` → up to 50 recent decisions from the session
- `/sf-guardrail grants` → list legacy persisted approval grants, if any
- `/sf-guardrail settings` → compatibility help that points to `/sf-pi` →
  SF Guardrail → Settings, where routine preferences are edited in focused
  nested pages
- `/sf-guardrail aliases` → edit aliases that should receive production-level
  guardrail prompts; saved to Pi settings. From the Manager detail page this
  opens an in-Manager native input page; direct command usage keeps the compact
  prompt flow.
- `/sf-guardrail forget` → revoke session allow-memory for this branch and clear
  legacy persisted approval grants for the current project. From the Manager
  detail page this uses an in-page confirmation before mutating state.

## Architecture References

SF Guardrail is intentionally a **Safety Mediator**, not a general policy
engine. Canonical terms live in `CONTEXT.md`, and stable trade-offs are recorded
in repo ADRs, especially:

- ADR 0004 — fail-closed guardrail behavior
- ADR 0033 — safety mediator posture
- ADR 0034 — Safety Envelope approvals
- ADR 0035 — Safety Kernel seam
- ADR 0036 — Approval Ledger seam
- ADR 0037 — rule-derived guidance
- ADR 0038 — pi-native preferences with advanced rule overrides
- ADR 0039 — no LLM tools
- ADR 0040 — workflow rehearsals stay advisory
- ADR 0041 — project-local overrides are deferred
- ADR 0042 — session-scoped approval envelopes
- ADR 0043 — detected Salesforce org type is the classification source
- ADR 0044 — Power Tool mode defaults to confirmable actions (superseded by ADR 0052)
- ADR 0046 — per-rule behavior is `off`, `confirm`, or `hard block`
- ADR 0047 — settings use a section chooser (superseded by ADR 0049)
- ADR 0049 — routine preferences live in Pi settings and the Manager Surface
- ADR 0050 — configurable extension settings use Manager Surface drill-in
- ADR 0051 — extension commands deep-link to the Manager Surface
- ADR 0052 — rule behavior is the only safety model
- ADR 0074 — native high-value durable mutation mediation

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-guardrail/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
  SF_GUARDRAIL_DEFAULTS.json  ← bundled Guardrail rule defaults
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

**All production confirms are firing on my sandbox:**

- Run `/sf-guardrail audit` first. Recent entries include whether the org
  type was resolved from cache, lookup, `productionAliases`, or guessed. If the
  entry is guessed, run `sf org display -o <alias> --json` and confirm the org
  is authenticated and reports a non-production type. If the alias still cannot
  be resolved, run `/sf-devbar refresh` or restart pi. Protected org aliases are
  for aliases that should receive production-level prompts; do not add ordinary
  sandbox/scratch aliases there.

**I cannot write to `destructiveChanges.xml` even though my rule is supposed to be off:**

- Override by id: add the rule with `"enabled": false` to
  `~/.pi/agent/sf-guardrail/rules.json`. Removing the entry from your
  override file is not enough — the bundled rule is still merged in
  unless you explicitly disable it.

**Headless CI fails with "Blocked by sf-guardrail in headless mode":**

- Set `SF_GUARDRAIL_ALLOW_HEADLESS=1` in the CI env. This logs a
  headless_pass audit entry but lets the call through. Prefer a CI
  role/alias that is not marked `production` as a first step.

**`/sf-guardrail audit` is empty after /resume:**

- Decisions are scoped to the session file. `/resume` into a different
  session file will show that file's history. Use `/sf-guardrail`
  (default view) to see the current session's summary.
