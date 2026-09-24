---
id: "0118"
status: accepted
date: 2026-09-23
---

# ADR 0118: SF Guardrail supports a selectable TypeSafe Jev engine

## Context

SF Guardrail already separates risk decisions from Pi execution blocking,
human confirmation, approval memory, and audit. Hosted TypeSafe Jev offers a
small decision interface that can replace local risk matching without adding
model training, native workers, or a second approval system. The local Gemma
C11 experiment is a design reference; its diagnostic accuracy and latency do
not qualify a different hosted model for enforcement. Its recorded unsafe
automatic allows also prevent transferring its qualification state or cutoff.

## Decision

Add `sfPi.guardrail.engine` with `deterministic` as the default and `jev` as an
explicit preference. The Manager settings and
`/sf-guardrail engine deterministic|jev` select the same engine. Jev mode
branches before deterministic normalization and classifies every Pi
`tool_call`, including reads, dry runs, and unfamiliar tools. It interprets
the effective policy after bundled defaults, stable-id overrides, and routine
settings. It has no automatic deterministic fallback.

Use Node's built-in `fetch` to call the configured HTTPS Decisions provider.
Independent action questions within a call share one state. Their options are `allow`,
`confirm`, and `block`. Wire state version stays 6. Every tool request asks `risk` with tool-family guidance about
operational effects. Available paths/file facts add file policy; parsed shell
calls add command policy and structurally possible org policy. Complete known
executable/wrapper heads narrow the projected org rules; incomplete/opaque
heads, withheld comments, or missing commands retain every org entry. Jev
decides full rule applicability, flags, org types, ordering, and behaviors.
The risk question judges executable effects; matching blocks belong to the
independent policy questions. Relevant custom non-Salesforce org AST heads
also require fresh org observations; unknown observations remain explicit.
Disclosure follows possible tool-specific data effects and observed runner
execution semantics, and remains included for incomplete shell metadata.
Authority is browser-only; unknown effects on
other tools stay in risk/disclosure and the completeness gate. Exact
`sf_browser_press` key `Escape` is target-independent cancellation, still
evaluated by risk and authority without requiring org or fresh target/focus
facts; the request does not fabricate browser freshness. There are at
most six action answers. Structural question/state applicability does not decide an
outcome. Every answer is model-authored;
Jev is the sole risk engine in its selected mode, without a deterministic floor.
Hosted browser facts omit only the changing `ageMs` value. Actual freshness
status and target fields remain. Local snapshot identity, age, expiry and
changed-context checks remain. No snapshot lifetime is extended.
Request `typesafe/jev-1.13` with routing `only: ["typesafe"]` and
`allow_fallbacks: false`; initially require resolved model
`typesafe/jev-1.13-20260917` and provider `TypeSafe`. Require an explicit
`SF_GUARDRAIL_JEV_ENDPOINT`. There is no default endpoint. The URL must use
HTTPS with no embedded credentials, query, or fragment. Read
`SF_GUARDRAIL_JEV_API_KEY`, otherwise `SF_GUARDRAIL_JEV_API_KEY_FILE`.
Check the endpoint before reading a key. The gateway must implement the pinned
Jev Decisions contract with independent Choice answers and required usage fields.
Keep endpoint URLs, key values, and key paths out of UI, status, audit, and
request bodies. Reject redirects.
Protocol 15 uses three actual calls for Bash. First ask the applicable action
questions except command policy. Then ask `match` or `no_match` for each
active command row. Finally ask command policy with the actual syntax
answers. An empty active row list omits the syntax call. Do not skip a later
requested call because an earlier answer blocks. Other tools use one strict
call for all applicable action questions. Include command policy for a tool
with shell metadata. The host supplies facts and combines actual answers.
It does not match a rule, choose a policy winner or add a deterministic vote.

Apply one 10,000 ms total limit from preparation through automatic release.
Facts, all calls, response reads, validation and synchronous cleanup count.
No stage may reset that limit. Cancel without waiting for asynchronous
cleanup. Use bounded parsing and no retries. A later explicit human approval
uses a separate 1,500 ms check of the current context. It does not repeat the
model process. Invalid supplied configuration, missing endpoint or credentials, malformed
metadata/responses, API failures, cancellation, deadline expiry, and identity
drift prevent execution with audit. Registration and startup make no live
requests.

Send bounded operation metadata, the minimum effective policy relevant to the
questions, and independently resolved facts. Known CLI metadata, trusted
file-path variants, verification state, and numeric buckets describe effects
without supplying a local policy decision. Mechanical request-local integer
IDs preserve original, wrapper-expanded, and flat command tokens, quoted-token
boundaries, typed prefix classes, and Pi argument sequences. State version 6
uses command-token version 2: effective ordered command lists contain only
active rows with explicit behavior, token IDs, and seven special forms. Validate
and bound every configured row before omission; off allow/deny entries allocate
no token classes. Off ordinary entries become separate `effectWaivers` for exact
model risk/disclosure matching of that configured effect. They never override
active file, command, or org restrictions or become allow exceptions. Preserve
the file rule's enabled off-winner precedence and org rule's matching off
outcome stopping later rules for that command. Static token/namespace/special
definitions live in shared `policy.commands.matchGrammar`, directly visible to
every independent question. Jev compares the facts and selects rules; the host serializes them and
combines independent answers without a policy vote. `publicSyntax` associates
only known CLI executables, subcommands, and flag keys already exposed in
semantic metadata with the same IDs. Private operands receive no explicit
legend. Raw commands, private-word dictionaries, stable hashes, matched rules,
and local outcomes are excluded. Equality and known policy anchors can still
reveal membership; this does not provide
cryptographic secrecy or a deterministic model-matching guarantee.
This separates supporting
[state](https://docs.typesafe.ai/concepts/state) from independently evaluated
[questions](https://docs.typesafe.ai/primitives/choice). Keep raw tool
arguments, file bodies, Apex/scripts, query text, Canvas
contents, credentials, transcripts, fetched contents, and full browser pages
or forms local. Missing descriptions, unsupported shell grammar, dynamic
paths, omitted literals, and unresolved effects remain explicit uncertainty.
Tool descriptions and input-derived metadata cannot establish approval
authority. Omitted effect content does not prove that a custom pattern is
absent. Private command values/comments retain exact policy equality through
token IDs; withholding their spelling does not create a match. Genuinely
unresolved policy restrictions remain model confirm/block criteria.

The action projection repeats public selector names from the operation's
exact `publicSyntax` ID map. The Bash syntax call puts those names in a
separate ordered list. It maps each integer ID to one distinct alphabetic
label. Preserve every command sequence, selector field, quoted boundary and
prefix namespace. Each question states its selector. Shared grammar defines
exact equality, order and adjacency. A null name is not a wildcard.
Vocabulary membership does not establish a token observation. The local
manifest still binds original rows and integer IDs. Add no vocabulary or
matched-rule facts. File and org criteria state
eligibility, exemptions, order, and tool access directly. Bind the templates
and label rules in the protocol hash. Old protocol grants cannot approve a
call under the new hash. These changes preserve sole model authority.

Observe execution flags from exact dispatch branches: `dryRun` is honored,
ignored, or unknown; `effectiveDryRun` is supplied only for an honored branch;
and `planningOnly` identifies exact non-executing branches. Agent Script
publication and Data 360 cleanup, CSV ingest, and manifest runs ignore supplied
dry-run intent and can execute despite it. Jev evaluates these mechanical
runner facts. An honored dry run skips the selected business-write branch
while prerequisite reads may still occur; supplied intent or an action-name suffix alone cannot prove a
preview or grant permission.

Capture one exact setting from `SF_GUARDRAIL_JEV_OPERATING_POINT` before
facts. `conservative` is the default. Its raw action allow limit and selected
syntax limit are both `0.99`. Explicit `argmax` uses zero for both limits.
Reject unknown names, custom limits and invalid point objects. Bind the
validated point hash into protocol, connection, exact approval and audit.
Recheck the point before release. Neither setting has joint calibration or
safety qualification. The user chose coverage tests with slower responses.

Automatically execute only with complete context and every requested action
choosing `allow` and meeting the captured probability limit. Syntax answers
must meet the selected syntax limit. Any model `block` is an unapprovable
hard block; any `confirm`, allow probability below the cutoff, or incomplete
context requires human confirmation. Audit each answer's choice, probabilities,
and confidence. Top-level probability/confidence evidence remains the actual
`risk` answer; it does not pretend to be a combined safety statistic. Keep
each Bash stage's actual reply, origin and syntax transcript. Do not give
collected answers one provider request ID. Retain a fully validated reply
after a later failure and keep the final result blocked. The conservative
threshold is an initial default requiring evaluation against our
own domain labels, following TypeSafe's
[confidence guidance](https://docs.typesafe.ai/confidence).
Preserve returned probability values rather than renormalizing them. Accept an
exactly normalized distribution within numeric tolerance, or a two-decimal
distribution whose clipped closed half-cent intervals admit normalization.
Two-decimal values, the interval convention, and the small floating point
tolerance are explicit client compatibility assumptions. Validate the behavior
of the configured provider. Other
unnormalized distributions remain invalid. Bind this response-validation
contract into the protocol hash to invalidate grants when validation changes.
Jev confirmations cannot use Power Tool
Mode, operator auto-approval, or headless escape hatches. Headless confirms
block. Existing local confirmation UI and audit handle all outcomes.

Jev session approval is available only for a complete exact call against a
currently verified non-production org. Construct its fingerprint locally
from the full canonical original input, tool, working directory, verified
target, engine, policy/protocol hash, model identity, and local transport hash.
The transport hash binds endpoint, model, provider, and routing without storing
endpoint text. A changed connection invalidates approval. Changed withheld
content invalidates approval without being sent to the provider. Deterministic
grants cannot transfer; production, unknown, external, and opaque operations
remain allow-once. Recheck cancellation and engine/policy identity before
releasing execution. Reusable grant memory changes only after persistence
and audit recording succeed; failures cannot leave reusable approval behind.

## Consequences

- Exact protected paths and block patterns become model interpretations in
  Jev mode and lose their deterministic matching guarantee. Passing a finite
  acceptance set does not restore that guarantee.
- The selected sole-model design requires direct comparison with the actual
  deterministic Safety Kernel. The configured Decisions gateway must satisfy
  the pinned model and independent Choice contract. Provider examples or
  general model benchmarks do not establish qualification for this integration.
- Metadata privacy can increase confirmations for content-dependent effects.
  Failures, omitted information, and extra prompts stay visible in audit and
  evaluation reports instead of silently allowing calls.
- Normal configuration stays deterministic while Jev is evaluated in an
  isolated session. Acceptance requires zero unsafe automatic allows, zero
  weakened explicit blocks, correct pre-execution enforcement, and no outbound
  payload leakage. Diagnostic replay and frozen acceptance results are
  reported separately, retaining failed calls in the denominator.
- Measure end-to-end p50/p95 latency, failures, extra confirmations and reported
  cost. Keep the 500 ms p95 target as a performance reference. The staged hook
  has one total 10-second bound under the selected coverage-first requirement.
  Normal use stays deterministic while Jev remains unqualified.
- Freeze the source, decoder, score plan and exact probability setting before
  provider tests. Report every attempted case. Keep finite development
  coverage, actual tool execution and independent qualification separate.
  Prior 1,500 ms or one-call measurements do not qualify this staged source.
- The frozen 175-case DEV fixture covers all 74 bundled rule IDs, six
  native-tool families, and ten additional risk cases. Its inputs/gold were
  frozen before predictions (`81d8199c` hash prefix): 32 allow, 132 confirm,
  and 11 block. The actual deterministic baseline yields 42 allow, 122 confirm,
  and 11 block. Compare safe-call coverage, unsafe allows, weakened blocks,
  extra confirmations, failures, latency, and cost separately. Mock org facts
  and isolated local file/browser observations support development evidence;
  operations never execute. Record each run's protocol identity separately;
  earlier protocol measurements do not establish a revised protocol's
  behavior. This set is not held-out qualification. Existing
  hosted qualification remains false, and improvement claims require recorded
  hosted measurements.
- The integration adds only metadata/fact preparation, one HTTP client, and a
  decision adapter. Model/provider changes require explicit revalidation;
  startup has no credential or live-network requirement.
