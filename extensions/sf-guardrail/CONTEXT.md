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
The optional sole risk engine that classifies every Pi `tool_call` with TypeSafe Jev through a configured **Decisions Provider**. Jev interprets all effective policy in this mode. This includes protected paths, exact blocks, and custom patterns. Exact rules lose their deterministic matching guarantee. SF Pi enforces the model answers and human approval locally. There is no deterministic risk floor or fallback.
_Avoid_: qualified replacement, calibrated safety score, deterministic model policy

**Decisions Provider**:
The configured HTTPS gateway for the pinned TypeSafe Jev model and independent Choice contract. Set `SF_GUARDRAIL_JEV_ENDPOINT` and `SF_GUARDRAIL_JEV_API_KEY` or `SF_GUARDRAIL_JEV_API_KEY_FILE` explicitly. There is no default endpoint. Local readiness checks do not send a request. The UI, status, and audit exclude the endpoint, key value, and key path.
_Avoid_: arbitrary chat endpoint, model discovery, automatic provider fallback

**Jev Decision Questions**:
The original action request uses wire state version 6. The complete original route for non-Bash tools sends all requested action heads in one strict call. The experimental file adapter can add one complete matching call before either original action route. Bash uses actual non-command, syntax, and grouped command-policy replies. An empty active command manifest skips the syntax call and sends three empty source groups to the actual command head. Each action question chooses `allow`, `confirm`, or `block`. Each command syntax question chooses `match` or `no_match`. Each file matching question chooses `match`, `no_match`, or `unknown`. Every tool request asks `risk` about executable effects with guidance for the tool family. Policy questions judge matching block restrictions. File paths add file policy. Parsed shell calls add command policy and structurally possible org policy. Complete known executable or wrapper heads reduce the projected org rules. Opaque or incomplete heads, withheld comments, or missing commands retain all of them. Disclosure follows possible data effects and observed runner facts. Incomplete shell effects retain the disclosure question. Authority applies only to browser tools. Exact `sf_browser_press` key `Escape` remains risk- and authority-evaluated cancellation. It requires no org or fresh target/focus facts. The request does not create false freshness. At most six action answers supply all risk and policy judgments. Structural applicability does not decide an outcome.
_Avoid_: unbounded model chain, deterministic policy vote, combined confidence

**Operation Metadata**:
The bounded tool identity, operation, flags, paths or destinations, execution intent, and locally resolved facts sent to Jev with the minimum effective policy relevant to the questions. Known CLI structure, trusted file-path variants, and bounded numeric observations describe effects without a local policy verdict. File bodies, scripts/Apex, query text, Canvas content, credentials, transcripts, fetched contents, raw arguments, and full browser pages/forms stay local. Withheld or unresolved effects are explicit uncertainty; hidden custom-pattern literals cannot be presumed nonmatches. Command literal equality is retained by the **Command Token Projection**, without spelling disclosure or a local policy vote.
_Avoid_: raw payload, full context, content inspection, implicit nonmatch

Protocol 9 adds the Pi file tools `grep`, `find`, and `ls` to operation
metadata. Their path adds file policy. An absent or empty path uses the
working directory, as the installed runner does. Search patterns and glob
text stay local. These data selectors are not executable code. Numeric
metadata describes runner arguments; it does not prove an output bound.
Directory facts do not establish the sensitivity of selected descendants.
Jev must judge file policy and disclosure from the available facts.

Protocol 10 adds the supplied path kind from the existing `stat` lookup.
The lookup follows symlinks. An absent kind or lookup failure means unknown.
Only the supplied path is observed. Its kind does not establish descendant
contents or sensitivity. Do not infer kind from a suffix. Query flag metadata
matches the installed CLI. A native `query.run` cap observation uses supplied
`max_rows`, because that runner ignores `limit`. Query text stays local.
These observations do not establish a policy result or automatic allow.

Protocol 11 binds the observed modern deploy flag matrix. `--dry-run` is
observed only on `project deploy start`. `--use-most-recent` is observed only
on `project deploy quick`, `report`, or `resume`. Modern deploy `--check-only`
and `--checkonly` are unknown and incomplete. Later operands stay local.
Unsupported legacy deploy operations stay unknown. Flag observations do not
establish preview intent, policy permission, or automatic allow.

Protocol 12 observes a narrow original native `sf_soql` `query.run` query.
The bound is 512 bytes and an 80-character ASCII source token. Only
`SELECT Id FROM source LIMIT 1..2000` can produce a shape observation.
Fixed syntax is case-insensitive. Only ASCII space, tab, CR, and LF separate
tokens. The current local syntax SDK must accept the original whole text.
Raw query and source spelling stay local. Sensitivity stays unknown.
Without an exact Protocol 14 plan, artifact paths stay unobserved and
completeness stays false.
The observer does not prove source access, API response contents, artifact
path binding, or custom file policy coverage. It cannot increase automatic
safe coverage. Supplied `max_rows` takes precedence over a verified query
LIMIT. The selected cap is floored and clamped to 1..2000. Input `limit`
stays ignored. Unsupported shapes supply no query LIMIT observation.

**Native Query Artifact Plan**:
Protocol 14 records the actual native `sf_soql` `query.run` destinations
before classification. It declares possible ancestor directory creation
and five exact file writes. Fresh path facts and Jev file policy apply to
each write access. The plan removes only the artifact path omission.
Query text, source spelling, result contents, and sensitivity stay unknown
or local. The local plan hash binds the original input and SDK call
identity. Successful allow audit precedes authorization. One consumer
claims the plan before connection. Context checks repeat before writing
and around waits. Call records stay for the process lifetime, with a
256-record bound that rejects new plans. A changed engine cannot send a
recorded Jev call to the legacy writer. These checks do not pin physical
filesystem ancestors against replacement. Partial owned output can remain
after failure. Other SOQL actions do not have this plan contract.
_Avoid_: model-supplied plan, reusable approval token, atomic filesystem proof

**Command Token Projection**:
Version 2's mechanical integer IDs for original, wrapper-expanded, and flattened command tokens, typed prefix classes, and Pi argument sequences. Effective ordered policy rows are active-only and carry explicit behavior and token IDs or one of seven special-pattern forms. Shared `policy.commands.matchGrammar` supplies token/namespace/special definitions to each independent question. Off allow/deny rows are omitted after validation/bounding and allocate no token classes; off ordinary rows become **Effect Waivers**. Jev compares these facts and chooses rules. `publicSyntax` maps only known CLI executables, subcommands, and flag keys already exposed in semantic metadata to IDs. Private operands have no explicit legend; the projection includes no raw command, private-word dictionary, stable hash, matched rules, or local outcome. Equality and known policy anchors can reveal membership; they provide neither cryptographic secrecy nor a deterministic model-matching guarantee.
_Avoid_: encrypted command, anonymization guarantee, host policy matcher, precomputed verdict

Process 45 selects syntax 44 or exact syntax 43 before transport. Syntax 44
copies every adjacent original pair with its indices, heads, and complete left
arguments. It retains all original rows, selectors, and shared grammar. All
separators between adjacent original rows count. If the complete syntax 44
body exceeds 32,768 UTF-8 bytes, the process uses exact syntax 43 with the same
limit. The choice uses only serialized size. It adds no match, winner, action,
retry, or wire field. Exact inverses restore syntax 43, syntax 42, numeric
syntax 37, and long syntax 31.

**File Matching Process**:
The experimental `file_match_then_policy` format copies every original
`facts.files` record and `policy.files` row. It admits 1 to 8 matching heads
in exact source order: record, row, then `patterns` and `allowedPatterns`.
Disabled and Off rows stay in the complete set. Jev judges only whether the
named list matches that record. It chooses `match`, `no_match`, or `unknown`.

Protocol 19 includes flat `state.fileMatchPremises` entries. Each has the literal
zero-based `fileRecordIndex` in `facts.files`, `policyRowIndex` in
`policy.files`, `patternList` (`patterns` or `allowedPatterns`), and actual
`choice` (`match`, `no_match`, or `unknown`). The entries keep exact source
order. The array and retained full `state.fileMatch` transcript come from
the same validated matching receipt.

The later actual `file_policy` head owns eligibility, same-row exemptions,
existence requirements, protection strength, first-tie order, Off-winner
behavior, access, and the action. Unknown remains unknown. The host copies,
binds, and validates data. It does not match or filter rows or add a second
policy vote. Other original questions keep their independent restrictions.
_Avoid_: host path matcher, local policy winner, matching choice as approval

For a local `write` or `edit` with `exists=false`, unknown prior file kind
describes the absent object. In the `risk` question, that fact alone does not
mean an unknown executable effect. File protection and disclosure remain
with their sole independent Jev questions.

Select the complete format before any transport factory. A new count, byte,
or JSON tree failure selects the exact complete original Jev route, subject
to that route's own limits. A reply failure blocks without a later route
change. Every actual request has depth at most 32, at most 16,384 JSON nodes,
and at most 32,768 UTF-8 body bytes. Freeze each request separately. Duplicate
local plan copies do not count against the JSON tree limit for a request.
Before any factory, reserve the full transcript and named array with the
longest choice spelling `no_match` at every original coordinate. This reserve
is only for admission; it is not a model reply.

The file transcript has 16 top-level fields and six fields per answer.
It preserves the actual receipt, raw probabilities and confidence, hashes,
IDs, model/provider, usage, cost availability, bytes, and timing. Its strict
canonical inverse restores the typed receipt and original request bytes.
Numeric strings preserve parsed values and signed zero `-0`. Raw JSON
number spelling is outside that inverse. Full validation and this adapter's
current full development score remain unproved. Earlier head-only file
scores do not qualify this experimental process.
Validation requires exact equality with the named array rebuilt from that
receipt. The inverse removes both added fields and restores the original
file policy question to recover exact original request bytes.

**Effect Waiver**:
An effectively off ordinary command row projected separately under `policy.commands.effectWaivers`. Jev may exactly match it when judging that configured operational or disclosure effect. It is not an allow exception and cannot suppress active command, org, or file restrictions. File rules retain an enabled off winner's precedence over weaker file rules; an org rule's matching off outcome still stops later rules for that command.
_Avoid_: command-policy override, global exemption, inactive deny as allow

**Jev Automatic Allow**:
Complete original context with every actual action head choosing `allow`. The default experimental point, `conservative`, requires raw `P(allow) >= 0.99` for every action and raw `P(selected choice) >= 0.99` for every command syntax answer and every file matching choice, including `unknown`. The explicit `argmax` point sets both floors to zero. `SF_GUARDRAIL_JEV_OPERATING_POINT` accepts only these two names. An actual `block` stays a **Hard Block**. A `confirm`, failed floor, or incomplete context requires human confirmation. Freeze the point before facts and calls, and bind it to protocol, fingerprint, transport, audit, and context. Neither point has joint calibration or safety qualification. One total 10,000 ms limit covers facts through automatic release and synchronous cleanup. A later explicit human approval uses a new bounded 1,500 ms context check; it does not repeat or renew the model process.
_Avoid_: guaranteed safe, confidence-based approval, local C11 qualification

File completeness requires every original declared path and artifact access
path to have an observed `facts.files` row with equal `path`. An alias cannot
replace that observation. `exists=false` is valid, and kind is optional.
Required path strings are copied before the fact resolver runs. The resolver
receives separate derived metadata. It cannot change the original operation
or its questions through that copy. The original prepared artifact plan keeps
its registered object identity. Between all stages and before automatic
release, recheck the original input, policy, descriptor, operating point,
context, and hosted facts. A later human
allow repeats the bounded current-context check. These checks prove coverage
of supplied facts. They do not establish resolver truth or a policy result.
Path facts do not bind inode, modification time, or file contents.
The checks do not prevent filesystem replacement races.

**Jev Answer Evidence**:
The individual model-authored choices, probability distributions, and confidence values preserved in audit. Top-level probabilities and confidence are the actual `risk` answer, even when a different question determines the enforced outcome. Separate stage receipts bind each actual head to its own request and reply hashes, model, provider, ID, usage, and time. Keep the full command binary transcript, any actual file matching transcript, and observed validated answers after failure. Collected Bash heads are not one provider reply. They are not a combined probability of safety.
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
A **Session Approval** available only for a complete call against a currently verified non-production org. Its local fingerprint binds the full canonical original input, tool, working directory, verified target, engine, policy/protocol hash, model identity, and transport hash. The transport hash binds endpoint, model, provider, and routing without storing endpoint text. A changed connection or withheld content invalidates approval. Withheld content stays local. A grant enters reusable memory only after persistence and audit recording succeed. Deterministic grants do not transfer. Production, unknown, external, and opaque calls remain allow-once.
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
