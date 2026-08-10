---
title: "SF Herdr"
description: "Plan Herdr lanes from explicit Salesforce workflow intent without hiding pane actions."
---

# SF Herdr

<p class="sfpi-page-lead">Plan Herdr lanes from explicit Salesforce workflow intent without hiding pane actions.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Herdr lane planning</strong><p>Plan Herdr lanes from explicit Salesforce workflow intent without hiding pane actions.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Requires explicit intent and primaryWorkflow values instead of inferring activity.</div>
<div class="sfpi-benefit-card">Returns visible steps for the current herdr_layout, herdr_pane, and herdr_agent tools.</div>
<div class="sfpi-benefit-card">Carries the split result's opaque pane ID forward and uses global lifecycle settings to recommend cleanup.</div>
</div>

## Try it first

Open Herdr planning status

```text
/sf-herdr
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-herdr
/sf-pi enable sf-herdr
/sf-pi disable sf-herdr
```

## Common use cases

- Plan an ephemeral test lane that adds cleanup only after observed success and stays open on failure.
- Coordinate Agent Script preview or eval work with related Apex log lanes.
- Keep UI bundle servers or log tails sticky while short validation lanes receive an explicit success-only cleanup step.
- Review the configured lifecycle for an explicit workflow intent before opening a lane.

## What you get

- A non-mutating `sf_herdr_plan` tool that requires explicit intent and primaryWorkflow inputs.
- Current split-tool steps that reuse `details.pane.pane_id` as an opaque result reference.
- Global per-intent lifecycle settings that add a close step only after observed success or recommend leaving panes open.

## Safety notes

- sf_herdr_plan is non-mutating and never generates shell commands.
- Planner steps use only herdr_layout, herdr_pane, and herdr_agent and pass the opaque pane ID returned by pane_split.
- The exact current successful-empty-body pane-run result is normalized without retrying the command.
- sf-guardrail mediates herdr_pane action=run commands when dangerous-command or org-aware rules match.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-herdr`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-herdr`
- **LLM tools:** `sf_herdr_plan`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `tool_result`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-herdr)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-herdr/README.md#troubleshooting) for extension-specific recovery steps.
