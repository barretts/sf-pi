# SF SOQL

## What It Does

SF SOQL is a lean, API-native **SOQL Lifecycle Extension** for pi. It helps the
agent move through the SOQL Query Loop:

```text
describe schema → validate query → explain selectivity → sample/count/run → artifact → iterate
```

It deliberately does **not** become a data explorer, record browser, data export
product, report builder, or CLI wrapper. Broad human exploration remains with
`sf-data-explorer`; data mutation and bulk data operations remain outside
`sf-soql`.

## Key Architecture Decisions

- **Shared API-native hot path** — actions use the common Salesforce Connection Module for target resolution, latest-first API-version selection, authentication, and bounded REST/Tooling calls; recurring CLI gaps should become native actions instead of subprocess fallbacks.
- **One family tool** — `sf_soql` uses dotted actions to keep prompt footprint low.
- **Bounded execution** — `query.sample` defaults to a small limit, and `query.run`
  safety-gates broad queries without `LIMIT` unless `max_rows` or `allow_unbounded`
  is explicit.
- **Explicit REST vs Tooling** — pass `api: "tooling"` for Tooling objects such as
  `ApexClass`, `ApexLog`, and `ApexTestResult`.
- **Artifact-first evidence** — full raw/flattened results are persisted; LLM output
  stays compact while still showing bounded field, finding, row, and artifact previews
  needed for the next likely agent decision. Explicit exports are confined to
  `.sf-pi/exports/soql/` under the workspace.
- **SOQL API Call Rail** — cards show concrete native endpoints and high-signal
  request parameters.
- **Full query visibility** — every query-shaped card includes a dedicated SOQL
  Query section with the full normalized query, separate from the compact API rail.
- **Guidance without context bloat** — query-shaping actions recommend the
  `querying-soql` skill for deeper syntax, relationship-query, aggregate-query,
  selector-pattern, and anti-pattern guidance, but `sf_soql` remains the native
  execution authority.

## Commands

```text
/sf-soql          Open SF SOQL panel
/sf-soql status   Print extension status
/sf-soql help     Print command and tool usage
```

## LLM Tool

`sf_soql` actions:

| Action                 | Description                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------- |
| `status`               | Report extension/native connection status.                                                          |
| `org.preflight`        | Check org readiness for SOQL lifecycle work.                                                        |
| `schema.search`        | Search queryable sObjects by API name or label.                                                     |
| `schema.describe`      | Describe one sObject for queryable fields and relationships.                                        |
| `schema.relationships` | Show child-to-parent and parent-to-child relationship names.                                        |
| `query.draft`          | Draft a bounded SOQL query from explicit object, fields, filters, and intent.                       |
| `query.validate`       | Parse and describe-validate objects, fields, relationships, field capabilities, literals, and risk. |
| `query.explain`        | Retrieve the native query plan via `/query?explain=...`.                                            |
| `query.sample`         | Run a small bounded sample query.                                                                   |
| `query.run`            | Run a bounded explicit query. Broad queries without `LIMIT` are safety-gated.                       |
| `query.count`          | Convert a query shape to `SELECT COUNT()` and run it.                                               |
| `query.queryAll`       | Explicit queryAll / deleted-row-aware execution.                                                    |
| `query.export`         | Export the latest query artifact to `.sf-pi/exports/soql/` under the workspace.                     |
| `sosl.run`             | Run a bounded native SOSL search via `/search`.                                                     |
| `file.diagnose`        | Diagnose `.soql` files and embedded Apex `[SELECT ...]` queries.                                    |
| `lsp.status`           | Report current parser/describe diagnostics mode and managed LSP readiness.                          |
| `history.last`         | Return the previous SOQL Run Digest in this session.                                                |
| `history.rerun`        | Rerun the previous runnable SOQL action.                                                            |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-soql/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

| Symptom                             | Likely cause                                                                 | Fix                                                                      |
| ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `query.run` returns a safety review | Query has no top-level `LIMIT` and no explicit row cap.                      | Use `query.sample`, `query.count`, or pass `max_rows`.                   |
| `INVALID_TYPE` or invalid object    | The object name is wrong or belongs to Tooling API.                          | Use `schema.describe`, or run with `api: "tooling"` for Tooling objects. |
| `INVALID_FIELD`                     | Field or relationship name was guessed.                                      | Use `schema.describe` / `schema.relationships` before running.           |
| Query plan unavailable              | Salesforce did not return a plan for that query shape.                       | Run `query.validate`, `query.count`, or a bounded `query.sample`.        |
| Large result not visible in chat    | Full evidence is artifact-first by design; chat shows only bounded previews. | Open the SOQL Artifact paths from the result card.                       |
| `query.export` rejects a path       | Exports are confined to `.sf-pi/exports/soql/` under the workspace.          | Use a relative filename or subpath without absolute paths or `..`.       |
