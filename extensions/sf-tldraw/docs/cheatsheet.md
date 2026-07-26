# `tldraw_canvas` cheatsheet

Load this reference only for tldraw work. Explicit Mermaid or text requests take precedence.

## Recommended flow

1. `status`
2. `documents` when more than one board may be open
3. Gather facts with the owning SF Pi capability:
   - official reference: `sf_docs`
   - org schema/relationships: `sf_soql` describe/relationships
   - org sharing/count evidence: bounded `sf_soql` queries or metadata retrieval
4. Build a grounded spec. Never infer missing facts.
5. Call one Salesforce render action.
6. Accept completion only when `readiness.ready=true` and screenshot evidence is returned.

## Runtime actions

```json
{ "action": "status" }
{ "action": "documents" }
{ "action": "search", "query": "Case" }
{ "action": "screenshot", "document_id": "<id>", "size": "small", "screenshot_mode": "canvas" }
{ "action": "script_status", "document_id": "<id>" }
```

Raw execution and script workspace creation require explicit acknowledgements:

```json
{
  "action": "execute",
  "document_id": "<id>",
  "acknowledge_raw_canvas": true,
  "script": "return editor.getCurrentPageShapes().length"
}
```

```json
{
  "action": "script_workspace",
  "document_id": "<id>",
  "acknowledge_workspace_creation": true
}
```

## Common spec contract

Every render spec contains:

```json
{
  "spec_version": "1.0",
  "family": "data_model",
  "title": "Support data model",
  "scope": "Core customer-support records and declared relationships.",
  "grounding": {
    "mode": "reference",
    "as_of": "2026-07-25",
    "sources": [
      {
        "id": "service-model",
        "label": "Salesforce Service Overview Data Model",
        "url": "https://developer.salesforce.com/docs/platform/data-models/guide/service-cloud-overview.html",
        "kind": "official_doc"
      }
    ]
  }
}
```

For org grounding:

```json
{
  "mode": "org",
  "display_label": "Authenticated sandbox",
  "target_org": "local-alias",
  "as_of": "2026-07-25T12:00:00Z",
  "sources": [
    { "id": "schema", "label": "Object describe", "kind": "org_describe" },
    { "id": "counts", "label": "Bounded record counts", "kind": "org_query" }
  ]
}
```

`target_org` is execution provenance only. It is not rendered or persisted in the report.

Every semantic element has an `evidence` array containing declared source ids.

## Data Model

```json
{
  "action": "render_salesforce_data_model",
  "render_mode": "preserve",
  "spec": {
    "spec_version": "1.0",
    "family": "data_model",
    "title": "Support data model",
    "scope": "A compact reference-grounded support model.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-25",
      "sources": [
        {
          "id": "objects",
          "label": "Salesforce Object Reference",
          "url": "https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/sforce_api_objects_list.htm",
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
        "icon": { "category": "standard", "name": "account" },
        "evidence": ["objects"]
      },
      {
        "id": "case",
        "label": "Case",
        "api_name": "Case",
        "family": "standard",
        "icon": { "category": "standard", "name": "case" },
        "evidence": ["objects"]
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
        "field_api_name": "AccountId",
        "evidence": ["objects"]
      }
    ]
  }
}
```

Cardinality values are `one`, `many`, `zero_or_one`, or `zero_or_many`. Do not invent optionality. Full optionality appears only with `cardinality_detail="full"`.

Per-render presentation overrides:

```json
{
  "cardinality_detail": "full",
  "card_fill": "transparent"
}
```

`card_fill` accepts `transparent` (default white/transparent-style card) or `family`.

`type` drives the connector itself, so there are no repeated `LK`/`MD` label boxes:

- `lookup` renders a grey dotted orthogonal connector with grey terminals
- `master_detail` renders a red solid orthogonal connector with red terminals

SLDS icons automatically use their authentic bundled Design System colors, so omit `icon.color` unless an explicit presentation override is required.

`family` drives the card border: `standard` blue, `custom` light orange, `special` light pink, `external` light green. Card interiors default to the white/transparent-style treatment. Set `card_fill="family"` on the render call, or change **Card fill** in SF Pi Manager, to apply the same family tint to card interiors.

A degree-aware second layout pass elongates hubs with many relationships along the side carrying their connection points. Anchor slots use a deterministic pitch, and every DAG orientation/ranker candidate is scored only after its own hub-growth pass.

The single-page hard cap for `data_model` is 34 objects and 56 relationships. Above 18 objects or 28 relationships the render still succeeds and returns a readability warning; prefer splitting a large model into several scoped pages, as reference sheets normally do.

Optional sourced observations:

```json
{
  "row_count": { "value": 2400000, "exact": false },
  "owd": "Private",
  "record_types": ["Customer", "Partner"]
}
```

## System/Solution Architecture

```json
{
  "action": "render_salesforce_architecture",
  "spec": {
    "spec_version": "1.0",
    "family": "architecture",
    "title": "Case intake architecture",
    "scope": "Declared systems and directional integration responsibilities.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-25",
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
        "icon": { "category": "utility", "name": "world" },
        "evidence": ["architecture-guide"]
      },
      {
        "id": "service",
        "label": "Service solution",
        "kind": "salesforce",
        "responsibility": "Manages declared support work.",
        "icon": { "category": "standard", "name": "case" },
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

Connection meanings: `directional`, `async_or_batch`, `dependency`. Labels are required. Opposite directions are separate connections.

## Interaction/Sequence

```json
{
  "action": "render_salesforce_sequence",
  "interaction_mode": "static",
  "spec": {
    "spec_version": "1.0",
    "family": "sequence",
    "title": "Case submission sequence",
    "scope": "Ordered request and response interactions.",
    "grounding": {
      "mode": "reference",
      "as_of": "2026-07-25",
      "sources": [
        {
          "id": "service-model",
          "label": "Salesforce Service Overview Data Model",
          "url": "https://developer.salesforce.com/docs/platform/data-models/guide/service-cloud-overview.html",
          "kind": "official_doc"
        }
      ]
    },
    "participants": [
      { "id": "user", "label": "Support user", "kind": "user", "evidence": ["service-model"] },
      {
        "id": "service",
        "label": "Service solution",
        "kind": "salesforce",
        "evidence": ["service-model"]
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
        "evidence": ["service-model"]
      },
      {
        "id": "confirm",
        "step": 2,
        "from": "service",
        "to": "user",
        "label": "Return case number",
        "kind": "response",
        "evidence": ["service-model"]
      }
    ],
    "activations": [
      {
        "id": "case-work",
        "participant": "service",
        "start_step": 1,
        "end_step": 2,
        "evidence": ["service-model"]
      }
    ]
  }
}
```

Interaction kinds are `request`, `response`, `async`, and `event`. Steps are unique and contiguous from 1. Message labels use measured borderless backings so intermediate lifelines and activation bars can't cross the text. Activation intervals are optional, explicit, and evidenced; the renderer never infers processing duration. Activation intervals for one participant can't overlap until nested-bar routing is supported. Self-interactions are rejected until loop routing is supported. The single-page budget is eight participants and 18 interactions, with readability warnings above six participants or 12 interactions. Static is the default; there is no autoplay.

Data-model renders also report `routeChecks`: connectors whose orthogonal route passes behind an unrelated card. These are warnings, not blockers — the binding is still correct — but they mean the picture is harder to read, so prefer a narrower scope or `render_mode="relayout"`.

## Update modes

- `preserve` — update managed content without moving grouped cards; recompute connector decorations.
- `relayout` — move managed groups to the deterministic layout.
- `replace` — rebuild only extension-managed shapes.

User-created annotations are never removed.

## Readiness

A successful result requires:

- valid family-matched, explicitly grounded spec
- zero actionable tldraw lints
- every semantic connector bound through tldraw helpers
- marker anchor-to-terminal distance ≤ 1 canvas unit
- markers oriented outward along the relationship, never into a card
- logical-label/API-name gap of 8 ± 0.5 canvas units
- every data-model card fully containing its label, API name, and key fields
- no renderer `Error` fallback text
- full and thumbnail screenshots written to the run artifact directory
