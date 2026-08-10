---
title: "SF Brain"
description: "Give agents the Salesforce Engineering Constitution and a compact routing summary for safer, evidence-backed work."
---

# SF Brain

<p class="sfpi-page-lead">Give agents the Salesforce Engineering Constitution and a compact routing summary for safer, evidence-backed work.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Salesforce agent guidance</strong><p>Give agents the Salesforce Engineering Constitution and a compact routing summary for safer, evidence-backed work.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Keeps the bundled Salesforce-first engineering baseline present in every session.</div>
<div class="sfpi-benefit-card">Prioritizes active SF Pi tools before external skills or raw CLI.</div>
<div class="sfpi-benefit-card">Routes agents to extension-owned guides only when deeper operating detail is useful.</div>
</div>

## Try it first

No command needed

```text
Install SF Pi and start a pi session.
```

You can manage this extension from the SF Pi home base:

```text
/sf-pi status sf-brain
/sf-pi enable sf-brain
/sf-pi disable sf-brain
```

## Common use cases

- Help an agent decide between Metadata API, Tooling API, REST, SOQL, or anonymous Apex.
- Keep org-safety conventions present across Salesforce work.
- Point agents to repo-local references without loading everything upfront.

## What you get

- The bundled Salesforce Engineering Constitution.
- A compact routing summary that reports disabled capability owners when relevant.
- No user-facing command surface because the extension works in the background.

## Safety notes

- Never registers tools; the constitution is delivered through the session entry log only.
- Always preserves the bundled constitution; user guidance is append-only through &lt;globalAgentDir&gt;/sf-brain/SF_CONSTITUTION_APPEND.md.
- Instruction Surface diagnostics expose counts and public-safe contributor ids only; they never expose prompt, context-file, skill-description, or tool-schema content.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-brain`
- **Category:** Assistive
- **Maturity:** stable
- **Default state:** on
- **Commands:** _none_
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `before_agent_start`, `context`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-brain)
- [Agent operating guide](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/AGENT_GUIDE.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-brain/README.md#troubleshooting) for extension-specific recovery steps.
