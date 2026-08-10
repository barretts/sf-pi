---
title: Security model
description: SF Pi's trust surfaces, user-intent boundary, Guardrail mediation, and residual risks.
---

# Security model

SF Pi is a pro-code developer tool. It supports local edits, tests, previews,
queries, browser workflows, and external integrations. It does not claim to
sandbox every action available to a coding agent on a developer workstation.

Instead, SF Pi applies **known-surface mediation**: SF Guardrail mediates risky
action surfaces that SF Pi owns, observes, and can classify in the Pi Runtime.

## Core boundary

SF Pi treats authorization and user intent as different controls:

- **Authorization:** Salesforce, Slack, Data 360, GitHub, the operating system,
  and other target systems decide what the user's identity may do.
- **User intent boundary:** SF Guardrail requires the user or a configured
  operator to accept a specific Safety Envelope before an AI-mediated
  high-value durable mutation proceeds.

The user-intent boundary complements platform authorization. It does not replace
least-privilege credentials, project trust, or target-system policy.

## Assets and trust surfaces

SF Pi runs on the user's workstation and can interact with systems where the
user has configured credentials or authenticated sessions.

| Surface                      | Sensitive capability                                                     | Primary controls                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Local source and artifacts   | Read or write source, settings, logs, exports, and screenshots           | Pi project trust, Guardrail file rules, confined artifact paths, public-sanitization checks         |
| Salesforce orgs              | Read data and metadata; deploy, execute, publish, activate, or configure | Salesforce authorization, explicit target resolution, org-aware and native-tool Guardrail mediation |
| Data 360                     | Query data; ingest local files; mutate data resources                    | Dry-run and intent gates, confirmed execution, Guardrail mediation, execution-chain evidence        |
| Slack                        | Read workspace content or write messages and canvases as the user        | Slack scopes, explicit send/schedule confirmation, Guardrail mediation for Canvas writes            |
| Salesforce browser session   | Commit Lightning or Setup changes                                        | Snapshot-grounded refs, committing-action classification, Guardrail mediation, Browser Evidence     |
| Configured model provider    | Send model requests using user-controlled credentials and endpoints      | Pi-owned authentication, no bundled private endpoint or credential, sanitized diagnostics           |
| Guardrail settings and audit | Change safety posture or inspect decisions                               | Human-controlled settings, visible operator modes, session audit entries, hard blocks               |

## High-value durable mutations

A high-value durable mutation is a bundled first-party, LLM-callable operation
that can persistently change a durable system of record under the user's
authority. Examples include:

- Anonymous Apex execution, because submitted code can invoke existing mutating
  org logic
- Agent Script publication, activation, deactivation, and live agent-user
  provisioning
- Data 360 confirmed execution and raw REST mutations
- Salesforce Browser committing gestures such as save, submit, activate,
  assign, delete, or deploy
- Slack Canvas create and edit operations
- broad/deleted-record SOQL reads and artifact exports

Ordinary local source edits are not high-value durable mutations. They become
externally durable only when a separate deploy, publish, save, or execute action
applies them to a system of record.

## SF Guardrail

SF Guardrail mediates four kinds of known surfaces:

1. protected file access, including dotenv-style secrets and Salesforce CLI
   state directories
2. dangerous shell commands, including destructive filesystem, Git, package,
   credential-reveal, or infrastructure operations
3. Salesforce org-aware shell operations, especially production-sensitive
   deploy, Apex, data, package, Agentforce, and destructive REST commands
4. known high-value native tool mutations through the Native Tool Risk Registry

Guardrail evaluates these surfaces before execution through Pi's `tool_call`
mediator. Confirm-class decisions use the same Human-in-the-Loop, Session
Approval, headless, and audit path.

Data 360 mutating journeys keep approval and execution evidence separate. The
Guardrail decision records the accepted Safety Envelope; Data 360 records the
actual child steps that executed. This preserves both intent and resulting-path
evidence.

## Execution intent is not approval

Tool fields such as `allow_mutation`, `allow_confirmed`, `mutation`, and
`dry_run=false` describe the requested execution path. They do not approve it.
Approval comes from one of:

1. Human-in-the-Loop Approval for a specific Safety Envelope
2. an existing Session Approval for the same stable, bounded operation
3. an explicitly configured operator auto-approve mode

A model cannot grant itself approval by setting a tool parameter.

## Session and unattended operation

Session Approvals suppress repeated prompts only for the same Safety Envelope on
the current session path. Arbitrary-code, raw-REST, external-content,
destructive, short-lived browser-reference, production, and unknown-org
operations stay exact or allow-once.

Confirm-class actions fail closed without an interactive UI unless an operator
explicitly enables unattended execution. Available operator controls include:

```bash
SF_GUARDRAIL_ALLOW_HEADLESS=1
SF_GUARDRAIL_OPERATOR_AUTO_APPROVE=allow-confirm-actions-for-this-process
```

Persisted Power Tool Mode is configured through Guardrail settings. Native-tool
family selection and production/unknown-org auto-approval are separate choices.
All operator modes are configured outside the model call, are audited, and never
bypass hard blocks.

## Prompt-injection posture

SF Pi treats prompt injection as an **action-integrity risk**: untrusted records,
files, messages, pages, screenshots, or documentation can try to steer an agent
toward actions the user did not intend. SF Pi does not claim to detect every
malicious instruction.

The control objective is:

> Untrusted content alone must not be sufficient to cause a known high-value
> durable mutation, broad data disclosure, or external content write under the
> user's authority.

SF Pi reduces impact at execution time:

| Risk                                                                                 | Control                                                                                          |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| Untrusted content requests a Salesforce, Data 360, Slack, browser, or local mutation | Known high-value first-party operations become Guardrail Safety Subjects before execution        |
| Content asks the model to set an execution flag                                      | Execution intent remains separate from approval                                                  |
| Content requests unattended privileged execution                                     | Confirm-class actions fail closed unless the operator opted in outside the tool call             |
| Browser content disguises a committing action                                        | Snapshot labels and committing-action metadata supplement the model-provided reason              |
| A Data 360 journey hides child mutations                                             | Approval lists declared mutation families and execution records the child chain that ran         |
| Content requests broad/deleted SOQL data or export                                   | QueryAll, ALL ROWS, unbounded reads, and exports are mediated; exports remain workspace-confined |
| Content attempts local secret disclosure or dangerous shell execution                | File, command, and org-aware Guardrail rules apply before execution                              |
| Content is copied into a public issue or document                                    | Public-sanitization rules and sanitized feedback diagnostics constrain publication               |

This is impact mediation, not a universal prompt scanner. Manual commands,
third-party extensions, arbitrary scripts, and future unreviewed surfaces remain
outside the current known-surface guarantee.

## Other durable threat controls

| Threat                                                                | Control                                                                                                                                      |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Data 360 ingest uploads local file bytes without deliberate execution | Ingest execution requires explicit intent; dry-run does not read upload bytes; Guardrail mediates confirmed execution                        |
| Agent publication immediately changes serving behavior                | Publication creates an inactive version; exact-version release evidence gates normal activation; lifecycle mutations are mediated separately |
| Anonymous Apex indirectly mutates through existing code               | Every `sf_apex anon.run` is mediated using the exact org and body fingerprint; syntax classification is advisory only                        |
| A browser action commits Salesforce state with a neutral reason       | Snapshot-grounded control labels and explicit committing metadata inform Guardrail classification                                            |
| Slack content is written as the user                                  | Sends and scheduled-message changes require explicit confirmation; Canvas writes are Guardrail-mediated                                      |
| Query export escapes the project                                      | SOQL exports reject absolute, parent, dot, and empty segments and stay under `.sf-pi/exports/soql/`                                          |
| Secrets or private identifiers reach the public repository            | Secret scanners, docs-health checks, artifact checks, and contributor sanitization rules provide layered detection                           |

## Limits and residual risks

SF Pi does not claim to:

- prevent every mutation available on a developer workstation
- sandbox arbitrary shell commands or third-party tools
- replace target-system authorization
- classify future write surfaces before they are reviewed and added to the
  relevant safety model
- remove the need for user review, least-privilege credentials, and trusted
  project inputs

New high-value first-party write surfaces must either be mediated by SF Guardrail
or receive an explicit security design decision before shipping.

## Evidence and related references

Behavioral authority remains in current code and Behavior Proofs. Stable design
rationale and contributor requirements are documented in:

- [SF Guardrail extension](./extensions/sf-guardrail.md)
- [Secure development](./secure-development.md)
- [Public sanitization](./public-sanitization.md)
- [ADR 0033: SF Guardrail is a safety mediator](https://github.com/salesforce/sf-pi/blob/main/docs/adr/0033-sf-guardrail-is-a-safety-mediator.md)
- [ADR 0034: Safety Envelopes](https://github.com/salesforce/sf-pi/blob/main/docs/adr/0034-sf-guardrail-approvals-use-safety-envelopes.md)
- [ADR 0042: Session-scoped approvals](https://github.com/salesforce/sf-pi/blob/main/docs/adr/0042-sf-guardrail-uses-session-scoped-approval-envelopes.md)
- [ADR 0074: Native high-value mutation mediation](https://github.com/salesforce/sf-pi/blob/main/docs/adr/0074-sf-guardrail-mediates-native-high-value-mutations.md)
- [ADR 0075: Power Tool Mode](https://github.com/salesforce/sf-pi/blob/main/docs/adr/0075-sf-guardrail-adds-persisted-power-tool-mode.md)
