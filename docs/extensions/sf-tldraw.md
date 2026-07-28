---
title: "SF tldraw"
description: "Turn explicitly grounded Salesforce models and interactions into editable, deterministic tldraw diagrams with visual evidence."
---

# SF tldraw

<p class="sfpi-page-lead">Turn explicitly grounded Salesforce models and interactions into editable, deterministic tldraw diagrams with visual evidence.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Editable Salesforce diagrams</strong><p>Turn explicitly grounded Salesforce models and interactions into editable, deterministic tldraw diagrams with visual evidence.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Renders Data Model, System/Solution Architecture, and Interaction/Sequence profiles through one local Canvas API tool.</div>
<div class="sfpi-benefit-card">Uses unchanged SLDS icons and verifies cardinality markers against actual connector terminals.</div>
<div class="sfpi-benefit-card">Preserves human positioning and annotations by default while blocking completion on layout or lint failures.</div>
</div>

## Try it first

Check tldraw readiness

```text
/sf-tldraw
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-tldraw
/sf-pi enable sf-tldraw
/sf-pi disable sf-tldraw
```

## Common use cases

- Render a reference-grounded Salesforce data model from official documentation.
- Visualize an org-described schema without fabricating relationships or sharing facts.
- Create an editable solution architecture with labeled directional connections.
- Lay out a static, ordered interaction sequence with screenshot evidence.

## What you get

- One `tldraw_canvas` family tool for runtime operations and three Salesforce render profiles.
- Deterministic Dagre or fixed-lane placement with transform-correct connector decorations.
- Full and thumbnail evidence artifacts only after readiness passes.

## Safety notes

- Never infers or fabricates Salesforce schema, relationship, count, sharing, record-type, icon, or product facts; strict Spec v2 elements carry inspectable source provenance.
- Rejects unknown Spec v2 fields and sensitive rendered text; execution-only target_org is neither rendered nor persisted.
- Requires the tldraw offline v1.12 Canvas API contract. Document creation uses only the native non-overwriting route and never falls back to OS automation, browser automation, or direct `.tldraw` archive generation.
- Treats the tldraw app as the sole owner of the `tldraw-offline` Pi skill; readiness checks are read-only and SF Pi never bundles or overwrites a duplicate skill.
- Default updates preserve human positioning and annotations; relayout and replacement must be explicit and only profile-managed shapes can be removed.
- A Salesforce render is not reported complete until spec validation, zero canvas lints, connector-terminal checks, typography checks, and screenshot capture pass.
- Reads the per-launch bearer token for each request, never prints or persists it, and redacts runtime error details.
- Generic canvas search, raw execution, standalone screenshots, and document scripts are not exposed by SF tldraw; the upstream app-managed skill owns those workflows.
- Screenshot sources used by Salesforce renders must be regular JPEG/PNG files inside tldraw's dedicated temporary capture directory before private 0600 artifact copies are exposed.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-tldraw`
- **Category:** Agent Tool
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-tldraw`
- **LLM tools:** `tldraw_canvas`
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-tldraw)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-tldraw/README.md#troubleshooting) for extension-specific recovery steps.
