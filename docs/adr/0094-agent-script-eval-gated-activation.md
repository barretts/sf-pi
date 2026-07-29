# Agent Script Activation Requires Exact-Version Eval Evidence

## Status

Accepted

## Context

Agent Script compilation and native quality analysis prove source validity and deterministic static properties, but they do not prove conversational behavior. The existing lifecycle can publish and immediately activate a new BotVersion before any eval targets that exact version. A passing arbitrary or partial eval is also too weak to serve as a release contract.

## Decision

Agent Script uses an **Agent Script Release Sequence**: publication creates an inactive BotVersion, the exact target-org version satisfies the **Agent Script Release Eval Contract**, and activation occurs only as a separate final action. Immediate `publish + activate` is retired; legacy behavior is not retained as a normal path.

The release eval contract consists of an automatically generated baseline suite plus a project-designated release suite when `tests/agentforce/<AgentApiName>.eval.json` exists. Callers can provide an explicit release-spec path for repositories with another layout. The generated baseline covers evidence-backed routing, targeted actions, multi-turn state behavior, guardrail behavior, and safety probes that the current source can prove; unsupported expectations remain explicit gaps rather than guesses.

Activation evidence must match the resolved target org, exact BotVersion, current generated-baseline identity, and current designated release-spec content. Every expected test result must return without evaluator failure or step error. Evidence persists as bounded workspace artifacts and remains valid across sessions while those identities remain unchanged; no arbitrary clock expiry is added.

The **Agent Script Eval Activation Gate** blocks activation when matching evidence is missing, incomplete, or failed and returns a recoverable eval path. Emergency activation uses an explicit untested-activation intent and relies on SF Guardrail's existing **Human-in-the-Loop Approval** flow. The untested override has a distinct Safety Envelope and fingerprint from ordinary tested activation so prior session approval cannot authorize it accidentally. Headless and production behavior remain governed by Guardrail and cannot be weakened by an LLM-provided flag.

## Consequences

- A newly published behavior cannot become active through the normal lifecycle until its exact BotVersion passes the current release contract.
- New agents receive an automatic minimum regression suite, while projects can add source-controlled business expectations without a separate mapping manifest.
- Activating an existing version without matching local evidence requires a new eval or the explicit Guardrail-mediated emergency path, which also covers rollback and unavailable-source cases.
- Eval branch/artifact metadata must carry target-org identity, BotVersion identity, baseline identity, designated-spec digest, expected/returned test counts, and final pass/failure evidence.
- The quality publication gate and eval activation gate remain distinct: quality can pause publication, while behavior evidence controls activation.
