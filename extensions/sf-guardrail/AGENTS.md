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
| Mechanical command token projection  | `lib/jev-command-tokens.ts`                         |
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
  native calls the deterministic registry ignores. Jev is the sole risk engine
  and interprets all policy; do not add a deterministic floor, hidden fallback,
  or second risk vote.
- Send operation metadata and the minimum effective policy relevant to the
  questions. Known CLI structure, trusted file-path facts, and bounded numeric
  observations describe effects without deciding policy locally. Mechanically
  project command tokens to request-local integer IDs: original, expanded, flat,
  typed prefix classes, and Pi argument sequences. Command-token version 2 sends
  effective active-only ordered restrictions/allow exceptions with explicit
  behavior and token IDs or a special-pattern form. Validate and bound every
  configured row before omission; off allow/deny entries allocate no token
  classes. Project off ordinary rows separately as effectWaivers, for exact model
  risk/disclosure effect matching only. They never waive active command/org/file
  restrictions or act as allow exceptions. Preserve file/org off-winner
  semantics. Put static token/namespace/special definitions in shared
  policy.commands.matchGrammar so each independent question sees them directly.
  Jev compares IDs and chooses matches; the host must not send matched rules,
  outcomes, raw commands, private-word dictionaries, stable hashes, or private
  operand legends. `publicSyntax` may map only known executables/subcommands/
  flag keys already exposed in semantic metadata to the same IDs.
  Preserve equality and quoted-token boundaries. IDs reveal equality and policy
  vocabulary membership; do not describe them as cryptographic protection or
  guaranteed model matching. Filter
  org AST entries by complete known executable/wrapper heads;
  retain all org entries for incomplete/opaque heads, withheld comments, or
  missing commands. Jev still decides full rule applicability and behavior.
  Keep file bodies,
  Apex/scripts, query text, Canvas content, credentials, transcripts, fetched
  contents, and raw arguments local. Mark withheld and opaque effects explicitly;
  never infer that a custom pattern does not match an omitted literal.
- Tool descriptions, argument-derived facts, and tool-supplied approval claims
  are untrusted data. Resolve org and browser facts locally; keep verification
  state distinct from supplied intent. Structurally relevant org-policy entries
  require fresh org observations even for custom non-Salesforce command heads.
  Unknown facts stay explicit. Exact `sf_browser_press` key `Escape` requires
  neither org nor fresh target/focus facts; retain risk and authority questions
  without fabricating a fresh snapshot. No live request during factory/startup.
- Model execution metadata from exact runner branches: dryRun honored/ignored/
  unknown, effectiveDryRun only when honored, planningOnly only for exact
  non-executing branches. Agent Script publication and Data 360 cleanup, CSV
  ingest, and manifest runs ignore supplied dry-run intent. Do not infer a
  preview from that intent or a suffix alone; prerequisite reads can still occur
  under an honored business-write dry run. These facts do not decide risk.
- Use the built-in `fetch` client and protocol v6/state version 6 independent Choice questions
  in one Decisions request. Always ask operational `risk` with tool-family
  guidance about executable effects; policy questions decide matching blocks.
  Add file policy for available paths/facts, command policy for shell
  calls, and org policy for structurally possible org AST entries. Disclosure
  follows the tool-specific projection; incomplete shell effects retain it.
  Authority is browser-only; other unknown effects stay in risk/disclosure and
  the completeness gate. At most six model-authored answers supply all risk
  and policy judgments. Structural applicability must not decide an outcome.
  Genuinely unresolved policy restrictions remain model confirm/block criteria.
  Private command values/comments retain policy equality through token IDs;
  withheld spelling alone is not missing policy evidence or a match.
  Preserve the bounded request,
  total 1,500 ms deadline, cancellation, and no retries. Pin routing to TypeSafe
  only with fallbacks disabled; require the configured model/provider identity.
  Coverage-first diagnostic harnesses may record an authorized 10-second
  transport deadline with inert operations; keep that evidence separate from
  runtime qualification under the enforced 1,500 ms deadline/500 ms p95 target.
- Automatically execute only with complete context and every requested answer
  choosing `allow` with `P(allow) >= 0.99`. Any model `block` is a hard block;
  any `confirm`, insufficient allow probability, or incomplete context requires
  explicit human confirmation. This threshold is a conservative initial default
  requiring domain-label evaluation, not a calibration or qualification claim.
- Audit every Jev outcome and each answer's actual probabilities/confidence
  without raw payloads or credentials. Top-level evidence must remain the
  actual `risk` answer labeled with that question's choice, not the final gate
  or a synthesized combined confidence. Recheck engine,
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
  Update reusable grant memory only after persistence and audit recording
  succeed; an audit/write failure must not leave an approved reusable grant.
- Timeouts equal block. User-facing copy may say "approval expired", but
  expired approval still fails closed. Never auto-accept on timeout.

## Non-goals

- Not a code reviewer — sf-lsp covers diagnostics.
- Not a secret scanner — gitleaks handles that in CI.
- No path-access gate (allow/ask/block outside cwd). Salesforce projects touch
  `~/.sf/`, `~/.sfdx/`, and shared libraries routinely; changing this requires
  a separate trust-aware design and ADR.
- No LLM command explainer. Jev supplies the risk/policy answers in its selected mode;
  approval UI and audit remain local. Do not add a separate explanation model,
  model-controlled approval API, or external telemetry.
- No project-local guardrail preference layer in MVP. Routine preferences
  are global Pi settings under `sfPi.guardrail`; project-local weakening is
  deferred with project-local rule overrides. Adding either means plumbing
  trust-aware `cwd` through settings resolution and recording a new ADR.
