# SF Guardrail

## What It Does

SF Guardrail checks agent tool calls before execution. Select the deterministic
engine or the TypeSafe Jev engine through a configured HTTPS Decisions provider.
SF Pi owns execution blocking, human confirmation, approval memory, and audit
for both engines. The deterministic engine remains the default.

The deterministic engine evaluates protected files, dangerous shell commands,
org-aware Salesforce operations, and known high-value native-tool mutations.
Every rule has one behavior: `off`, `confirm`, or `block`:

- **Policies** protect files as no-access, read-only, or explicit no-op.
- **Command gate** structurally matches dangerous commands, including commands
  later in simple shell chains and `herdr_pane.run` calls.
- **Org-aware gate** applies production-level policy after resolving the target
  org type; unresolved targets fail closed.
- **Native-tool gate** classifies known durable mutations from Agent Script,
  Data 360, Apex, Slack, SOQL, and SF Browser surfaces.

Intent flags such as `allow_mutation`, `allow_confirmed`, or `mutation=true` aid
classification but never become approval.
Supplied `dry_run` intent alone does not establish a preview. Metadata records
how the actual runner handles it: `executionFlags.dryRun` is honored, ignored,
or unknown; `effectiveDryRun` is supplied only for honored branches, and
`planningOnly` identifies exact non-executing branches. Agent Script publication
ignores `dry_run`; Data 360 cleanup, CSV ingest, and manifest run branches can
execute despite it. An honored dry run skips the selected business-write branch
while prerequisite reads may still occur. Jev evaluates these observed runner semantics.

The opt-in Jev engine sends operation metadata for **every Pi `tool_call`**,
including reads, dry runs, unfamiliar tools, and calls skipped by the native
risk registry. Jev interprets the effective file, command, org, and custom rule
policy and returns `allow`, `confirm`, or `block`. There is no automatic
fallback to deterministic rules.

In Jev mode, exact protected-file and block patterns are interpreted by a
model. They no longer have a deterministic matching guarantee. Reported model
probabilities are inputs to a conservative threshold, not proof that a call is
safe. The local Gemma C11 diagnostic results do not qualify hosted Jev for
enforcement; evaluate the configured hosted model before normal use.

## Commands

- `/sf-guardrail` — open the Manager detail, or print status without UI.
- `/sf-guardrail list` — print active rules.
- `/sf-guardrail audit` — show up to 50 recent session decisions.
- `/sf-guardrail grants` — list legacy persisted grants if present.
- `/sf-guardrail settings` — open routine preferences.
- `/sf-guardrail engine deterministic|jev` — select and persist the engine.
- `/sf-guardrail aliases` — edit aliases that receive production-level policy.
- `/sf-guardrail forget` — clear current-branch session allowances and legacy
  project grants.

## Configuration

Bundled rules live in `SF_GUARDRAIL_DEFAULTS.json`. Routine global preferences
live under `sfPi.guardrail` in Pi settings and cover the engine, confirmation
timeout, protected aliases, Power Tool choices, and bundled-rule behavior.
Select the engine in the Manager Guardrail preferences or with the explicit
engine command. Status reports the selected engine, Decisions provider connection,
and API key readiness. These local checks do not send a request.

Advanced custom patterns or full stable-id overrides live in
`<globalAgentDir>/sf-guardrail/rules.json`. Effective configuration resolves
bundled defaults, advanced overrides, then routine Pi settings. Project-local
weakening is not supported.

In deterministic mode, process-level automation controls are explicit:

- `SF_GUARDRAIL_ALLOW_HEADLESS=1` allows otherwise confirmable headless calls
  with an audit warning.
- `SF_GUARDRAIL_OPERATOR_AUTO_APPROVE=allow-confirm-actions-for-this-process`
  auto-allows confirm-class decisions for that process.

Neither path bypasses hard blocks. Jev mode ignores these controls and Power
Tool Mode for confirmation decisions; headless confirmations block.

## Jev Connection

Set `SF_GUARDRAIL_JEV_ENDPOINT` to the full HTTPS Decisions URL. There is no
default endpoint. The URL must have no embedded credentials, query, or fragment.
Set `SF_GUARDRAIL_JEV_API_KEY`, or set `SF_GUARDRAIL_JEV_API_KEY_FILE` to a local
key file. The environment key takes precedence. Keep the endpoint, key value,
and key path out of Pi settings, audit entries, and tracked files. This example
uses a placeholder URL. Replace it with your approved Decisions endpoint:

```bash
export SF_GUARDRAIL_JEV_ENDPOINT="https://decisions.example.invalid/v1/decisions"
export SF_GUARDRAIL_JEV_API_KEY_FILE="$HOME/.config/jev/key"
```

The client uses Node's built-in `fetch`. Each call sends an HTTPS `POST` to the
configured URL with JSON and `Authorization: Bearer <key>`. It rejects redirects.
The gateway must accept `model`, pinned `provider` routing, wire state version 6,
and independent Choice `questions`. It must return the resolved model and
provider identity, a request `id`, exactly one `answers` entry per requested
question, and `usage.input_tokens` and `usage.output_tokens`. Reported
`usage.cost` is optional. Each answer must have `type: "choice"`, a valid
`choice`, exactly the requested probability keys, and `confidence`. Action
keys are `allow`, `confirm` and `block`. Command syntax keys are `match` and
`no_match`. File matching keys are `match`, `no_match` and `unknown`.
This connection implements the pinned Jev Decisions contract. It does not select
arbitrary chat models.

Each action question has `allow`, `confirm`, and `block` options.
Every tool request asks `risk` using a rubric for its tool family: files,
shell/Salesforce CLI, Apex, SOQL, Agent Script, Data 360, Canvas, browser, or
unknown effects. Applicable questions separately judge their own dimensions.
At most six action answers supply these judgments:

- **File policy** is included when paths or file facts are available.
- **Command policy** is included for parsed shell calls.
- **Org policy** is included when shell executable or wrapper heads leave
  potentially applicable org-aware rules. Complete, known heads filter the
  projected rules by executable name; incomplete/opaque heads, withheld
  comments, or missing commands retain the full org ruleset. Jev judges rule
  patterns, flags, org types, ordering, and behaviors.
- **Disclosure** is included for file reads, SOQL, and other possible
  data/credential transfers. It is omitted for write/edit authoring, Apex,
  Agent Script, Canvas, browser calls, complete Data 360 calls with proven
  `planningOnly` or honored `effectiveDryRun=true`, and complete
  known non-disclosing shell shapes such as permission changes or local Git
  operations without file operands. Incomplete shell metadata retains it.
- **Authority** is included only for browser tools, where fresh target roles,
  labels, focus, and gestures matter. An exact `sf_browser_press` with key
  `Escape` is target-independent cancellation: it still asks risk and authority,
  but needs no org or fresh target/focus facts. The request does not fabricate
  fresh browser context. Unknown effects on other tools remain in their
  risk/disclosure questions and the completeness gate.

The risk question judges executable/operational effects and execution
uncertainty. File, command, and org policy questions judge matching restrictions;
disclosure and browser authority assess their own effects. A genuinely
unresolved restriction remains a model confirm/block criterion. Private command
literal spelling can be withheld while its exact equality remains available
through the token projection; omitted spelling alone does not create a match.

The original Bash action route uses three calls. The first call asks all applicable action
questions except command policy. The second asks Jev to compare every active
command row with the command tokens. These syntax answers choose `match` or
`no_match`. The third asks command policy and includes the actual syntax
answers. An empty active row list needs only the first and third calls. The
host does not match a row or select a policy winner. An early block does not
skip a later requested call. The complete original route for every other tool
uses one strict call for all applicable action questions. This includes command policy for a tool with
shell metadata. The experimental file adapter can add the matching call
described below before either original action route.

The experimental `file_match_then_policy` adapter preserves every original
`facts.files` record and `policy.files` row. The matching call permits 1 to 8
heads in exact source order. For each record, it visits every row, then
`patterns` and `allowedPatterns`. It includes disabled and Off rows. Each
head carries the complete original record and row. Jev chooses only `match`,
`no_match`, or `unknown` for that named list and record.

Protocol 19 includes a flat `state.fileMatchPremises` array. Each entry has the
literal zero-based `fileRecordIndex` in `facts.files` and `policyRowIndex` in
`policy.files`, `patternList` (`patterns` or `allowedPatterns`), and actual
`choice` (`match`, `no_match`, or `unknown`). Entries keep the exact source
order. This array and the retained full `state.fileMatch` transcript come
from the same validated matching receipt.

The later actual `file_policy` head uses those typed choices as matching
premises. Jev applies eligibility, the same-row exemption, existence
requirements, protection strength, first-tie order, Off-winner behavior,
access, and the final action. Unknown stays unknown. The host copies and
validates the complete data and receipts. It does not match paths, filter
rows, select a winner, or add another policy vote. Other action questions
keep their original instructions and independent restrictions.

The adapter selects its complete format before any transport factory. It
checks every required matching head. It checks each later complete request
with the maximum reserved transcript and named array. At every original
coordinate, reserve the longest choice spelling `no_match`. This reserve is
only for admission; it is not a model reply.
If a new count, byte, or JSON tree bound fails, it keeps the exact complete
original Jev route. The original route must also meet its request limits.
This selection uses only structure and size. A failed reply blocks the
process. It cannot select the original route after a model call.

Each actual request has a maximum depth of 32, a maximum of 16,384 JSON
nodes, and a maximum body of 32,768 UTF-8 bytes. Freeze and validate each
request body separately. Duplicate copies in the local plan do not count
against the JSON tree limit for a request. Keep all original records and rows; do not trim
or batch them to fit.

The compact file transcript has 16 top-level fields and six fields per
answer. It retains the actual receipt, IDs, hashes, model/provider, usage,
optional cost, bytes, timing, three raw probabilities, and confidence.
Numbers use canonical numeric strings. Signed zero remains `-0`. The strict
inverse restores the typed receipt and exact original request bytes. It
preserves parsed numeric values and signed zero. Raw JSON number spelling
is outside that inverse.
Validation requires exact equality with the named array rebuilt from that
receipt. The inverse removes both added fields and restores the original
file policy question to recover exact original request bytes.

The file adapter remains experimental. Full validation is pending. Earlier
head-only file diagnostics do not establish this adapter's coverage. Its
current full development score, independent acceptance, and safety
qualification remain unproved.

The Bash syntax call maps each integer token ID to one distinct alphabetic
label, such as `t_a`. Token order, quoted boundaries, prefix namespaces and
all selector fields stay intact. Each question states its selector with those
labels. The shared grammar defines equality, order and adjacency. Public
selector names stay in a separate ordered list. A null name is not a wildcard.
Vocabulary membership does not prove that a command token was observed.
The local manifest still binds the original rows and integer token projection.

Process 45 selects the command syntax format before transport. Syntax 44
copies every adjacent pair of original commands, with their indices, heads,
and complete left arguments. It keeps all original rows and selectors.
Any separator between adjacent original rows counts. If the complete syntax
44 body exceeds 32,768 UTF-8 bytes, the process uses exact syntax 43 with the
same limit. This choice uses only request size. It adds no match, action,
retry, or extra wire field. Exact local inverses restore syntax 43, historical
syntax 42, numeric syntax 37, and long syntax 31. A changed or extra field
invalidates restoration.

The criteria distinguish local file authoring from body execution and Pi
status output from credential output. File exemptions apply to their own row
before protection strength is selected. The default deployment exclusion
applies only to `sf-deploy-prod`; independent custom restrictions remain.
These criteria changes do not establish qualification. The latest measured
results and failed targets are in the replacement progress report.

For a local `write` or `edit` with `exists=false`, unknown prior file kind
describes the absent object. In the `risk` question, that fact alone does not
mean an unknown executable effect. File protection and disclosure remain
with their sole independent Jev questions.

Hosted browser facts omit only the changing `ageMs` value. They keep the actual
freshness status and target fields. Local checks keep the snapshot identity,
age and expiry. These checks do not extend a snapshot's lifetime.

The state carries the minimum policy and observed facts relevant to those
questions. Known CLI metadata, trusted file-path variants, verification state,
and bounded numeric observations such as the effective row-limit bucket help
describe actual effects without sending private payloads. Command policy uses
mechanical integer token IDs, preserving original and wrapper-expanded command
order, quoted-token boundaries, and exact equality of private literals. Effective
command lists carry only active ordered rows with explicit behavior, token IDs,
and seven special-pattern forms. Off allow/deny entries are omitted after every
configured row is validated and bounded. Off ordinary entries are separate
`effectWaivers`, used only for exact model matching of that configured operational
or disclosure effect; they cannot suppress active file, command, or org
restrictions or act as allow exceptions. File/org rules retain their own Off
winner semantics. Shared `policy.commands.matchGrammar` gives each independent
question the same token/namespace/special definitions. Jev compares IDs and selects applicable rules; the host
serializes facts and combines model answers. The projection sends no raw command,
private-word dictionary, stable hashes, private-operand legend, matched-rule list,
or local outcome. `publicSyntax` associates only known CLI executables,
subcommands, and flag keys already present in semantic metadata with their IDs.
Private operands have no explicit legend. Equality and known policy anchors can
still reveal membership; this is no cryptographic secrecy
or deterministic matching guarantee. This follows TypeSafe's separation of supporting
[state](https://docs.typesafe.ai/concepts/state) from independently evaluated
[questions](https://docs.typesafe.ai/primitives/choice).

Command rows also repeat selector labels in `publicNames`. Each label comes
from the operation's exact `publicSyntax` ID map. Selectors with no public name
have null labels. Prefix IDs keep separate namespaces. These labels add no
words and decide no matches. File and org criteria state eligibility,
exemptions, rule order, and tool access directly. The instructions remain
experimental. Independent acceptance and useful safe approval coverage remain
unproved.

The request pins routing to `only: ["typesafe"]` with
`allow_fallbacks: false`, requests `typesafe/jev-1.13`, and requires the resolved
identity `typesafe/jev-1.13-20260917` from provider `TypeSafe`. An unexpected
model or provider identity blocks until the integration is revalidated.

Classification and automatic release share one 10,000 ms total deadline.
Facts, preparation, all calls, response reads, validation and synchronous
cleanup count against that deadline. A stage cannot reset it. There are no
retries. Cancellation starts without a wait for asynchronous cleanup to finish.
A later human approval has a separate 1,500 ms check of the current context.
It does not repeat a model call. Missing endpoint or credentials, invalid supplied
configuration, malformed metadata or responses, API/transport failures,
cancellation, and deadline expiry block with an audited failure. Factory
execution and session startup make no live Jev requests.

`SF_GUARDRAIL_JEV_OPERATING_POINT` selects one exact setting:

- `conservative` is the default. Each action must select `allow` with raw
  `P(allow) >= 0.99`. Each syntax answer must have raw probability of at least
  `0.99` for its selected choice. The same floor applies to every file
  matching choice, including `unknown`.
- `argmax` is experimental. Both probability limits are zero. Every action
  must still select `allow`. Command syntax and file matching choices still
  come from Jev. An `unknown` file choice remains an unknown premise.

Both settings require complete original context for automatic execution.
Unknown names and custom probability limits fail. The setting is captured
before facts are resolved. Its hash binds the protocol, connection and exact
approval. A changed setting prevents release. Neither setting has a calibrated
joint probability or safety qualification. The 500 ms p95 target remains a
performance reference. The user chose coverage tests with slower responses.

See the [TypeSafe Choice documentation](https://docs.typesafe.ai/primitives/choice)
for independent decision questions. Validate your configured gateway against
the client contract before live use.

Response validation preserves the actual returned probabilities. A distribution
must sum to one within the numeric tolerance. The client also accepts compatible
two-decimal values when their clipped, closed half-cent intervals can contain a
normalized distribution. This is an explicit client compatibility assumption.
Check the behavior of your configured provider during validation. The client
does not renormalize answers or increase their allow probabilities. Range,
complete answer sets, chosen maximum, identity, and confidence checks remain
required. The validation contract is included in the local protocol hash.
A changed contract invalidates old grants.

For SDK preparation without an endpoint, key, or network request, run:

```bash
node --experimental-strip-types scripts/jev-guardrail-hook-smoke.ts --prepare-only
```

Use `--live` explicitly to send one request through the real Pi hook with an
inert read tool. The script uses an isolated temporary Pi profile. Its callback
reads no file contents and changes no Salesforce or browser state. Live smoke
evidence does not establish model qualification.

## Safety and Data Boundaries

- Interactive confirms offer Allow once or Block. The session option appears
  only when the engine's approval scope is eligible. In Jev mode, that requires
  complete context and a currently verified non-production org; production,
  unknown, external, and opaque calls remain allow-once.
- Jev automatically allows only complete context with **every requested
  action answer** choosing `allow` and meeting the captured probability limit.
  Command syntax and file matching answers, including `unknown`, must meet
  that setting's selected-choice limit. Any action choosing `block`
  is an unapprovable hard block. Any `confirm`, allow probability below the
  threshold, or incomplete context requires explicit human confirmation.
- Complete file context requires an observed `facts.files` row for every
  declared path and original artifact access path. The row's `path` must equal
  the declared path. Missing, empty, or partial facts cannot prove coverage.
  `exists=false` is valid, and file kind is optional. A supplied fact resolver
  receives a separate copy of derived metadata. Changes to that copy cannot
  remove the original paths, access rows, questions, or incomplete state.
  The prepared artifact plan keeps its original registered object identity.
  Checks repeat between stages and before automatic release. They bind the
  original input, policy, descriptor, operating point, context, and hosted
  facts. A later human allow repeats the bounded current-context checks.
  Path facts do not bind inode, modification time, or file contents.
  The checks do not prevent filesystem replacement races.
- Jev session approval covers the exact original call. Its local fingerprint
  includes the full canonical input, tool, working directory, verified target,
  engine, policy/protocol hash, model identity, and local transport hash. The
  transport hash binds endpoint, model, provider, and routing without storing
  endpoint text. A changed connection invalidates approval. Withheld content
  stays local, but changing it invalidates approval. Deterministic grants cannot approve Jev
  calls. Session memory remains limited to the current session branch.
  A grant becomes reusable only after persistence and audit recording succeed.
- Outbound Jev requests contain operation metadata, effective policy, and
  locally resolved facts. They exclude raw tool arguments, file bodies,
  Apex/scripts, query text, Canvas contents, credentials, transcripts, fetched
  contents, and full browser pages or forms. Tool descriptions and extracted
  argument metadata are untrusted data, not approval authority.
- Unsupported shell grammar, hidden content, unresolved effects, and missing
  metadata remain explicit uncertainty. A custom pattern that could match an
  omitted literal cannot be assumed to be a nonmatch. There is no silent
  truncation of oversized metadata.
- Every automatic allow, human allow, session allow, block, timeout, cancel, and
  headless pass becomes an audit entry. Jev audit includes available model,
  per-question choices/probabilities/confidence, latency, cost, request-id, and
  failure facts without raw payloads. Top-level probabilities and confidence
  are the actual `risk` answer, even when another question decides the final
  gate. Audit retains separate actual stage replies, origins, command syntax
  answers, and the file matching transcript when that format is selected.
  Collected answers have no shared provider request ID or combined probability. Already validated replies remain evidence after a later failure.
- In deterministic mode, Power Tool Mode is off by default, can be limited to selected native families,
  and requires a separate production/unknown-org opt-in.
- In deterministic mode, strictly validated temporary-directory cleanup can be auto-allowed; other
  dangerous commands are confirmed or hard-blocked according to rule behavior.
- Disabling the extension removes this mediation layer; the Manager calls that
  out before changing package state.

## Evaluation

Thresholds need evaluation on labels authored for this domain. TypeSafe's
[confidence guidance](https://docs.typesafe.ai/confidence) recommends
conservative starting thresholds and validation with your own data; a
concentrated answer does not establish correctness for an individual tool
call. Questions within each stage are independent, following the
[fan-out pattern](https://docs.typesafe.ai/patterns/fan-out).

The frozen development fixture contains 175 cases covering all 74 bundled
rule IDs, six native-tool families, and ten additional risk cases. Inputs and
authored gold labels were frozen before predictions (`81d8199c` fixture hash
prefix). Gold counts are 32 allow, 132 confirm, and 11 block; the actual current
deterministic Safety Kernel returns 42 allow, 122 confirm, and 11 block on
those same cases. Org facts are authored mocks; file/browser observations use
an isolated local profile, and the operations never execute. These development
comparisons measure unsafe automatic allows, weakened blocks, safe-call
coverage, extra confirmations, failures, latency, and reported cost. They do
not establish held-out qualification or live Salesforce/browser acceptance.
Protocol revisions are recorded separately from this frozen input/gold set;
an earlier protocol's result does not establish the revised protocol's behavior.
Protocol 15 uses the same total 10-second bound in its staged hook and coverage
tests. Record the exact probability setting for each test. A result under an
older protocol or setting does not establish the current source's behavior.
Finite coverage, actual tool execution, latency and independent qualification
remain separate proof steps.

SF Pi's selected Jev mode gives Jev sole responsibility for risk and policy
interpretation. It has no deterministic risk floor. Compare the configured
model directly with SF Pi's actual deterministic baseline. Hosted measurements
must support improvement claims. The initial hosted qualification remains
false. Development results alone do not change that status.

## References

Canonical terminology lives in [`CONTEXT.md`](./CONTEXT.md). Durable design
trade-offs live in the generated [ADR lifecycle index](../../docs/adr/README.md),
including fail-closed behavior, Safety Envelopes, rule-derived guidance,
session approvals, org classification, rule behavior, and native mutation
mediation. The selectable engine contract is described in
[ADR 0118](../../docs/adr/0118-sf-guardrail-selectable-jev-engine.md).
The [initial hosted evaluation](../../reports/jev-guardrail-evaluation-2026-09-23.md)
records the live replay, actual SDK smoke, and unmet activation gates.

## Troubleshooting

**Production confirms fire for a sandbox:** Inspect `/sf-guardrail audit` to see
whether org type came from cache, lookup, a protected alias, or a fail-closed
guess. Refresh authentication/environment state before changing alias policy.

**A protected file remains blocked after removing an override:** Bundled rules
merge by stable id. Add an explicit disabled/no-op override instead of merely
omitting the bundled rule.

**Headless CI is blocked:** Prefer a non-production CI target and rehearsals.
In deterministic mode, intentional unattended confirmation can use the
documented operator control with audit output. Jev confirmations require a
human and block without UI, even when those controls are set.

**Jev calls fail or ask too often:** Inspect status and `/sf-guardrail audit`
for endpoint, credential, deadline, identity, or incomplete-context failures. Metadata
privacy can increase confirmations when operation effects depend on withheld
content. Revalidate model identity changes and measure failures and extra
confirmations in the acceptance report; switching engines is an explicit
preference change.

**Audit is empty after resume:** Decisions belong to the active session file.
Confirm that the resumed branch is the one that recorded the decision.

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
