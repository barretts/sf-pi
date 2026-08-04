---
title: "SF Agent Script"
description: "Build, validate, preview, test, and publish Agentforce agents without leaving pi."
---

# SF Agent Script

<p class="sfpi-page-lead">Build, validate, preview, test, and publish Agentforce agents without leaving pi.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Agentforce agent authoring</strong><p>Build, validate, preview, test, and publish Agentforce agents without leaving pi.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Catch Agent Script errors before you publish.</div>
<div class="sfpi-benefit-card">Inspect topics, actions, variables, and references quickly.</div>
<div class="sfpi-benefit-card">Preview and regression-test agent conversations from the same workflow.</div>
</div>

## Try it first

Open the Agent Script panel

```text
/sf-agentscript
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-agentscript
/sf-pi enable sf-agentscript
/sf-pi disable sf-agentscript
```

## Common use cases

- Create a new `.agent` bundle from a scaffold.
- Compile and format Agent Script while editing.
- Preview a local agent against a Salesforce org.
- Run repeatable eval specs before activating a new agent version.

## What you get

- Compile, create, inspect, mutate, preview, evaluate, publish, and activate tools for agents.
- Local-first checks before server calls where possible.
- Planner traces and compact failure summaries for debugging conversations.

## Safety notes

- Compile-on-save stays silent on unsupported files and on failed write/edit results; only enabled edit-time High hardening rules join that feedback.
- Global per-rule quality toggles dynamically control reporting, repair, metrics, and local-file publication gating without a reload.
- Quality cards show every finding header by default; overlong variable descriptions gate publication, while official instruction-template diagnostics remain pre-activation recommendations.
- Eval, trace, preview, and lifecycle calls reuse @salesforce/core / SF CLI auth context; timeout-sensitive HTTP may use bounded native fetch and never logs or persists tokens.
- Local-first: compile and validate run via official @sf-agentscript packages before any network call.
- Apex action preflight uses Salesforce's registered action description for authoritative primitive and wrapper input/output contracts; failed target rows are never hidden behind resolved samples.
- Eval Studio inventories repository EvalSpec JSON and local Run artifacts without Salesforce calls; org/version resolution occurs only after an explicit Run or Release Contract action.
- Eval runs synthesize trace artifacts from inline Evaluation API data by default; explicit trace fetches are idempotent GETs.
- Eval turn artifacts preserve a parsed response sequence for every lastExecution.llmEvents entry without duplicating full prompt bodies; missing get_state evidence is unavailable, never a passing zero.
- Preview, eval reports, and Eval Studio expose every parsed LLM completion and advisory response-integrity warnings while keeping verdict and release semantics unchanged.
- Publication always creates an inactive version; activation requires complete exact-org, exact-BotVersion generated-baseline evidence plus the current designated release suite when configured.
- Untested activation is a distinct Guardrail Safety Envelope; acknowledge_untested_activation is intent, never approval.
- 5xx-only retry on POST avoids amplifying server-side overload (no Retry-After contract on the Eval API); client-side Eval API batch timeouts are terminal and configurable through batch_timeout_ms.
- Preview sessions land under .sfdx/agents/** (sf-guardrail carve-out); rest of .sfdx/** stays blocked.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-agentscript`
- **Category:** Agent Tool
- **Maturity:** stable
- **Default state:** on
- **Commands:** `/sf-agentscript`
- **LLM tools:** `agentscript_authoring`, `agentscript_preview`, `agentscript_eval`, `agentscript_lifecycle`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`, `tool_result`, `agent_settled`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-agentscript)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-agentscript/README.md#troubleshooting) for extension-specific recovery steps.
