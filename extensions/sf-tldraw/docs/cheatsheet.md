# `tldraw_canvas` cheatsheet

Load this reference only for Salesforce diagram work. Explicit Mermaid or text requests take precedence.

## Workflow

1. Run `status`.
2. Run `documents`; when none is open, call `create_document` separately.
3. Gather facts with the owning SF Pi capability:
   - official references: `sf_docs`
   - org schema and relationships: `sf_soql`
   - bounded org observations: the appropriate Salesforce capability owner
4. Build a strict Salesforce Diagram Spec v2.
5. Call the render action matching `spec.family`.
6. Accept completion only when `readiness.ready=true` and screenshot artifacts exist.

```json
{ "action": "status" }
{ "action": "documents" }
{ "action": "create_document", "name": "Support Data Model" }
```

## Grounding and provenance

Every spec declares `grounding.mode` as `reference` or `org`.

- `reference` sources must be official Salesforce documentation URLs.
- `org` grounding requires a short execution-only `target_org` alias and at least one `org_describe` or `org_query` source.
- Every semantic node and connection has a non-empty `evidence` array containing declared source ids.
- Evidence references are inspectable provenance. SF tldraw does not claim that the renderer independently verified each cited fact.
- `target_org` is never rendered or persisted in the render report.

Every rendered string rejects authentication material, Salesforce org ids, usernames or email addresses, instance URLs, and authentication URLs.

## Data Model

```json
{
  "action": "render_salesforce_data_model",
  "render_mode": "preserve",
  "spec": {
    "spec_version": "2.0",
    "family": "data_model",
    "title": "Support data model",
    "scope": "Core support records and declared relationships.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-27",
      "sources": [
        {
          "id": "support-model",
          "label": "Salesforce support data model",
          "url": "https://developer.salesforce.com/docs/platform/data-models/guide/service-cloud-overview.html",
          "kind": "official_doc"
        }
      ]
    },
    "objects": [
      {
        "id": "account",
        "label": "Account",
        "api_name": "Account",
        "family": "standard",
        "evidence": ["support-model"]
      },
      {
        "id": "case",
        "label": "Case",
        "api_name": "Case",
        "family": "standard",
        "evidence": ["support-model"]
      }
    ],
    "relationships": [
      {
        "id": "account-cases",
        "from": "account",
        "to": "case",
        "type": "lookup",
        "from_cardinality": "one",
        "to_cardinality": "many",
        "evidence": ["support-model"]
      }
    ]
  }
}
```

Cardinality values are `one`, `many`, `zero_or_one`, and `zero_or_many`. Do not infer optionality. Relationship types are `lookup` and `master_detail`. Data Model connectors render without relationship-end or field-name text: lookup is black medium dotted, master-detail is red medium solid, and the endpoint markers carry cardinality.

Data Model canvases show only the title as full-width header text. Scope and grounding remain in the report. The separate stacked **Relationships** key shows both visual line samples by default; configure **Legend — Relationships** or pass `legend_relationships="show" | "hide"` for one render. Hide preserves existing card positions, while new, replace, and relayout renders move the graph to the compact title-only top margin.

Optional sourced observations include `row_count`, `owd`, and `record_types`. Spec v2 always uses deterministic automatic layout; source positions and endpoint anchors are not accepted.

## System/Solution Architecture

```json
{
  "action": "render_salesforce_architecture",
  "spec": {
    "spec_version": "2.0",
    "family": "architecture",
    "title": "Support intake architecture",
    "scope": "Declared systems and directional responsibilities.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-27",
      "sources": [
        {
          "id": "architecture-guide",
          "label": "Salesforce Well-Architected",
          "url": "https://architect.salesforce.com/well-architected/overview",
          "kind": "official_doc"
        }
      ]
    },
    "systems": [
      {
        "id": "channel",
        "label": "Customer channel",
        "kind": "external",
        "responsibility": "Collects support requests.",
        "evidence": ["architecture-guide"]
      },
      {
        "id": "service",
        "label": "Service solution",
        "kind": "salesforce",
        "responsibility": "Manages support work.",
        "evidence": ["architecture-guide"]
      }
    ],
    "connections": [
      {
        "id": "submit",
        "from": "channel",
        "to": "service",
        "label": "Submit request",
        "meaning": "directional",
        "evidence": ["architecture-guide"]
      }
    ]
  }
}
```

Connection meanings are `directional`, `async_or_batch`, and `dependency`. Opposite directions are separate connections. Product marks are not part of Spec v2; use sourced SLDS or semantic icons.

## Interaction/Sequence

```json
{
  "action": "render_salesforce_sequence",
  "spec": {
    "spec_version": "2.0",
    "family": "sequence",
    "title": "Support submission sequence",
    "scope": "Ordered request and response interactions.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-27",
      "sources": [
        {
          "id": "support-model",
          "label": "Salesforce support data model",
          "url": "https://developer.salesforce.com/docs/platform/data-models/guide/service-cloud-overview.html",
          "kind": "official_doc"
        }
      ]
    },
    "participants": [
      { "id": "user", "label": "Support user", "kind": "user", "evidence": ["support-model"] },
      {
        "id": "service",
        "label": "Service solution",
        "kind": "salesforce",
        "evidence": ["support-model"]
      }
    ],
    "interactions": [
      {
        "id": "create",
        "step": 1,
        "from": "user",
        "to": "service",
        "label": "Create case",
        "kind": "request",
        "evidence": ["support-model"]
      },
      {
        "id": "confirm",
        "step": 2,
        "from": "service",
        "to": "user",
        "label": "Return case number",
        "kind": "response",
        "evidence": ["support-model"]
      }
    ]
  }
}
```

Interaction kinds are `request`, `response`, `async`, and `event`. Steps are unique and contiguous from 1. Activations are optional, explicit, evidenced intervals; they are never inferred. Self-interactions and overlapping activations for one participant are rejected.

## Update modes

- `preserve` — update managed content while preserving human positions and user annotations.
- `relayout` — move managed groups to deterministic automatic layout.
- `replace` — rebuild only shapes carrying `meta.sfTldraw.managed === true`.

## Output modes

- `summary` — compact text, thumbnail, and artifact references.
- `inline` — summary plus bounded validation/readiness, warning, route, and evidence-source detail.
- `file_only` — artifact references without image content.

## Readiness

A successful render requires:

- strict family-matched Spec v2 validation
- zero actionable tldraw lints
- correctly bound semantic connectors
- valid marker and sequence geometry
- contained card text and profile typography
- screenshot evidence from the rendered page

Warnings remain visible for optional evidence gaps or unavoidable dense-layout traffic. Readiness blockers never report completion.
