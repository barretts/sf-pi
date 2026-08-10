# SF tldraw

## What It Does

`sf-tldraw` connects pi to the local **tldraw offline** Canvas API and renders editable Salesforce diagrams from explicit, evidence-backed specs. It owns one family tool, `tldraw_canvas`, and three deterministic Salesforce profiles:

- Data Model
- System/Solution Architecture
- Interaction/Sequence

Explicit Mermaid or text requests still win. The extension does not query a Salesforce org or documentation service itself; callers use the appropriate SF Pi capability owner and pass normalized evidence into the diagram spec.

## Canvas API Boundary

SF tldraw uses this v1.12 route set:

- `POST /api/search`
- `POST /api/docs/create`
- `POST /api/doc/:id/exec`

Screenshots use `api.getScreenshot()` inside `/api/search`. Generic canvas search, raw execution, standalone screenshots, and document scripts remain available through the upstream `tldraw-offline` Pi skill rather than the SF tldraw tool.

Until tldraw exposes machine-readable version or capability metadata, `sf-tldraw` proves the v1.12 contract from required markers in the app-owned `/readme`. Older or incomplete runtimes are incompatible. `create_document` is a separate visible tool action that accepts only a file name, saves through tldraw's Documents-directory default, and returns the new document id; render actions never create a file implicitly. SF tldraw deliberately refuses to use OS automation or direct `.tldraw` generation.

Source screenshots are accepted only as regular JPEG/PNG files inside tldraw's dedicated temporary capture directory. Files are opened without following symbolic links, validated and read through one descriptor, then written as exclusive `0600` artifact snapshots to avoid check/use races. Private artifact directories use mode `0700`. A failed validation or copy blocks render success.

The `tldraw-offline` Pi skill remains app-owned. Explicit status checks verify the app-managed marker and install manifest when available, but SF Pi never packages, copies, or rewrites a competing skill. Missing or stale wiring points users to **Develop → Install Agent Skills** in tldraw offline and does not block Salesforce rendering.

## Tool Actions

| Action                           | Purpose                                                                |
| -------------------------------- | ---------------------------------------------------------------------- |
| `status`                         | Probe runtime and capability readiness.                                |
| `documents`                      | List open document ids.                                                |
| `create_document`                | Create a named `.tldraw` file in Documents and return its document id. |
| `cheatsheet`                     | Lazily load the spec/action reference.                                 |
| `render_salesforce_data_model`   | Render object cards, relationships, observations, and cardinality.     |
| `render_salesforce_architecture` | Render systems, boundaries, and labeled connections.                   |
| `render_salesforce_sequence`     | Render fixed participant lanes and ordered interactions.               |

Render output modes are distinct: `summary` returns compact text, a thumbnail, and artifact references; `inline` adds bounded readiness, route, warning, and evidence-source detail; `file_only` returns artifact references without image content.

## Deterministic Rendering

### Grounding

Every strict Spec v2 declares `grounding.mode` as `reference` or `org`. Reference sources must be official Salesforce documentation URLs. Every object, system, relationship, connection, participant, and interaction cites one or more declared source ids. Render reports persist the element-to-source mapping as inspectable provenance without claiming independent factual verification. Unknown fields are rejected, and every rendered string is checked for auth material, org ids, usernames or email addresses, instance URLs, and authentication URLs.

### Data model grammar

- White object cards by default, with object-family borders: blue standard, light orange custom, light pink other, light green external
- Optional family-tinted card fill through the `cardFill` setting or per-render `card_fill="family"`
- Authentic per-icon SLDS tile colors read from the bundled Design System stylesheet; verified standard-object icons are inferred from label/API name when a zero-shot spec omits presentation metadata
- Logical label plus optional parenthesized API name with an 8-unit measured gap; references that do not publish a physical API name can omit it
- Solid physical-object cards, dotted conceptual cards, dashed record-type cards, and borderless-style external entities
- Content-fitted base card size, followed by a measured height/width grow pass so text always stays inside its card
- Bounded convergence passes: high-connection hubs elongate after every relayout until the final sides retain distinct terminal slots
- Optional, sourced LDV and OWD pills at fixed anchors
- Relationship kind carried by the connector itself: black medium dotted lookup, red medium solid master-detail. No repeated `LK`/`MD` label boxes
- Orthogonal (elbow) connectors use deterministic facing and alternate side plans scored by card obstructions, independent-edge crossings, shared corridors, and length
- Spec v2 always uses deterministic automatic layout; source positions and endpoint anchors are rejected
- Parallel connectors and terminals are ordered geometrically rather than by relationship id
- Recursive relationships use explicit exterior three-segment loops with two distinct card ports
- Only the title renders as full-width Data Model header text; scope, grounding, source, and as-of remain in the artifact report, while the prose legend is replaced by the visual Relationships key
- Optional separate stacked **Relationships** key with actual black dotted Lookup and red solid Master-Detail samples; hidden new/relayout renders use a compact title-only top margin
- No relationship-end names or field API names on the canvas; cardinality markers and connector styling carry the relationship semantics
- Vector cardinality markers in the relationship's own tone, attached to actual clipped arrow terminals; marker overlap is a readiness blocker
- Object cards re-fronted after connectors exist, because tldraw keeps a bound arrow above the shapes it binds to
- No record-type display by default

Automatic layout evaluates a fixed matrix of rank direction, ranker, and spacing strategies. Each candidate converges hub dimensions for both preferred and eligible alternate routing sides, reserves self-loop capacity on both exterior sides, enforces at least 110 units between compact peer cards, packs disconnected components into landscape shelves, and is scored by estimated card obstructions, independent-edge crossings, shared corridors, route length, area, and aspect—in that order.

A data-model page accepts up to 160 entities and 260 relationships, covering the current official Gallery maximum of 127/188 with a bounded margin. One object can carry at most 36 relationship terminals—the capacity of a 2,400-unit side at the verified pitch. Pages above 34/56 receive a poster-scale readability warning rather than being silently split or shrunk.

Marker placement solves the local marker anchor through tldraw's origin-based shape transform. For elbow connectors the terminal direction comes from the resolved orthogonal route rather than the binding handles. Readiness then resolves the anchor back into page space with `getShapePageTransform()` and requires a terminal distance of at most one canvas unit. This covers horizontal, reversed, diagonal, and vertical connectors.

### Sequence grammar

Sequence diagrams use a dedicated integration-flow profile instead of the graph-card grammar:

- 96-unit pastel participant headers with content-sized widths from 260–360 units
- participant gaps of 140, 120, or 110 units for 1–4, 5–6, or 7–8 lanes
- no generated fallback icons; an explicitly declared icon is rendered at 44 units
- neutral lifelines and arrows with unboxed, numbered message labels on measured borderless white backings
- solid request/event arrows, dashed responses, and dotted asynchronous messages
- message rows begin at 520 units, use a 118-unit baseline gap, and add 52 units of visual breathing room when a completed exchange changes participant pairs
- optional activation bars only from explicit, evidenced `activations`; processing duration is never inferred

A single page accepts at most eight participants and 18 interactions, with readability warnings above six participants or 12 interactions. Self-interactions are rejected until loop routing can be verified, and activation intervals for one participant cannot overlap until nested-bar routing is supported. Readiness checks participant-label containment, lane separation, activation alignment, message-label bounds and row separation, semantic bindings, lints, and screenshot evidence.

### Updates

`render_mode="preserve"` is the default. It updates managed content and recomputes connector decorations without moving existing grouped cards or user annotations. `relayout` moves managed groups to the deterministic layout. `replace` rebuilds only shapes marked with `meta.sfTldraw.managed`; user-created annotations are never owned or removed.

## Settings

Only five scalar presentation choices are configurable:

- cardinality detail: `simplified` or `full`
- card fill: `transparent` (default white/transparent-style card) or `family` (family tint)
- LDV threshold: `1M`, `2M`, `5M`, or `10M`
- record-type mode: `off`, `auto`, or `always`
- **Legend — Relationships**: `show` (default) or `hide`

Each field resolves project → global → default. Project **Inherit global** and global **Use default** delete that scoped field. The extension-owned settings page preserves its existing visual and keyboard interaction style while sharing descriptor-backed setting semantics internally. Open it in SF Pi Manager to configure these defaults, or use per-render overrides such as `card_fill="transparent" | "family"` and `legend_relationships="show" | "hide"`. Hiding the key never moves preserved cards; new, replace, and relayout renders reclaim its vertical band.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-tldraw/
  docs/                       ← focused extension references
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  AGENTS.md                   ← agent editing rules
  CREDITS.md                  ← extension attribution
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Troubleshooting

**The tool says no tldraw document is open:**
Call `tldraw_canvas` with `action="create_document"` and a plain file name, then pass the returned `document_id` to the Salesforce render action. The new file is saved in the Documents directory.

**Status reports a stale server configuration:**
Quit and restart tldraw offline so it rewrites its per-launch `server.json` and bearer token.

**Status says the tldraw-offline Pi skill is missing, stale, or unmanaged:**
Open tldraw offline and choose **Develop → Install Agent Skills**. The app owns and updates this skill; SF Pi never overwrites it.

**A render says the document may have reached its page limit:**
The desktop document refused a new page. Reuse an existing extension-managed page with `render_mode="replace"`, or open another document and pass its `document_id`. sf-tldraw verifies page creation and never reports a render on the wrong page.

**A render is blocked by readiness checks:**
Inspect the returned blocker and screenshot only after correcting the spec or layout. A render with lints or detached connector decorations is intentionally not reported complete.
