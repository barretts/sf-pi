# Agent Script Quality Rules

This document is the v1 contract for native Agent Script static quality analysis in SF Pi. It complements compilation, preview, eval, and org preflight; it does not replace them.

## Boundaries

- The official `@sf-agentscript/*` parser and Agentforce schema are the only language source of truth.
- Quality analysis evaluates one `.agent` file at a time.
- A severity-1 compiler diagnostic determines compile validity. Quality findings never rewrite compiler severity.
- V1 contains universal rules only. Organization-specific security and action policy are deferred.
- Unknown AST, dialect, target, or flow semantics are skipped and reported as unverifiable where material.
- The analyzer returns status, severity counts, findings, and metrics—never a numeric quality score.
- Every canonical rule has a global-only On/Off setting under `sfPi.agentScript.quality.rules`; project settings cannot override it.
- Disabled rules do not execute, report, repair, compute metrics, or gate publication, and every result discloses effective coverage.
- V1 quality rules provide suggestions and related evidence but no new engine-applied quick fixes; existing official quick fixes remain unchanged.

## Lifecycle

```text
write/edit
  → compile + proven hardening diagnostics

agent settles
  → Recommended quality pass
  → High/Moderate findings may steer a progress-gated repair pass

inspect/quality
  → local quality result

inspect/review
  → compile + quality + deployment/org readiness

lifecycle publish from local file
  → compile gate
  → quality publication gate
  → optional explicit session-scoped override
  → publish
```

Clean, Low, Info, and metric-only settled results remain human-visible as durable quality cards without entering LLM context. New High/Moderate signatures send a separate hidden `sf-agentscript-quality-repair` custom message with compact structured repair instructions; the visual card is never parsed back into an LLM prompt. Collapsed cards show every finding header by default, while expansion adds messages, suggestions, and evidence. High and Moderate findings are explicitly recommended for resolution before activation.

## Flow projection

The SF Pi flow projection derives these edge classes from the official AST.

| Edge class                    | Meaning                                              | Cycle confidence                                 |
| ----------------------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Deterministic transition      | One-way transition executed by procedure logic       | High only when every cycle edge is unconditional |
| Planner-selected transition   | One-way transition exposed as a reasoning tool       | Advisory                                         |
| Returning subagent delegation | Direct subagent tool call that returns to its caller | Advisory                                         |
| Connected-agent invocation    | Invocation or handoff to another agent               | Unverifiable across unavailable source           |

Every edge records its source component, destination, edge class, condition/gate when statically available, and source range. Graph algorithms use `@dagrejs/graphlib`.

## V1 catalog (20 items)

### High

High rules participate in the publication gate and cannot be suppressed inline.

| Human name                                   | Rule ID                                | Contract                                                                                                                                                                          |
| -------------------------------------------- | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Endless Transition Loop                      | `unconditional-transition-cycle`       | Report a cycle made entirely of unconditional deterministic one-way transitions. Conditional, planner-selected, delegation, and unavailable connected-agent edges do not qualify. |
| Deterministic Action Cannot Use Slot Filling | `slot-filling-in-deterministic-action` | Reject `...` in every deterministic `run`, including procedure and chained runs. Planner-selected reasoning-action inputs remain eligible for slot filling.                       |
| Required Action Input Is Missing             | `deterministic-action-missing-input`   | A deterministic run must bind every input that is required, has no declaration default, and is known from the scoped action signature.                                            |
| Unknown Action Input                         | `deterministic-action-unknown-input`   | Every deterministic `with` parameter must exist in the scoped action signature. Safe typo suggestions are allowed; cascade reporting is controlled.                               |
| Action Chain Is Too Deep                     | `action-chain-too-deep`                | Allow one follow-up action in an action callback; reject a further nested `run`. Report only the first unsupported nested level.                                                  |
| Variable Description Is Too Long             | `variable-description-max-length`      | Report variable descriptions over Salesforce's 255-character publication limit. A description of exactly 255 characters is valid.                                                 |

### Moderate

| Human name                               | Rule ID                                     | Contract                                                                                                                                                                                    |
| ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unreachable Subagent                     | `unreachable-subagent`                      | Report a non-start subagent with no supported incoming transition or returning-delegation edge. Skip custom variants with unknown routing semantics.                                        |
| Unused Action                            | `unused-action`                             | Report an action definition with no scoped deterministic run, reasoning-action binding, or supported chain reference. Skip unknown invocation semantics.                                    |
| Discarded Prompt                         | `discarded-prompt-before-transition`        | Report prompt content guaranteed to be discarded by a deterministic transition on the same path.                                                                                            |
| Wrong Value Type in List                 | `list-element-type-mismatch`                | Check literal elements against a known `list[type]` declaration. Allow empty lists and `None`; skip dynamic and unknown expressions.                                                        |
| List Index Must Be a Number              | `non-numeric-list-index`                    | Report a statically nonnumeric index applied to a statically known list. Accept known number/integer/long values and skip unknowns.                                                         |
| Slot-Filled Variable Needs a Description | `slot-filled-variable-missing-description`  | A variable targeted for LLM assignment through `@utils.setVariables` must have a description. Do not require descriptions for every variable.                                               |
| Wrong Action Input Type                  | `deterministic-action-input-type-mismatch`  | Apply the official conservative action-input compatibility behavior to deterministic runs, using only known literal and variable types.                                                     |
| Wrong Action Output Type                 | `deterministic-action-output-type-mismatch` | Apply the official conservative output-to-variable compatibility behavior to deterministic runs; leave undefined-output diagnostics to upstream reference resolution.                       |
| Instruction Template Syntax              | `instruction-template-syntax`               | Promote the official compiler/LSP instruction interpolation diagnostic into quality without duplicating its evaluator.                                                                      |
| Prompt Template Output Flags             | `prompt-template-output-flags`              | Advise when a prompt-response output lacks the planner/display flags needed for the common planner-consumes/intermediate-output pattern. This is quality guidance, not edit-time hardening. |

### Low

| Human name               | Rule ID                    | Contract                                                                                                                                         |
| ------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Action Before Transition | `action-before-transition` | Advise that an action executes before a guaranteed transition and may add cost or side effects. Do not flag state assignments before transition. |

### Info

| Human name                  | Rule ID                        | Contract                                                                                                                                 |
| --------------------------- | ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Conditional Transition Loop | `conditional-transition-cycle` | Show a transition cycle containing one or more conditions, including statically available predicates, without claiming an infinite loop. |
| Subagent Call Cycle         | `subagent-delegation-cycle`    | Show a cycle composed through returning subagent calls without treating it as a deterministic transition loop.                           |

### Metric

| Human name            | Rule ID                 | Contract                                                                                                                                                                         |
| --------------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cyclomatic Complexity | `cyclomatic-complexity` | For each executable procedure, calculate `1 + IfStatement + TernaryExpression + short-circuit and/or`. Subagent and file totals are informational. V1 has no blocking threshold. |

## Procedure boundaries for complexity

A procedure is one independently executable logic region, including:

- `reasoning.instructions`;
- `before_reasoning`;
- `after_reasoning`;
- connected-agent `after_response`;
- supported custom-subagent lifecycle procedures.

Prompt text, an action definition, a reasoning-tool collection, an entire subagent, and an entire file are not procedures.

PMD's published orientation bands can be displayed for context—1–4 low, 5–7 moderate, 8–10 high, 11+ very high—but v1 records raw per-procedure values and establishes a representative corpus before adopting a threshold.

## Suppression

Rules marked suppressible can be suppressed for the next applicable source element. `instruction-template-syntax` remains non-suppressible because its official compiler/LSP diagnostic would still be present:

```agentscript
# sf-agentscript-ignore-next-line action-before-transition: audit side effect is required before handoff
run @actions.audit_handoff
transition to @subagent.billing
```

Rules:

- exactly one rule ID;
- non-empty reason after `:`;
- next applicable statement or declaration only;
- High findings and metrics cannot be suppressed;
- malformed or unused suppression comments produce visible Info evidence.

## Publication override

A High finding or quality-analysis failure pauses publication. The first attempt returns the complete evidence and an explicit recovery path. After the user approves, the override is stored only for the current session and is scoped to:

- one agent bundle; and
- the reviewed High rule IDs, or the separately disclosed `quality-analysis-failed` condition.

A newly appearing High rule requires another approval. Overrides never persist to project or global settings.

## Repair loop

Only High and Moderate findings steer an automatic post-settle repair follow-up. The loop stops when:

- the relevant `.agent` file is not edited;
- the normalized finding signature repeats;
- quality becomes clean;
- analysis fails;
- the user interrupts.

Low, Info, suppressed findings, and metrics do not trigger repair.

## Phase 0: existing local diagnostics

Before adding the v1 catalog, clean up the existing source-text hardening layer.

### Remove

- `run-in-after-reasoning` — official documentation supports actions in `after_reasoning`.
- `connection-messaging-route-name-prefix` — current public examples use a plain flow API name.
- `action-missing-outputs` — current action outputs are optional; any narrower publish failure must be reproven.

### Defer pending current runtime proof

- `connection-messaging-incomplete-route` — upstream owns route-name/type pairing; any stronger escalation-message requirement needs separate evidence.

### Migrate to official AST passes with parity tests

- `apex-target-method-suffix`;
- `target-ref-looks-like-id`;
- `employee-agent-connection-messaging`;
- `employee-agent-escalate`;
- `inputs-out-of-scope`;
- `outputs-out-of-scope`.

### Reclassify

- `prompt-template-output-flags` moves from edit-time hardening to the Moderate quality catalog.

Delete the text scanner only after every retained diagnostic has source-range and malformed-source parity evidence.

## Released-package parity handoff

The Milestone 4 matrix in `docs/DIAGNOSTIC_PARITY.md` compares every current quality rule and hardening diagnostic against the installed official package set using full diagnostic and quick-fix snapshots. At the 2026-08-03 baseline, no current evaluator has strict parity, so no current evaluator is deleted. Similar planner-action diagnostics do not replace deterministic-`run` policy.

## Deferred candidates

- direct list/object assignment restrictions, pending reproducible current runtime evidence;
- read-before-initialization, pending a cross-turn state model;
- semantic description quality and overlap;
- organization-specific mutating/sensitive action policy;
- router breadth thresholds;
- negative list-index behavior;
- deep object-shape compatibility;
- project-wide aggregation and cross-bundle connected-agent analysis;
- Salesforce Code Analyzer ESLint adapter.

## Grounding

- Agent Script language and flow: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-lang.html
- Agent Script flow of control: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-flow.html
- Subagent transitions: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-patterns-transitions.html
- Agent router strategies: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-patterns-topic-selector.html
- Actions reference: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-ref-actions.html
- Tools and subagent delegation: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-ref-tools.html
- Variables reference: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-ref-variables.html
- Variable and slot-filling patterns: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-patterns-variables.html
- List-variable patterns: https://developer.salesforce.com/docs/ai/agentforce/guide/ascript-patterns-var-list.html
- Open-source Agent Script specification: https://github.com/salesforce/agentscript/blob/main/SPEC.md
- PMD cyclomatic complexity: https://docs.pmd-code.org/latest/pmd_rules_apex_design.html#cyclomaticcomplexity
