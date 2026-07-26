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
  └─ session_start publishes local detection, then schedules a bounded
     post-first-paint loopback verification without awaiting it

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

| Event/Action        | Condition                                             | Result                                                                                              |
| ------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Extension load      | Always                                                | Registers `/sf-tldraw` and `tldraw_canvas`; performs no live runtime work.                          |
| `session_start`     | Local server config exists                            | Publishes `detected` immediately, then asynchronously republishes live readiness after first paint. |
| `/sf-tldraw`        | Interactive, no arguments                             | Opens the extension in SF Pi Manager.                                                               |
| `/sf-tldraw status` | Explicit invocation                                   | Probes the Canvas API and publishes live readiness.                                                 |
| Salesforce render   | Valid grounded spec and open document                 | Reconciles managed shapes, checks readiness, and captures evidence.                                 |
| Salesforce render   | Any validation, lint, geometry, or screenshot failure | Returns a blocker and does not report completion.                                                   |
| Update              | `render_mode="preserve"`                              | Keeps existing managed-group positions and all user annotations.                                    |
| Relayout/replace    | Explicit request                                      | Moves or rebuilds only extension-managed shapes.                                                    |

## Canvas API Boundary

The supported v1 route set is:

- `POST /api/search`
- `POST /api/doc/:id/exec`
- `POST /api/doc/:id/script-workspace`
- `GET /api/doc/:id/script-status`

Screenshots use `api.getScreenshot()` inside `/api/search`.

The currently available runtime does not expose `/api/capabilities` or native create-document operations. `sf-tldraw` therefore renders into an already-open document and can create a named page inside it. It deliberately refuses to use OS automation or direct `.tldraw` generation.

Source screenshots are accepted only as regular JPEG/PNG files inside tldraw's dedicated temporary capture directory. Private artifact directories use mode `0700`; reports and copied images use `0600`. A failed validation or copy blocks render success.

## Tool Actions

| Action                           | Purpose                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------- |
| `status`                         | Probe runtime and capability readiness.                                         |
| `documents`                      | List open document ids.                                                         |
| `search`                         | Search document/page metadata and bounded shape props.                          |
| `execute`                        | Raw editor escape hatch requiring acknowledgement and interactive confirmation. |
| `screenshot`                     | Validate and capture canvas/window evidence into a private artifact.            |
| `script_workspace`               | Workspace creation requiring acknowledgement and interactive confirmation.      |
| `script_status`                  | Inspect watcher/application state.                                              |
| `cheatsheet`                     | Lazily load the spec/action reference.                                          |
| `render_salesforce_data_model`   | Render object cards, relationships, observations, and cardinality.              |
| `render_salesforce_architecture` | Render systems, boundaries, and labeled connections.                            |
| `render_salesforce_sequence`     | Render fixed participant lanes and ordered interactions.                        |

## Deterministic Rendering

### Grounding

Every spec declares `grounding.mode` as `reference` or `org`. Reference sources must be official Salesforce documentation URLs. Every object, system, relationship, connection, participant, and interaction cites one or more declared source ids.

### Data model grammar

- Object-family fill: blue standard, light orange custom, light pink other, light green external
- Separate vivid SLDS icon tiles in the same family palette
- Logical label plus parenthesized API name with an 8-unit measured gap; API names never wrap
- Content-fitted card size, then a measured height/width grow pass so text always stays inside its card
- Optional, sourced LDV and OWD pills at fixed anchors
- Relationship kind carried by the connector itself: grey dotted lookup, red solid master-detail. No repeated `LK`/`MD` label boxes
- Orthogonal (elbow) connectors bound to precise facing card sides, with anchors spread along each side so parallel connectors and their terminals do not stack
- Vector cardinality markers in the relationship's own tone, attached to actual clipped arrow terminals
- Object cards re-fronted after connectors exist, because tldraw keeps a bound arrow above the shapes it binds to
- No record-type display by default

Layout tries every candidate rank direction and ranker, then keeps the one whose bounding box is closest to a landscape page, so hub-and-spoke reference models do not degrade into a single tall ladder.

Marker placement solves the local marker anchor through tldraw's origin-based shape transform. For elbow connectors the terminal direction comes from the resolved orthogonal route rather than the binding handles. Readiness then resolves the anchor back into page space with `getShapePageTransform()` and requires a terminal distance of at most one canvas unit. This covers horizontal, reversed, diagonal, and vertical connectors.

### Sequence grammar

Sequence diagrams use a dedicated integration-flow profile instead of the graph-card grammar:

- 96-unit pastel participant headers with content-sized widths from 260–360 units
- participant gaps of 140, 120, or 110 units for 1–4, 5–6, or 7–8 lanes
- no generated fallback icons; an explicitly declared icon or product mark is rendered at 44 units
- neutral lifelines and arrows with unboxed, numbered message labels on measured borderless white backings
- solid request/event arrows, dashed responses, and dotted asynchronous messages
- message rows begin at 520 units, use a 118-unit baseline gap, and add 52 units of visual breathing room when a completed exchange changes participant pairs
- optional activation bars only from explicit, evidenced `activations`; processing duration is never inferred

A single page accepts at most eight participants and 18 interactions, with readability warnings above six participants or 12 interactions. Self-interactions are rejected until loop routing can be verified, and activation intervals for one participant cannot overlap until nested-bar routing is supported. Readiness checks participant-label containment, lane separation, activation alignment, message-label bounds and row separation, semantic bindings, lints, and screenshot evidence.

### Updates

`render_mode="preserve"` is the default. It updates managed content and recomputes connector decorations without moving existing grouped cards or user annotations. `relayout` moves managed groups to the deterministic layout. `replace` rebuilds only shapes marked with `meta.sfTldraw.managed`; user-created annotations are never owned or removed.

## Settings

Only four scalar presentation choices are configurable:

- cardinality detail: `simplified` or `full`
- LDV threshold: `1M`, `2M`, `5M`, or `10M`
- record-type mode: `off`, `auto`, or `always`
- interaction mode: `static` or `step_through`

Each field resolves project → global → default. Project **Inherit global** and global **Use default** delete that scoped field.

`step_through` is source-gated: the initial implementation returns an explicit recovery to `static` rather than pretending controls exist or overwriting a pre-existing document script. It never autoplays.

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
    settings.ts             ← implementation module
    spec-validation.ts      ← implementation module
    tldraw_canvas-tool.ts   ← implementation module
    types.ts                ← implementation module
  tests/
    artifacts.test.ts       ← unit / smoke test
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
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Focused tests cover:

- strict grounding and evidence validation
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

## Troubleshooting

**The tool says no tldraw document is open:**
Open or create a board in tldraw offline, then run `tldraw_canvas` with `action="documents"`. Native document creation is not currently exposed by the Canvas API.

**Status reports a stale server configuration:**
Quit and restart tldraw offline so it rewrites its per-launch `server.json` and bearer token.

**A render is blocked by readiness checks:**
Inspect the returned blocker and screenshot only after correcting the spec or layout. A render with lints or detached connector decorations is intentionally not reported complete.

**A requested product mark uses a semantic icon:**
The mark has no bundled, provenance-approved asset. Add an official unmodified asset and update `CREDITS.md`; do not scrape or recolor a logo.
