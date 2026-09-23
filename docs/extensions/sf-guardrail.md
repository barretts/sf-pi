---
title: "SF Guardrail"
description: "Salesforce-aware safety hooks with selectable deterministic or TypeSafe Jev classification, human approval, and audit"
editLink: false
---

# SF Guardrail

<p class="sfpi-page-lead">Salesforce-aware safety hooks with selectable deterministic or TypeSafe Jev classification, human approval, and audit</p>

## What it does

Salesforce-aware safety layer with a default deterministic engine and opt-in TypeSafe Jev through OpenRouter Decisions. Jev classifies operation metadata for every Pi tool call and interprets the effective policy without deterministic fallback; SF Pi owns blocking, explicit approval, session memory, and audit.

## Start

Open the extension from its primary command:

```text
/sf-guardrail
```

Open its Manager detail or change its package state with:

```text
/sf-pi open sf-guardrail
/sf-pi enable sf-guardrail
/sf-pi disable sf-guardrail
```

## Safety notes

- Deterministic is the default. Jev is an explicit engine preference and has no automatic deterministic fallback; exact policy patterns are interpreted by a model without a deterministic matching guarantee.
- Every block / allow / confirm decision is persisted as an audit entry without credentials or raw Jev payloads.
- In deterministic mode, Power Tool and audited process-level operator/headless controls can allow confirm-class decisions, but never bypass hard blocks. Jev confirmations require explicit human approval and block headless execution regardless of those controls.
- Jev sends operation metadata and effective policy for every Pi tool call, excluding raw arguments and file, script, Apex, query, Canvas, credential, transcript, fetched, and full browser content. Omitted effects remain uncertainty.
- Jev auto-allows only complete-context allow predictions with P(allow) &gt;= 0.99; model block predictions are hard blocks. Transport, configuration, deadline, cancellation, malformed-response, and identity failures block without retries.
- Jev session approval requires a complete exact call and verified non-production org, bound locally to full input, target, cwd, policy/protocol, engine, and model identity. Factory/startup makes no live Jev requests.
- alwaysActive=false but disabling removes the safety layer entirely; the manager surfaces this clearly.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-guardrail`
- **Intent:** Work safely
- **Category:** Safety
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-guardrail`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_tree`, `before_agent_start`, `tool_call`, `context`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-guardrail)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/AGENTS.md)
- [Domain glossary](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/CONTEXT.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-guardrail/README.md#troubleshooting) for extension-specific recovery steps.
