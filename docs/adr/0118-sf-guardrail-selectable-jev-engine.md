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

Use Node's built-in `fetch` to call OpenRouter Decisions with one Choice
question named `risk` and options `allow`, `confirm`, and `block`. Request
`typesafe/jev-1.13`; initially require resolved model
`typesafe/jev-1.13-20260917` and provider `TypeSafe`. Read
`OPENROUTER_API_KEY`, otherwise the explicit `OPENROUTER_API_KEY_FILE`.
Apply a 1,500 ms total classification deadline, cancellation, bounded parsing,
and no retries. Invalid supplied configuration, missing credentials, malformed
metadata/responses, API failures, cancellation, deadline expiry, and identity
drift prevent execution with audit. Registration and startup make no live
requests.

Send bounded operation metadata, effective policy, and independently resolved
facts. Keep raw tool arguments, file bodies, Apex/scripts, query text, Canvas
contents, credentials, transcripts, fetched contents, and full browser pages
or forms local. Missing descriptions, unsupported shell grammar, dynamic
paths, omitted literals, and unresolved effects remain explicit uncertainty.
Tool descriptions and input-derived metadata cannot establish approval
authority. Omitted content does not prove that a custom pattern is absent.

A complete-context `allow` with `P(allow) >= 0.99` may automatically execute;
other valid allow predictions require human confirmation. A model `block`
is an unapprovable hard block. The threshold is a conservative initial
default requiring domain evaluation. Jev confirmations cannot use Power Tool
Mode, operator auto-approval, or headless escape hatches. Headless confirms
block. Existing local confirmation UI and audit handle all outcomes.

Jev session approval is available only for a complete exact call against a
currently verified non-production org. Construct its fingerprint locally
from the full canonical original input, tool, working directory, verified
target, engine, policy/protocol hash, and model identity. Changed withheld
content invalidates approval without being sent to the provider. Deterministic
grants cannot transfer; production, unknown, external, and opaque operations
remain allow-once. Recheck cancellation and engine/policy identity before
releasing execution.

## Consequences

- Exact protected paths and block patterns become model interpretations in
  Jev mode and lose their deterministic matching guarantee. Passing a finite
  acceptance set does not restore that guarantee.
- Metadata privacy can increase confirmations for content-dependent effects.
  Failures, omitted information, and extra prompts stay visible in audit and
  evaluation reports instead of silently allowing calls.
- Normal configuration stays deterministic while Jev is evaluated in an
  isolated session. Acceptance requires zero unsafe automatic allows, zero
  weakened explicit blocks, correct pre-execution enforcement, and no outbound
  payload leakage. Diagnostic replay and frozen acceptance results are
  reported separately, retaining failed calls in the denominator.
- Measure end-to-end p50/p95 latency, failures, extra confirmations, and billed
  cost against the 500 ms p95 target. Safety or performance gate failures leave
  normal use on the deterministic engine.
- The integration adds only metadata/fact preparation, one HTTP client, and a
  decision adapter. Model/provider changes require explicit revalidation;
  startup has no credential or live-network requirement.
