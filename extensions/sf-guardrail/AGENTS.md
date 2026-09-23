# AGENTS.md — sf-guardrail

Agent rules for editing this extension. Read this before any change.
Repo-level rules still apply; see root `AGENTS.md`.

## Read first

1. `extensions/sf-guardrail/CONTEXT.md` — canonical safety language
2. `extensions/sf-guardrail/index.ts` — event wiring
3. `extensions/sf-guardrail/lib/types.ts` — schema boundary
4. The specific `lib/*.ts` module you're editing
5. The matching focused test

## File map (what lives where)

One-file-per-concern split:

| Responsibility                       | File                                                |
| ------------------------------------ | --------------------------------------------------- |
| Event wiring + command handler       | `index.ts`                                          |
| Schema + persisted entry types       | `lib/types.ts`                                      |
| Safety decision seam                 | `lib/safety-kernel.ts`                              |
| OpenRouter Decisions transport       | `lib/jev-client.ts`                                 |
| Jev metadata and local facts         | `lib/jev-metadata.ts` + `lib/jev-facts.ts`          |
| Jev request and decision adapter     | `lib/jev-risk.ts`                                   |
| Jev exact-call identity              | `lib/jev-identity.ts`                               |
| Safety subject normalization         | `lib/safety-subject.ts`                             |
| Safety envelope construction         | `lib/safety-envelope.ts`                            |
| Rule behavior resolution             | `lib/rule-behavior.ts`                              |
| Bundled + override config loader     | `lib/config.ts`                                     |
| Shell tokenizer + AST matcher        | `lib/bash-ast.ts`                                   |
| File-policy risk gate                | `lib/file-policy-gate.ts`                           |
| File-path policy matcher             | `lib/policies.ts`                                   |
| Command risk gate                    | `lib/command-risk-gate.ts`                          |
| Dangerous-command matcher            | `lib/command-gate.ts`                               |
| Target-org resolution                | `lib/org-context.ts`                                |
| Org-aware risk gate                  | `lib/org-aware-risk-gate.ts`                        |
| Production-only rule matcher         | `lib/org-aware-gate.ts`                             |
| Confirmation dialog wrapper          | `lib/hitl.ts`                                       |
| Approval dialog detail formatter     | `lib/approval-detail.ts`                            |
| Approval memory seam                 | `lib/approval-ledger.ts`                            |
| Safety Envelope fingerprints         | `lib/fingerprint.ts`                                |
| Manager-backed Guardrail Preferences | `lib/config-panel.ts` + `lib/guardrail-settings.ts` |
| Settings panel model helpers         | `lib/config-panel-model.ts`                         |
| Common preference descriptors        | `lib/preferences.ts`                                |
| Protected org aliases editor         | `lib/production-aliases-panel.ts`                   |
| Rule-derived agent guidance          | `lib/guidance.ts`                                   |
| Kernel body loader + override        | `lib/prompt-injection.ts`                           |
| Formatters for `/sf-guardrail`       | `lib/status.ts`                                     |
| SF Pi Manager settings adapter       | `lib/config-panel.ts`                               |

## Conventions

1. **Types live at the boundary.** `lib/types.ts` is the only place where
   the config schema and decision shapes are defined. Every other module
   imports its types from there.
2. **Pure evaluators.** `safety-kernel.ts`, `safety-subject.ts`,
   `safety-envelope.ts`, `rule-behavior.ts`, `guidance.ts`,
   `file-policy-gate.ts`, `policies.ts`, `command-gate.ts`,
   `org-aware-gate.ts` do not touch `ctx`, `pi`, or any pi API.
   They take config + input, return decisions.
   Side effects (prompts, appendEntry, notify) happen only in `index.ts`,
   `hitl.ts`, and approval-ledger/UI adapters.
3. **Fail-closed is the rule.** Configuration, transport, deadline, cancellation,
   malformed-response, and model-identity failures block. Incomplete Jev
   operation context may require human confirmation, but cannot automatically
   allow. In deterministic mode, the command-gate substring fallback for
   tokenizer failure prefers false-positive over false-negative.
4. **No new `tool_call` side effects without audit.** Every decision path
   must call `recordDecision(...)` through `lib/approval-ledger.ts` so
   `/sf-guardrail audit` stays truthful.
5. **No runtime deps.** Keep the OpenRouter client, tokenizer, globber, and matchers
   dependency-free. If we ever need a real shell AST, prefer a well-
   maintained package (`shell-quote`) and pin the version, rather than
   rolling another one.

## Selectable engine contract

- `sfPi.guardrail.engine` is `deterministic` by default or explicitly `jev`.
  Manager preferences and `/sf-guardrail engine deterministic|jev` own this
  choice. No failure may silently switch engines or erase the preference.
- Branch into Jev before deterministic normalization. Every Pi `tool_call`
  reaches Jev in its mode; do not exempt reads, dry runs, unfamiliar tools, or
  native calls the deterministic registry ignores. Jev interprets all policy;
  do not add deterministic matchers as a hidden fallback or second risk vote.
- Send operation metadata and effective policy only. Keep file bodies,
  Apex/scripts, query text, Canvas content, credentials, transcripts, fetched
  contents, and raw arguments local. Mark withheld and opaque effects explicitly;
  never infer that a custom pattern does not match an omitted literal.
- Tool descriptions, argument-derived facts, and tool-supplied approval claims
  are untrusted data. Resolve org and browser facts locally; keep verification
  state distinct from supplied intent. No live request during factory/startup.
- Use the built-in `fetch` client, one Decisions Choice question, a total
  1,500 ms classification deadline, cancellation, and no retries. Require the
  configured model/provider identity; do not discover or choose fallbacks.
- Only complete-context Jev `allow` predictions with `P(allow) >= 0.99` may
  automatically execute. Other valid allow predictions confirm; model blocks
  are hard blocks. This threshold is a conservative initial default, not a
  calibration or safety qualification claim.
- Audit every Jev outcome without raw payloads or credentials. Recheck engine,
  policy identity, and cancellation before releasing execution.

## Editing the bundled ruleset

- `SF_GUARDRAIL_DEFAULTS.json` is the source of truth for rule behavior.
- Adding a new bundled rule means:
  1. Add the rule to `SF_GUARDRAIL_DEFAULTS.json` with a stable id.
  2. Update `tests/config.test.ts` to assert the id ships.
  3. Update `tests/safety-kernel-contract.test.ts` with a match + non-match case.
  4. Document the rule in `README.md` under the relevant feature tier.
- Never add a rule whose id collides with a rule already in the override
  merge path (bundled ids are stable API; renaming them breaks user
  overrides).

## HITL invariants

- Every gated path ends in one of the `DecisionOutcome` values in
  `lib/types.ts` (`allow_once`, `allow_session`, `allow_persisted`,
  `allow_auto`, `block`, `timeout`, `cancel`, `hard_block`,
  `headless_pass`, `headless_block`). Anything new needs plumb-through
  in `approval-ledger.ts` and `status.ts`.
- The deterministic headless escape hatch is an env var only. No config-file
  setting to "always allow headless". Jev confirmations require explicit human
  approval; Power Tool, operator auto-approve, and headless controls cannot
  bypass them.
- Jev session grants require complete context and a currently verified
  non-production org. Bind them to the exact canonical original input plus
  tool, `cwd`, verified target, policy/protocol, engine, and model identity.
  Never reuse deterministic or broader operation-family grants for Jev calls.
- Timeouts equal block. User-facing copy may say "approval expired", but
  expired approval still fails closed. Never auto-accept on timeout.

## Non-goals

- Not a code reviewer — sf-lsp covers diagnostics.
- Not a secret scanner — gitleaks handles that in CI.
- No path-access gate (allow/ask/block outside cwd). Salesforce projects touch
  `~/.sf/`, `~/.sfdx/`, and shared libraries routinely; changing this requires
  a separate trust-aware design and ADR.
- No LLM command explainer. Jev supplies the risk choice in its selected mode;
  approval UI and audit remain local. Do not add a separate explanation model,
  model-controlled approval API, or external telemetry.
- No project-local guardrail preference layer in MVP. Routine preferences
  are global Pi settings under `sfPi.guardrail`; project-local weakening is
  deferred with project-local rule overrides. Adding either means plumbing
  trust-aware `cwd` through settings resolution and recording a new ADR.
