# SF Data 360

## What It Does

`sf-data360` gives agents a pi-native, workflow-oriented way to work with
Salesforce Data Cloud / Data 360 without exposing hundreds of endpoint-specific
tools.

It registers the v2 `data360_*` family tool surface:

- `data360_discover` — readiness, action discovery, examples, catalog, and
  routing explanation.
- `data360_connect` — connectors, connections, endpoints, source schemas, and
  auth preflight.
- `data360_prepare` — dataspaces, DLOs, data streams, ingest jobs, transforms,
  and DataKits.
- `data360_harmonize` — DMOs, mappings, standard mappings, smart mapping, and
  identity resolution.
- `data360_segment` — calculated insights, segment definitions, publish, and
  status.
- `data360_activate` — activations, activation targets, data actions, action
  targets, and personalization delivery/configuration.
- `data360_query` — SQL, metadata search/get, profile query, data graph,
  rows/count/sample, and verification.
- `data360_semantic` — semantic models, semantic objects, metrics, search
  indexes, retrievers, and ML/prediction model surfaces.
- `data360_observe` — Agentforce STDM sessions, platform tracing spans, trace
  trees, action failures, and latency analysis.
- `data360_orchestrate` — journeys, manifests, plans, multi-step workflows,
  sweeps, and cleanup.
- `data360_api` — raw REST escape hatch for endpoints not yet promoted to a
  family action.

Legacy modules are compatibility-only for the public surface, but they still
support the facade-first E2E sweep, selected v2 adapters, and compatibility
tests. Current user and agent workflows use only `data360_*` tools and actions.

It is enabled by default and ships plain reference documentation under
`references/`. It does not contribute Agent Skills; explicitly disabling the
extension removes the tools on `/reload` or new sessions.

## Design Rationale

The intended balance is:

- **Agent-intuitive:** tools match Data 360 lifecycle families and user journeys,
  not raw endpoint families.
- **Context-efficient:** each tool has a compact schema; action catalogs and
  examples are disclosed on demand through `actions.search`, `action.describe`,
  and `examples.get`. Discovery results include bounded action previews and
  recovery hints so agents can choose the next action without loading the full
  catalog.
- **Composable:** agents can still chain family actions, journeys, pagination,
  and JSON transforms without loading the full 200+ operation catalog into the
  prompt.
- **Deterministic:** actions route through the generated registry and shared Salesforce Connection Module, which resolves the target org, selects the latest advertised API version (or explicit configured fallback), builds query strings, handles authentication/timeouts, and never uses JSforce's implicit API 50. Risky writes remain gated locally.
- **Pi-native:** no external server or Java subprocess is used; v2 tools run through the common Salesforce connection, safety, and rendering modules.

## Tool Shape

Every v2 family tool uses the same compact envelope:

```json
{
  "action": "stream.create_ingest_api",
  "params": {},
  "target_org": "optional-alias",
  "dry_run": true,
  "allow_confirmed": false,
  "output_mode": "summary"
}
```

Use `actions.search` and `action.describe` to discover exact actions without
loading the whole catalog:

```json
{ "action": "actions.search", "params": { "query": "ingestion api stream" } }
```

```json
{ "action": "action.describe", "params": { "action": "stream.create_ingest_api" } }
```

## DMO/DLO Discovery Defaults

For a simple "list DMOs" request, use `data360_harmonize` with the DMO list/get
actions or `data360_query` metadata actions such as `metadata.entities`. Do not
use `/ssot/data-model-objects` broadly unless the user explicitly needs full DMO
field definitions or the standard catalog.

List actions cap inline output by default and save the full raw response to a temp file. Use `category` and `max_results` to narrow the inline table.

For record queries, describe one selected DMO first, run `COUNT(*)`, then sample
a small number of verified non-sensitive fields.

## Safety Model

| Request shape                                                                  | Behavior                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `GET`                                                                          | Allowed as read-only.                                                     |
| Safe `POST` paths such as metadata search, query, validate, or connection test | Allowed.                                                                  |
| `POST` run/publish/deploy/undeploy action paths                                | Confirmed.                                                                |
| `PATCH` / `PUT`                                                                | Confirmed for production or unresolved orgs.                              |
| `DELETE`                                                                       | Always confirmed.                                                         |
| Headless mutating call requiring confirmation                                  | Blocked unless the central Guardrail headless override is explicitly set. |

Use `dry_run: true` before mutating calls to inspect the exact action, method,
path, target org, org type, and safety decision. For v2 family actions with
`safety: "confirmed"`, actual execution also requires `allow_confirmed: true`;
dry-run and `allow_confirmed` express execution intent, while SF Guardrail owns
the approval boundary for high-value mutations. Mutating journeys disclose the
child mutation families covered in the Guardrail approval detail and record the
executed child chain as a `sf-data360-execution-chain` session entry. That chain
is intentionally separate from the `sf-guardrail-decision` approval ledger and is
surfaced alongside `/sf-guardrail audit` output for review.

## V2 Action Coverage

The v2 action registry is generated from the existing operation registry plus
curated ownership and rename overlays under `registry/v2/`. Every operation must
resolve to exactly one primary `data360_*` tool/action unless an explicit tested
exception exists. The current coverage matrix, confirmed-capability workflow,
and per-family "what to run first" checklist live in
`references/facade-coverage.md` while the v2 action map stabilizes.

## References

Plain reference files under `references/` cover endpoint families, workflow
recipes, action coverage, request-body shapes, query patterns, examples, safety
rules, Agentforce Session Tracing (STDM), and Agent Platform Tracing. These are
not Agent Skills; agents should read the specific reference file when deeper
guidance is needed.

Payload examples remain capability-shaped internally. V2 tools expose them
through `examples.get` on the relevant family action, while registry entries in
`registry/examples.json` continue to carry canonical capability names and variant
metadata such as `{ "capability": "d360_dmo_create", "variant": "profile" }`.

The phase reference pages under `references/phases/` are generated from
`registry/phases.json`, the v2 action map, and registry operation data. Run
`npm run generate-d360-references` after changing phase mappings or capability
coverage.

When local references are not enough, use the public upstream Data 360 reference
repository before broad web search: <https://github.com/forcedotcom/d360-mcp-server>.
SF Data360 periodically imports public operation and payload-shape metadata from
that repository, then curates it into Pi-native `data360_*` family actions.

Do not duplicate large endpoint catalogs in prompt injection. Keep large content
behind file references so the agent loads it only when needed.

## Settings Panel

`sf-data360` is enabled by default and marked configurable so it appears with a standardized drill-down panel in the `/sf-pi` extension manager. The Manager Settings page shows enablement, runtime backend, tools, safety behavior, reference paths, and one low-risk preference stored in Pi settings under `sfPi.data360`:

- **Default output mode** (`defaultOutputMode`) — used by `data360_*` family tools when the caller omits `output_mode`. Values: `summary` (default), `inline`, or `file_only`.

Explicit tool arguments still win. For example, passing `output_mode: "inline"` overrides the saved default for that call.

Result digests remain artifact-first, but discovery actions include bounded previews: `actions.search` shows matching action names and parameters, `action.describe` shows exact required/optional parameters plus curated examples when available, and unknown actions return fuzzy suggestions without auto-routing.

## Commands

- `/sf-data360` — open SF Data 360 in the SF Pi Manager when interactive; print
  concise status when non-interactive.
- `/sf-data360 status` — print enablement, registered tools, target org, and API version.
- `/sf-data360 help` — show usage guidance.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-data360/
  lib/                        ← implementation modules
  references/                 ← progressive reference material
  registry/                   ← generated and curated registry data
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
  ROADMAP.md                  ← unresolved extension work
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

**A simple DMO list returns too much data:** Use `data360_harmonize` with
`action: "dmo.list"`, narrow by `category`, and choose a bounded output mode
instead of calling `/ssot/data-model-objects` broadly.

**Metadata search fails but DMO/DLO lists work:** Treat this as search-plane
readiness. Use `data360_query` with `action: "metadata.entities"` and
`params: { "entityType": "DataModelObject" }`, then inspect one result with
`action: "metadata.get"` and `params: { "entityName": "<api-name>" }`, or use
the matching `data360_harmonize` / `data360_prepare` get action.

**Connector detail returns `NOT_FOUND`:** Use the connector catalog `name` from `GET /ssot/connectors`, not necessarily the `connectorType` shown on a connection.

**`data360_*` tools are missing:** `sf-data360` is enabled by default, so first check whether it was explicitly disabled in `/sf-pi`, then run `/reload`. The extension registers tools directly and does not contribute Agent Skills.

**A mutating call is blocked in headless mode:** Re-run with `dry_run: true` and
review the resolved request. If unattended automation deliberately accepts
Guardrail-gated calls, configure that process outside the tool call with
`SF_GUARDRAIL_ALLOW_HEADLESS=1` and review the resulting Guardrail audit entries.
Hard blocks still apply.

**A versioned path is rejected:** Pass only a versionless resource such as `/ssot/data-model-objects`. The shared Salesforce Connection Module uses the target org's highest advertised version by default. If discovery fails, it uses explicit `org-api-version`; with neither available, it fails before the business request rather than using API 50.
