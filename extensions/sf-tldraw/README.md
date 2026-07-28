# SF tldraw — Code Walkthrough

## What It Does

`sf-tldraw` connects pi to the local **tldraw offline** Canvas API and renders editable Salesforce diagrams from explicit, evidence-backed specs. It owns one family tool, `tldraw_canvas`, and three deterministic Salesforce profiles:

- Data Model
- System/Solution Architecture
- Interaction/Sequence

Explicit Mermaid or text requests still win. The extension does not query a Salesforce org or documentation service itself; callers use the appropriate SF Pi capability owner and pass normalized evidence into the diagram spec.

## Runtime Flow

```text
Extension loads
  ├─ registers /sf-tldraw and tldraw_canvas
  ├─ performs no live API or process work during module load
  └─ session_start publishes local server-config presence as Available
     without making a loopback request; explicit status, document, create,
     and render interactions publish verified runtime readiness

Explicit tool/command action
  ├─ rereads tldraw's per-launch port + bearer token
  ├─ probes or resolves an already-open document
  ├─ validates explicit reference/org grounding
  ├─ compiles a deterministic profile and layout
  ├─ executes one fixed editor program
  ├─ checks tldraw lints, connector terminals, and typography
  └─ captures full + thumbnail evidence only when readiness passes
```

## Behavior Matrix

| Event/Action        | Condition                                             | Result                                                                         |
| ------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| Extension load      | Always                                                | Registers `/sf-tldraw` and `tldraw_canvas`; performs no live runtime work.     |
| `session_start`     | Local server config exists                            | Publishes on-demand availability without a loopback request or deferred timer. |
| `/sf-tldraw`        | Interactive, no arguments                             | Opens the extension in SF Pi Manager.                                          |
| `/sf-tldraw status` | Explicit invocation                                   | Probes the Canvas API and publishes live readiness or an actionable fault.     |
| Salesforce render   | Valid grounded spec and open document                 | Reconciles managed shapes, checks readiness, and captures evidence.            |
| Salesforce render   | Any validation, lint, geometry, or screenshot failure | Returns a blocker and does not report completion.                              |
| Update              | `render_mode="preserve"`                              | Keeps existing managed-group positions and all user annotations.               |
| Relayout/replace    | Explicit request                                      | Moves or rebuilds only extension-managed shapes.                               |

## Canvas API Boundary

SF tldraw uses this v1.12 route set:

- `POST /api/search`
- `POST /api/docs/create`
- `POST /api/doc/:id/exec`

Screenshots use `api.getScreenshot()` inside `/api/search`. Generic canvas search, raw execution, standalone screenshots, and document scripts remain available through the upstream `tldraw-offline` Pi skill rather than the SF tldraw tool.

Until tldraw exposes machine-readable version or capability metadata, `sf-tldraw` proves the v1.12 contract from required markers in the app-owned `/readme`. Older or incomplete runtimes are incompatible. `create_document` is a separate visible tool action that accepts only a file name, saves through tldraw's Documents-directory default, and returns the new document id; render actions never create a file implicitly. SF tldraw deliberately refuses to use OS automation or direct `.tldraw` generation.

Source screenshots are accepted only as regular JPEG/PNG files inside tldraw's dedicated temporary capture directory. Private artifact directories use mode `0700`; reports and copied images use `0600`. A failed validation or copy blocks render success.

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
  lib/
    artifacts.ts            ← implementation module
    assets.ts               ← implementation module
    canvas-program.ts       ← implementation module
    command-surface.ts      ← implementation module
    config-panel.ts         ← implementation module
    layout.ts               ← implementation module
    profiles.ts             ← implementation module
    redaction.ts            ← implementation module
    renderer.ts             ← implementation module
    runtime-client.ts       ← implementation module
    runtime-surface.ts      ← implementation module
    settings.ts             ← implementation module
    spec-schema.ts          ← implementation module
    spec-validation.ts      ← implementation module
    tldraw_canvas-tool.ts   ← implementation module
    types.ts                ← implementation module
  tests/
    artifacts.test.ts       ← unit / smoke test
    data-model-gallery-matrix.live.test.ts← unit / smoke test
    deferred-status.test.ts ← unit / smoke test
    live-runtime.test.ts    ← unit / smoke test
    profiles.test.ts        ← unit / smoke test
    redaction.test.ts       ← unit / smoke test
    renderer.test.ts        ← unit / smoke test
    runtime-client.test.ts  ← unit / smoke test
    sequence-matrix.live.test.ts← unit / smoke test
    sequence-profile.test.ts← unit / smoke test
    settings.test.ts        ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    spec-validation.test.ts ← unit / smoke test
    tldraw_canvas-tool.test.ts← unit / smoke test
  AGENTS.md                 ← extension-specific agent editing rules
  CREDITS.md                ← extension attribution
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  ROADMAP.md                ← extension-specific phased roadmap
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Focused tests cover:

- cache-only startup availability with no deferred loopback probe
- strict Spec v2-only provider schema, grounding, provenance, and render-privacy validation
- deterministic graph/lane layout
- preference inheritance and clearing
- bearer-authenticated endpoint contracts and redaction
- transform-correct marker program generation
- command/tool registration
- an opt-in live render smoke against an already-open local board

Run targeted tests with:

```bash
npx vitest run extensions/sf-tldraw/tests
```

With a local board open, run the 30-case OAuth, SSO, and integration visual-hardening matrix with:

```bash
SF_TLDRAW_SEQUENCE_MATRIX=1 npx vitest run extensions/sf-tldraw/tests/sequence-matrix.live.test.ts
```

The matrix runs serially, validates every managed shape, captures full and thumbnail evidence, and writes private `index.json`, `report.html`, and `report.md` artifacts under `tldraw-artifacts/sequence-matrix/`. A case is ready only when label backings mask every intersecting lifeline or activation bar in the verified z-order.

A normalized external Data Model Gallery corpus can be replayed without committing Salesforce/Lucidchart source material. The manifest is a JSON array of `{ index?, slug, category, title, file }`. Every `file` must resolve inside the manifest directory, and slugs must match `[a-z0-9][a-z0-9-]{0,79}`. The stable case identity is `index-slug`, so the same public model title can legitimately recur in different product categories. Reuse one existing page for large corpora so the desktop document's page cap does not affect the run. Pin the expected count/hash for release qualification:

```bash
SF_TLDRAW_DATA_MODEL_GALLERY_MANIFEST=/path/to/spec-manifest.json \
SF_TLDRAW_DATA_MODEL_GALLERY_PAGE="Gallery Verification" \
SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_COUNT=230 \
SF_TLDRAW_DATA_MODEL_GALLERY_EXPECTED_HASH=<sha256> \
npx vitest run extensions/sf-tldraw/tests/data-model-gallery-matrix.live.test.ts
```

Set `SF_TLDRAW_DATA_MODEL_GALLERY_LEGEND_RELATIONSHIPS=hide` to qualify the compact title-only layout; omitted means the default `show` mode.

The run validates and compiles every case deterministically, renders serially, requires zero lints and marker overlaps, captures each full/thumbnail artifact, and writes a private index plus Markdown report under `tldraw-artifacts/data-model-gallery-matrix/`. When the corpus hash matches the checked-in qualified baseline, every model also enforces its pinned maximum route-obstruction, independent-crossing, and shared-corridor counts; lower counts are accepted as improvements.

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

**A v1 spec or removed presentation field is rejected:**
Regenerate the request as strict Spec v2. Product marks, source positions, endpoint anchors, and layout mode are not accepted.
