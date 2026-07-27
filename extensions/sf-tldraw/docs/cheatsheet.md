# `tldraw_canvas` cheatsheet

Load this reference only for tldraw work. Explicit Mermaid or text requests take precedence.

## Recommended flow

1. `status`
2. `documents` when more than one tldraw document may be open
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
        "from_label": "account for",
        "to_label": "cases",
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

SLDS icons automatically use their authentic bundled Design System colors. For standard objects, omit the whole `icon` field when the logical/API name maps to a bundled standard icon; the renderer verifies the asset and otherwise falls back safely. Use `icon.color` only for an explicit presentation override.

`family` drives the card border: `standard` blue, `custom` light orange, `special` light pink, `external` light green. Card interiors default to the white/transparent-style treatment. Set `card_fill="family"` on the render call, or change **Card fill** in SF Pi Manager, to apply the same family tint to card interiors. Optional `entity_kind` values add Gallery implementation semantics: `object` solid, `conceptual` dotted, `record_type` dashed, and `external` borderless-style. `api_name` can be omitted when the authoritative model does not publish one.

Automatic layout evaluates a bounded LR/TB × ranker × spacing matrix. Each candidate repeatedly recounts final-side traffic, elongates hubs, packs disconnected components, and is scored by card obstructions, route crossings, shared corridors, path length, area, and aspect. Runtime ports follow opposite-end geometry rather than relationship-id order.

To preserve an official poster arrangement, set `layout_mode` to `source` and give every object an evidenced `source_position`:

```json
{
  "layout_mode": "source",
  "objects": [
    {
      "id": "account",
      "label": "Account",
      "api_name": "Account",
      "family": "standard",
      "source_position": { "x": 120, "y": 480, "w": 320, "h": 180 },
      "evidence": ["objects"]
    }
  ]
}
```

Relationships can optionally provide evidenced `from_anchor`/`to_anchor` values such as `{ "side": "right", "fraction": 0.35 }`. Anchors must be provided as a pair. The renderer preserves both declared sides and their relative terminal order while enforcing marker clearance. Recursive relationships use an exterior route that honors declared sides. `from_label`, `to_label`, and `field_api_name` are optional and render on opaque borderless backings.

The bounded single-page hard cap for `data_model` is 160 objects and 260 relationships, with at most 36 relationship terminals on one object. Above 34 objects or 56 relationships the render still succeeds with a poster-scale readability warning. The renderer never silently splits or shrinks a model.

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

Data-model results quantify three kinds of traffic: `routeChecks` for routes behind unrelated cards, `routeCrossingChecks` for independent crossings, and `sharedCorridorChecks` for collinear traffic. These remain warnings because dense non-planar models can make them unavoidable; every binding and terminal is still verified. `markerOverlapChecks` is stricter: any overlap blocks readiness.

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
- zero overlapping cardinality-marker pairs
- exact requested page selected; failed page creation never falls through to another page
- logical-label/API-name gap of 8 ± 0.5 canvas units when an API name exists
- every data-model card fully containing its label, API name, and key fields
- no renderer `Error` fallback text
- full and thumbnail screenshots written to the run artifact directory
