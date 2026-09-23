# SF Guardrail

SF Guardrail is the safety context for mediating risky agent actions in SF Pi. It exists to keep Salesforce-oriented work safe without turning the extension into a general-purpose policy platform.

## Language

**SF Guardrail**:
The **Bundled Extension** that mediates agent tool calls in the **Pi Runtime** through a selectable **Guardrail Engine**, while SF Pi owns blocking, human approval, approval memory, and audit.
_Avoid_: generic guardrails, policy platform, security scanner, Salesforce org policy engine

**Guardrail Engine**:
The selected risk-classification implementation under `sfPi.guardrail.engine`: **Deterministic Engine** by default, or the explicitly selected **Jev Engine**. The Manager preferences and `/sf-guardrail engine deterministic|jev` expose the same choice. Failures cannot silently switch engines.
_Avoid_: fallback chain, model discovery, automatic migration

**Deterministic Engine**:
The existing local rule implementation that matches file, command, org-aware, and known native-mutation risks through the **Safety Kernel**.
_Avoid_: Jev backup, hidden second vote, model safety guarantee

**Jev Engine**:
The opt-in sole risk engine that classifies every Pi `tool_call` using TypeSafe Jev through OpenRouter Decisions. Jev interprets all effective policy in this mode, including protected paths, exact blocks, and custom patterns. Exact rules lose their deterministic matching guarantee; SF Pi still enforces the model answers and human approval locally. There is no deterministic risk floor or fallback.
_Avoid_: qualified replacement, calibrated safety score, deterministic model policy

**Jev Decision Questions**:
Protocol v5's independent Choice questions sent in one request against the same state, each choosing `allow`, `confirm`, or `block`. Every call asks `risk` about executable/operational effects using tool-family guidance; matching block restrictions belong to policy questions. File paths add file policy; parsed shell calls add command policy and structurally possible org policy. Complete known executable/wrapper heads narrow the projected org rules; opaque/incomplete heads, withheld comments, or missing commands retain all of them. Disclosure follows tool-specific possible data effects and mechanical runner execution facts, with incomplete shell effects retaining the question; authority is browser-only. Exact `sf_browser_press` key `Escape` remains risk- and authority-evaluated target-independent cancellation without requiring org or fresh target/focus facts or fabricating freshness. At most six model-authored answers supply all risk/policy judgments; structural applicability does not decide an outcome.
_Avoid_: sequential model chain, deterministic policy vote, combined confidence

**Operation Metadata**:
The bounded tool identity, operation, flags, paths or destinations, execution intent, and locally resolved facts sent to Jev with the minimum effective policy relevant to the questions. Known CLI structure, trusted file-path variants, and bounded numeric observations describe effects without a local policy verdict. File bodies, scripts/Apex, query text, Canvas content, credentials, transcripts, fetched contents, raw arguments, and full browser pages/forms stay local. Withheld or unresolved effects are explicit uncertainty; hidden custom-pattern literals cannot be presumed nonmatches. Command literal equality is retained by the **Command Token Projection**, without spelling disclosure or a local policy vote.
_Avoid_: raw payload, full context, content inspection, implicit nonmatch

**Command Token Projection**:
Mechanical integer IDs for original, wrapper-expanded, and flattened command tokens, typed prefix classes, and Pi argument sequences. Full ordered policy rows carry explicit behavior and token IDs or one of seven special-pattern forms. Jev compares these facts and chooses rules. `publicSyntax` maps only known CLI executables, subcommands, and flag keys already exposed in semantic metadata to IDs. Private operands have no explicit legend; the projection includes no raw command, private-word dictionary, stable hash, matched rules, or local outcome. Equality and known policy anchors can reveal membership; they provide neither cryptographic secrecy nor a deterministic model-matching guarantee.
_Avoid_: encrypted command, anonymization guarantee, host policy matcher, precomputed verdict

**Jev Automatic Allow**:
Complete operation context with every requested model answer choosing `allow` and `P(allow) >= 0.99`. Any answer choosing `block` is a **Hard Block**; any `confirm`, allow probability below the cutoff, or incomplete context requires human confirmation. The initial probability cutoff is conservative and requires evaluation against our domain labels; it is not a qualification claim.
_Avoid_: guaranteed safe, confidence-based approval, local C11 qualification

**Jev Answer Evidence**:
The individual model-authored choices, probability distributions, and confidence values preserved in audit. Top-level probabilities and confidence are the actual `risk` answer, even when a different question determines the enforced outcome. They are not a combined probability of safety.
_Avoid_: synthesized confidence, aggregate calibration claim, threshold as security guarantee

**Safety Mediator**:
The product posture where **SF Guardrail** evaluates risky agent actions and returns a clear allow, block, or human-approval decision. It is opinionated and narrow rather than a configurable policy platform.
_Avoid_: policy engine, governance framework, rule marketplace, shell sandbox

**Known-Surface Mediation**:
The safety posture where **SF Guardrail** mediates risky action surfaces that SF Pi owns, observes, and can classify in the **Pi Runtime**, without claiming to sandbox every possible local, shell, external, manual, or future mutation path. SF Pi should not add first-party semantic write surfaces that bypass this mediation.
_Avoid_: complete mutation sandbox, universal write prevention, guaranteed no mutation

**Rule Behavior**:
The per-rule setting that describes whether a risk is off, human-confirmable, or a non-overridable hard block. The settings UI presents these as Off, Ask me, and Block. The deterministic engine matches it locally; the Jev engine interprets it as policy context.
_Avoid_: enabled flag, theme, policy mode

**Safety Kernel**:
The pure decision module that evaluates a **Safety Subject** and returns a **Guardrail Decision** without performing Pi Runtime UI, session, or persistence side effects.
_Avoid_: event handler, policy engine, approval manager, command panel

**Guardrail Decision**:
The outcome of evaluating a risky agent action: allow, block, or ask for **Human-in-the-Loop Approval**.
_Avoid_: policy result, security verdict, scan finding

**Safety Subject**:
The thing being attempted by an agent action, such as file access, a shell command, a native SF Pi tool operation, or a Salesforce org-sensitive operation.
_Avoid_: raw tool call, command blob, policy input

**Native Tool Safety Subject**:
A **Safety Subject** normalized from an LLM-callable SF Pi tool rather than from a shell command or file path. It captures the attempted operation, target org or external destination when relevant, operation family, risk-relevant target details, and an input fingerprint so the **Safety Kernel** can return a normal **Guardrail Decision**.
_Avoid_: per-extension approval system, model approval flag, native policy layer, tool self-approval

**MCP Tool Safety Subject**:
A **Native Tool Safety Subject** normalized from an `sf-mcp` MCP tool execution. `sf-mcp` supplies MCP server identity, tool identity, operation family, known Salesforce org or external destination, risk annotations, and argument fingerprint; SF Guardrail decides the resulting **Guardrail Decision**.
_Avoid_: MCP approval helper, server trust flag, raw MCP payload approval, duplicate approval ledger

**High-Value Durable Mutation**:
A first-party, LLM-callable operation that can persistently change Salesforce org state, Data 360 resources, externally visible collaboration content, or another durable system of record under the user's authority. Mutation alone is not the risk; the risk is a native semantic write path where the model could otherwise self-approve a specific durable change. Ordinary local source edits are not high-value durable mutations; they become externally durable only when a separate deploy, publish, save, or execute operation applies them to a system of record.
_Avoid_: all mutation, local edit, browser draft state, read-only probe, dry run

**Risk Gate**:
A narrow safety check that explains why a **Safety Subject** is risky, such as protected file access, a dangerous local command, or a production-sensitive Salesforce operation.
_Avoid_: rule engine, detector, scanner

**Native Tool Risk Registry**:
The deterministic-engine registry of classifiers for bundled SF Pi native tools. Each classifier normalizes a known **High-Value Durable Mutation** into a **Native Tool Safety Subject** so the existing **Safety Kernel**, **Safety Envelope**, **Approval Ledger**, and **Human-in-the-Loop Approval** flow can handle it consistently. Those classifiers ignore read-only actions, dry runs, local diagnostics, local tests, and pre-commit browser draft state. Jev mode classifies all tool calls before this registry.
_Avoid_: per-extension approval helper, policy marketplace, tool-specific HITL layer, agent-callable approval API, all-native-tool gating

**Committing UI Gesture**:
A browser action that attempts to persist or submit Salesforce UI state, such as Save, Apply, Submit, Activate, Assign, Delete, or an Enter key that submits a form. The deterministic engine mediates committing gestures; Jev mode also classifies metadata for pre-commit interactions.
_Avoid_: any browser interaction, field edit, visual navigation, snapshot

**Safety Envelope**:
The exact scope covered by an allow decision, such as the risk gate, project, verified org identity, operation family, session path, and safety-relevant target details.
_Avoid_: approval scope, blanket allow, trust mode, bypass, global allowlist

**Org-Aware Gate**:
A **Risk Gate** whose decision depends on the resolved Salesforce org identity and detected org type for a shell command.
_Avoid_: production detector, deploy blocker, org policy engine

**Detected Org Type**:
The Salesforce org type SF Guardrail receives from SF Pi's Salesforce environment detection: scratch, sandbox, developer, trial, production, or unknown.
_Avoid_: demo type, training type, name-based environment guess

**Unknown Org**:
A target org whose type cannot be verified from the available Salesforce/Core org facts. SF Guardrail treats it as production for risky operations.
_Avoid_: assume sandbox, infer from alias name, demo org guess

**Operation Family**:
A small, named class of related actions that may share an approval in deterministic mode when the rest of the **Safety Envelope** is unchanged, such as Salesforce metadata deploys to one verified org. Jev session approval covers an exact call, not a family of calls.
_Avoid_: arbitrary command prefix, broad tool permission, workflow

**Human-in-the-Loop Approval**:
The explicit user confirmation step used when a **Guardrail Decision** cannot be safely allowed or hard-blocked. The approval asks the user to accept a **Safety Envelope**, not to grant general trust.
_Avoid_: silent approval, background prompt, exception

**User Intent Boundary**:
The point where a human accepts a specific **Safety Envelope** before an AI-mediated **High-Value Durable Mutation** proceeds, or a configured operator authority accepts it in deterministic mode. Jev confirmation requires a human. It complements Salesforce, Slack, Data 360, and operating-system authorization; it does not replace those systems.
_Avoid_: permission check, authz replacement, user authentication, blanket consent

**Execution Intent Flag**:
A model- or tool-supplied parameter that declares the requested operation is intentionally live or mutating, such as `allow_mutation`, `allow_confirmed`, `mutation`, or `dry_run=false`. It helps classify risk and reject accidental mutation, but it is not approval. Supplied dry-run intent alone cannot prove a preview; **Runner Execution Facts** establish how the actual tool treats it. Approval comes from **Human-in-the-Loop Approval**, an existing **Session Approval**, or explicit operator-approved headless mode in the deterministic engine.
_Avoid_: approval flag, self-approval, bypass flag, trust parameter

**Runner Execution Facts**:
Mechanically observed tool-branch semantics under `executionFlags`: `dryRun` is honored, ignored, or unknown; `effectiveDryRun` is supplied only for an honored branch; and `planningOnly` identifies exact non-executing branches. An honored dry run skips the selected business-write branch while prerequisite reads may still occur. Agent Script publication ignores dry-run intent, as do Data 360 cleanup/CSV-ingest/manifest run branches. These facts describe execution without deciding risk or granting permission.
_Avoid_: supplied flag as preview proof, local risk decision, tool self-approval

**Approval Ledger**:
The seam that records **Guardrail Decisions** and manages **Session Approvals**, **Persisted Approval Grants**, revocations, and recent decision reads for **Safety Envelopes**.
_Avoid_: audit helper, allowlist, approval store, grant manager

**Session Approval**:
A branch/session-scoped approval that suppresses repeated prompts for the same **Safety Envelope** during the current Pi session path. It is appropriate only when the envelope describes a stable bounded operation; arbitrary-code, raw-REST, UI-ref-based, external-content, destructive, production, or unknown-org operations should stay exact or allow-once.
_Avoid_: timed grant, permanent allow, global trust, hidden bypass

**Jev Exact-Call Session Approval**:
A **Session Approval** available only for a complete call against a currently verified non-production org. Its locally computed fingerprint binds the full canonical original input, tool, working directory, verified target, engine, policy/protocol hash, and model identity. Changing withheld content invalidates approval without sending it to Jev. A grant enters reusable memory only after persistence and audit recording succeed. Deterministic grants do not transfer; production, unknown, external, and opaque calls remain allow-once.
_Avoid_: family grant, path prefix approval, payload-independent approval

**Stable Bounded Operation**:
A risky action whose **Safety Envelope** can be described in durable domain terms, such as the same verified org, project, agent, operation family, and resource identity, without depending primarily on arbitrary payload text or short-lived UI references.
_Avoid_: broad workflow, arbitrary payload approval, blanket session trust

**Session-Scoped Approval Envelope**:
A **Safety Envelope** that has been accepted by the human for the current Pi session path only. It replaces wall-clock approval grants as the preferred way to reduce prompt fatigue.
_Avoid_: minute-based grant, persisted allow, trust mode

**Persisted Approval Grant**:
A deprecated user-local, TTL-bound approval that could suppress future prompts outside the current session.
_Avoid_: permanent allowlist, trust mode, project policy

**Fail-Closed Outcome**:
The safety posture where ambiguity resolves to block or human approval rather than silent allow.
_Avoid_: best-effort allow, convenience-first safety, optimistic pass

**Operator-Approved Headless Mode**:
A deterministic-engine non-interactive execution mode where confirm-class **Guardrail Decisions** may pass only because a human or operator configured an explicit environment-level opt-in before the run, currently `SF_GUARDRAIL_ALLOW_HEADLESS=1`. It is not settable by the model or tool input, is recorded in the **Guardrail Audit Trail**, and does not weaken **Hard Blocks**. Jev ignores this opt-in and blocks headless confirmations.
_Avoid_: tool-specific headless write flag, model-approved headless, CI trust mode, silent bypass

**Operator Auto-Approve Mode**:
An explicit deterministic-engine process-scoped power-user mode where confirm-class **Guardrail Decisions** are automatically allowed because an operator set `SF_GUARDRAIL_OPERATOR_AUTO_APPROVE=allow-confirm-actions-for-this-process` before launch. It is audited, does not create **Session Approvals**, and never weakens **Hard Blocks**. Jev ignores this mode and persisted Power Tool choices for confirmation decisions.
_Avoid_: model-set approval, permanent trust mode, hard-block bypass, silent bypass

**Guardrail Audit Trail**:
The session-local record of **Guardrail Decisions** and approval outcomes.
_Avoid_: telemetry, analytics, external logging

**Rehearsal**:
A safer, non-committing action used to prove intent or scope before a riskier Salesforce operation.
_Avoid_: dry run as deploy, fake execution, optional ceremony

**Advisory Recovery Guidance**:
A non-blocking instruction that helps the agent recover safely after a block or choose a safer workflow before retrying.
_Avoid_: hard gate, policy requirement, mandatory workflow

**Hard Block**:
A **Guardrail Decision** that refuses an action without asking the user because the matching deterministic **Rule Behavior** is Block or any Jev question returns a model `block`. Transport, identity, configuration, cancellation, deadline, and invalid-response failures also prevent execution.
_Avoid_: default refusal, prompt, warning, soft block

**Rule-Derived Guidance**:
The agent-visible SF Guardrail instructions generated from the effective ruleset and runtime config rather than maintained as a separate policy prompt.
_Avoid_: second rule source, hand-maintained policy prompt, duplicated safety docs

**Guardrail Context Summary**:
The compact model-visible form of **Rule-Derived Guidance** that states the Safety Mediator contract and includes only active **Hard Blocks** and non-default rule overrides needed for planning. Exact patterns, ordinary confirmation rules, and approval implementation details remain outside model context.
_Avoid_: full active rule dump, second policy source, hidden enforcement, generic safety tutorial

**Guardrail Preference**:
A normal user-facing SF Guardrail setting such as confirmation timeout, protected org aliases, or bundled-rule **Rule Behavior**. Routine **Guardrail Preferences** live in Pi settings under `sfPi.guardrail`.
_Avoid_: rule override, policy config, hidden JSON setting

**Guardrail Settings Surface**:
The user-facing settings experience for routine **Guardrail Preferences** in the SF Pi **Manager Surface**. `/sf-guardrail settings` is a compatibility/help entrypoint, not the mutable settings owner.
_Avoid_: raw rule dump, JSON editor, one-off settings hack

**Advanced Rule Override**:
An expert-level JSON customization that adds or replaces a rule in the effective ruleset by stable rule id. Advanced overrides remain separate from routine Pi settings.
_Avoid_: normal setting, policy platform, team governance system

**Project-Local Rule Override**:
A deferred form of **Advanced Rule Override** that would come from a trusted project's local configuration and affect only that project.
_Avoid_: repo-shared bypass, normal setting, automatic trust

**Mediator Surface**:
A Pi Runtime integration point where SF Guardrail observes, blocks, prompts, or reports without becoming an LLM-callable tool.
_Avoid_: guardrail tool, self-approval API, agent policy command

## Example dialogue

Developer: "The agent wants to run a production deploy. Is that blocked?"

Domain expert: "Not always. Production deploys pass through an **Org-Aware Gate** and require **Human-in-the-Loop Approval** unless the command is only a **Rehearsal**. The approval must describe the **Safety Envelope**."

Developer: "Can users configure SF Guardrail into a full policy engine?"

Domain expert: "No. The canonical posture is **Safety Mediator**. Users can tune narrow behavior, but SF Guardrail should not become a general-purpose policy platform."

Developer: "What happens if the org cannot be verified?"

Domain expert: "That is a **Fail-Closed Outcome**. The action should block or ask the human instead of silently allowing the operation."
