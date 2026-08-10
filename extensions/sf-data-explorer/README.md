# SF Data Explorer

Read-only interactive Salesforce data explorer for Pi and SF Pi.

## Command

```text
/sf-data-explorer
/sf-data-explorer soql my-org
/sf-data-explorer sosl my-org
/sf-data-explorer sql my-org
/sf-data-explorer soql Account my-org
/sf-data-explorer sosl Contact my-org
/sf-data-explorer sql ssot__Individual__dlm my-org
```

## What It Does

SF Data Explorer is a deterministic, keyboard-first TUI for Salesforce data exploration. It opens a three-pane explorer (objects, fields, query/result) across three read-only modes:

- **`soql`** — browse queryable core Salesforce sObjects, select fields, edit and run SOQL.
- **`sosl`** — browse searchable sObjects, build and run SOSL searches.
- **`sql`** — browse Data 360 DMO/DLO catalogs, select fields, edit and run Data 360 SELECT SQL.

It is not a query author for the agent, a write surface, or a replacement for `/sf-data360`. It is a single explorer for picking data and running read-only queries from inside Pi.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data-explorer/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Settings

The Manager Settings page exposes low-risk defaults for direct command usage:

- **Default mode** (`sfPi.dataExplorer.defaultMode`) — `soql`, `sosl`, or `sql`.
- **Default org** (`sfPi.dataExplorer.defaultOrg`) — target org alias used when a command omits one.

Explicit command arguments still win. For example, `/sf-data-explorer sql my-org` uses `sql` and `my-org` regardless of saved defaults.

## Safety

V1 is read-only by construction:

- Core Salesforce calls: `/sobjects`, `/sobjects/{name}/describe`, `/query`, `/search`.
- Data 360 calls: `/ssot/metadata-entities`, `/ssot/metadata`, `/ssot/query-sql` with SELECT SQL.
- No DML, Apex execution, Metadata API writes, or Data 360 mutation endpoints.

## Shortcuts

Press `?` in the TUI for the complete shortcut list. Primary bindings are lowercase:

```text
t switch explorer
w WHERE/search term
l LIMIT
e edit query
r run
c copy
s save
f refresh
q close
```

## Troubleshooting

**`/sf-data-explorer` reports the transport could not be initialized:**
The extension lazy-loads sf-pi Salesforce connection internals. Confirm `sf-pi` itself is installed and the target org is authenticated via `sf org login` / `sf org login web`. Pass `--target-org <alias>` (or the third positional argument) to override the default org.

**Catalog never finishes loading:**
Press `f` to force-refresh past the cache, or rerun with `/sf-data-explorer <mode> refresh`. Large orgs and large Data 360 catalogs can take several seconds the first time; subsequent loads are cache-served.

**Query refuses to run:**
The validator only permits `SELECT` (SOQL / Data 360 SQL) or `FIND` (SOSL). V1 is read-only by construction. Edit the query text (`e`) until the validator accepts it before pressing `r`.

**Exports are not where I expect:**
Saved JSON/CSV files land under `.sf-data-explorer/exports/` in the current working directory, not in the org or sf-pi state directory. Use `c` to copy the query text into the host editor instead.
