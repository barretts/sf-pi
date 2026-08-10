---
title: "SF Data Explorer"
description: "Browse Salesforce and Data 360 data read-only from a keyboard-first pi interface."
---

# SF Data Explorer

<p class="sfpi-page-lead">Browse Salesforce and Data 360 data read-only from a keyboard-first pi interface.</p>

<div class="sfpi-action-card"><span>Best for</span><strong>Read-only data exploration</strong><p>Browse Salesforce and Data 360 data read-only from a keyboard-first pi interface.</p></div>

## Why you'll use it

<div class="sfpi-benefit-grid">
<div class="sfpi-benefit-card">Explore objects, fields, and query results without writing throwaway scripts.</div>
<div class="sfpi-benefit-card">Keep exploration read-only by design.</div>
<div class="sfpi-benefit-card">Switch between SOQL, SOSL, and Data 360 SQL workflows from one UI.</div>
</div>

## Try it first

Open the explorer

```text
/sf-data-explorer
```

You can also manage this extension from the SF Pi home base:

```text
/sf-pi status sf-data-explorer
/sf-pi enable sf-data-explorer
/sf-pi disable sf-data-explorer
```

## Common use cases

- Inspect object fields before writing a query.
- Run small read-only SOQL or SOSL checks.
- Preview query results and export JSON or CSV when useful.
- Explore Data 360 SQL results without asking the LLM to hold large tables.

## What you get

- A TUI data explorer with object and field browsing.
- Editable query text, result detail views, and export shortcuts.
- Read-only guardrails for safer exploration.

## Safety notes

- Read-only v1: only describe, query, search, compact Data 360 metadata GETs, and Data 360 SELECT SQL calls are issued.
- Core SOQL execution validates SELECT-only query text before calling /query.
- SOSL execution validates FIND-only query text before calling /search.
- Data 360 SQL catalog loading uses /ssot/metadata-entities; selected object details use /ssot/metadata?entityName=...; /ssot/query-sql is used only to execute the visible SQL query.
- Uses sf-pi target-org and API-version resolution; no hardcoded API version.
- No raw access tokens are surfaced in UI, exports, or logs.

## Exact reference

<details>
<summary>Show commands, tools, providers, and hooks</summary>

- **Extension id:** `sf-data-explorer`
- **Category:** UI
- **Maturity:** experimental
- **Default state:** on
- **Commands:** `/sf-data-explorer`
- **LLM tools:** _none_
- **Providers:** _none_
- **Events/hooks:** `session_start`, `session_shutdown`

</details>

## For contributors

- [Full extension README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md)
- [Source folder](https://github.com/salesforce/sf-pi/tree/main/extensions/sf-data-explorer)
- [Agent editing rules](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/AGENTS.md)

## Troubleshooting

See the [Troubleshooting section in the full README](https://github.com/salesforce/sf-pi/blob/main/extensions/sf-data-explorer/README.md#troubleshooting) for extension-specific recovery steps.
