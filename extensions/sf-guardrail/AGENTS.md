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
| Jev Decisions transport              | `lib/jev-client.ts`                                 |
| Jev command request stages           | `lib/jev-command-process.ts`                        |
| Jev experimental operating point     | `lib/jev-operating-point.ts`                        |
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
5. **No runtime deps.** Keep the Jev client, tokenizer, globber, and matchers
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
- File metadata covers `read`, `write`, `edit`, `grep`, `find`, and `ls`.
  Match the installed Pi schemas and runner defaults. Only `grep`, `find`,
  and `ls` use the working directory for an absent or empty path. Keep
  search patterns and glob text local. Their omission does not establish
  unknown executable code. Preserve unknown selected-file sensitivity.
  Directory facts do not describe every selected descendant. Numeric runner
  arguments do not prove a complete output bound or a policy result.
  Protocol 10 preserves the supplied path kind from the existing `stat`
  lookup. This lookup follows symlinks. An absent kind or lookup failure
  means unknown. Do not infer kind from a suffix or inspect descendants.
  Query flag metadata must match the installed CLI. Native `query.run`
  ignores `limit`. Use supplied `max_rows`, then the Protocol 12 verified
  query LIMIT, for its cap observation.
  Keep query text local and retain the completeness gate.
- Protocol 11 binds command-specific deploy flag observations. Observe
  `--dry-run` only on `project deploy start`. Observe `--use-most-recent`
  only on `project deploy quick`, `report`, or `resume`. Modern deploy
  `--check-only` and `--checkonly` are unknown and incomplete. Keep later
  operands local. These flags do not prove preview intent or a policy result.
  Keep unsupported legacy deploy operations unknown. Do not infer support
  from a flag name on another operation.
- Protocol 12 observes only a narrow original native `sf_soql` `query.run`
  query. Bound it to 512 bytes and an 80-character ASCII source. Admit only
  case-insensitive `SELECT Id FROM source LIMIT 1..2000`, with ASCII space,
  tab, CR, or LF. Require the current local syntax SDK to accept it. Keep
  raw query and source spelling local. Sensitivity stays unknown. Without an exact Protocol 14 plan, generated artifact paths stay
  unobserved and completeness stays false. The query observer alone cannot
  bind artifact paths or custom file policy. Keep all independent unknowns
  and policy decisions.
- Protocol 14 binds a native `sf_soql` `query.run` to the actual writer plan.
  The shared producer declares all possible ancestor directory creations
  and five exact file writes before classification. Fresh facts cover every
  path. Jev judges file policy for each declared write access. The local
  hash binds session, call ID, tool, original input, working directory, and
  plan. Keep that identity and the query local. Do not accept a plan or
  approval token from tool arguments. Remove only the resolved artifact
  omission; preserve other unknowns. Audit allow before authorization.
  Claim the plan once before connection, then check context before writing
  and around each wait. Keep all Jev call records for the process lifetime.
  At 256 records, reject new plans instead of deleting old identities.
  Snapshot every Jev action before its first wait. An engine change cannot
  turn a recorded Jev call into legacy execution. Session changes and
  extension reload revoke authority. Directory and file creation is
  exclusive where the writer creates its run and output files. Preserve
  partial owned output after failure. `stat` and `realpath` observations
  do not prevent operating-system ancestor replacement races.
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
  Command rows may repeat these labels in `publicNames`. Use the exact
  operation ID map. Keep null labels and separate prefix namespaces. Add no
  vocabulary. File and org criteria state eligibility, exemptions, order,
  and tool access directly. Jev still selects every rule outcome.
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
- Use the built-in `fetch` client. Non-Bash tools send all requested action
  heads in one strict Decisions request. Bash uses the actual non-command,
  syntax, and grouped command-policy stages. An empty active command manifest
  omits only the syntax call. The original state stays version 6. Require an explicit HTTPS
  `SF_GUARDRAIL_JEV_ENDPOINT`; there is no default endpoint. Read
  `SF_GUARDRAIL_JEV_API_KEY`, otherwise `SF_GUARDRAIL_JEV_API_KEY_FILE`.
  Check the endpoint before reading a key. This connection must support the
  pinned TypeSafe Jev contract. Keep endpoint URLs, key values, and key paths
  out of the UI, status, audit, and request body.
  Always ask operational `risk` with tool-family
  guidance about executable effects; policy questions decide matching blocks.
  Add file policy for available paths/facts, command policy for shell
  calls, and org policy for structurally possible org AST entries. Disclosure
  follows the tool-specific projection; incomplete shell effects retain it.
  Authority is browser-only; other unknown effects stay in risk/disclosure and
  the completeness gate. At most six model-authored action answers supply all risk
  and policy judgments. Structural applicability must not decide an outcome.
  Genuinely unresolved policy restrictions remain model confirm/block criteria.
  Private command values/comments retain policy equality through token IDs;
  withheld spelling alone is not missing policy evidence or a match.
  Keep every request within 32,768 bytes. Keep all active command rows in
  source order, up to 64 rows. Do not batch, trim, match, or select rules
  locally. Pin TypeSafe routing with fallbacks disabled. Require the configured
  model and provider identity. Errors block without retries or fallback.
- Freeze and validate the exact experimental operating point before facts or
  calls. `SF_GUARDRAIL_JEV_OPERATING_POINT` accepts only `conservative` (default)
  or `argmax`. Conservative requires every action to select allow with raw
  P(allow) at least 0.99, and every selected syntax choice to have raw probability
  at least 0.99. Argmax declares both floors as zero; actions must still select allow.
  Both points require complete original context. Every actual action block
  stays hard. Neither point has joint calibration or safety qualification.
- Use one total 10,000 ms absolute deadline from before facts through calls,
  validation, synchronous cleanup, and automatic release checks. Do not reset
  the model deadline for a stage. Do not count a human dialog against a later
  explicit approval. That approval gets one new 1,500 ms context recheck phase.
  Artifact consumers keep fresh bounded rechecks before connection and writes.
  Prior diagnostic scores do not qualify this runtime adapter.
- Bind the fixed point to protocol, fingerprint, transport, audit, and current
  context checks. The normal engine default remains deterministic. Do not
  change normal profiles or transfer a deterministic approval to Jev.
- Audit every Jev outcome and each answer's actual probabilities/confidence
  without raw payloads or credentials. Top-level evidence must remain the
  actual `risk` answer and its origin, not the final gate or a combined
  confidence. Keep separate actual stage receipts and the full binary transcript.
  Do not attach collected heads to one provider request ID. Keep validated
  observed answers after a later failure or cleanup error. Recheck engine,
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
  tool, `cwd`, verified target, policy/protocol, engine, model identity, and
  local transport hash. This hash binds the endpoint, model, provider, and
  routing without storing endpoint text. A changed connection invalidates
  the grant.
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
