# SF tldraw modernization roadmap

This roadmap applies the accepted decisions in [ADR 0089](../../docs/adr/0089-sf-tldraw-uses-deterministic-salesforce-diagram-profiles.md) to tldraw offline v1.12. Work lands as serial deletion-gated milestones: each milestone updates its tests and docs, deletes its superseded path, and passes focused plus repository validation before the next begins.

## Product boundary

SF tldraw remains one deep Salesforce module:

- The upstream `tldraw-offline` Pi skill owns generic canvas inspection, editing, screenshots, recipes, and durable document scripts.
- SF tldraw owns Salesforce Diagram Specs, grounding and provenance, Salesforce diagram profiles, SLDS assets, managed-element preservation, readiness, and evidence artifacts.
- Existing SF Pi capability owners gather documentation and org evidence before rendering.

The extension-owned settings page keeps its current visual and interaction experience. Shared descriptors may replace duplicated setting semantics behind that interface.

## P0 — tldraw offline v1.12 runtime contract

**Status: implemented and validated.**

- Raise the **tldraw Runtime Floor** to v1.12 and remove legacy route fallbacks.
- Establish temporary **tldraw Runtime Contract Proof** from required markers in the app-owned `/readme` contract. Replace this proof when upstream provides machine-readable version or capability metadata.
- Follow **Upstream tldraw Skill Ownership**:
  - Never add `tldraw-offline` to SF Pi's packaged `pi.skills` resources.
  - Never copy, extract, rewrite, or overwrite the app-managed skill.
  - Check **tldraw Skill Readiness** only during explicit status and relevant recovery flows.
  - Verify the Pi skill exists with the tldraw managed marker and, when the app-managed manifest is available, that it records the current app version and Pi skill target.
  - Report missing or stale wiring with the recovery: open tldraw offline and choose **Develop → Install Agent Skills**.
  - Treat skill readiness as setup guidance, not a Salesforce render blocker.
- Add `create_document` backed by `POST /api/docs/create`.
  - Accept only a document name.
  - Use tldraw's default Documents directory.
  - Never overwrite or auto-suffix a collision.
  - Return the created document id for the next render.
  - Do not add an acknowledgement field or interactive confirmation; the separate visible tool call is sufficient.
- A render never creates a file implicitly when no document is open.
- Stop reporting unadvertised creation as unavailable. A runtime that cannot prove the v1.12 contract is incompatible.

### P0 verification

- Contract tests for v1.12 proof, missing markers, authentication, timeout, and redaction.
- Skill-readiness tests for current, missing, stale, unmanaged, and relocated-Pi-directory cases without mutating any skill files.
- Route tests for successful creation, invalid names, collisions, and unsupported runtimes.
- Tool tests proving the returned document id can be passed directly to a render.
- Opt-in live proof against a disposable v1.12 document; no automatic file deletion.

## P1 — delivered-interface cleanup

**Status: implemented and validated.**

- Preserve the custom settings page experience while allowing descriptor-backed internals.
- Remove the nonfunctional Step-through preference and tool input. The remaining settings are:
  - Cardinality Presentation
  - Card fill
  - LDV threshold
  - Record-type presentation
- Keep all three render output modes and make their contracts distinct:
  - `summary`: compact text, thumbnail, and artifact references
  - `inline`: summary plus bounded validation/readiness details, warnings, route metrics, and evidence-source summary
  - `file_only`: artifact references without image content
- Remove the deferred loopback startup probe. Server-config presence publishes **On-Demand Capability Availability**; explicit status, document, create, and render calls publish verified readiness.
- Consolidate repeated status/document discovery and formatting behind one internal result path.
- Do not change the Salesforce Diagram Spec in this milestone.

### P1 verification

- Settings tests preserve project → global → default resolution and the current keyboard/save/navigation experience.
- Startup tests prove there is no loopback request or timer.
- Command and tool tests consume the same status/document result.
- Output-mode tests enforce bounded inline detail and no image content in `file_only`.

## P2 — Salesforce Diagram Spec v2

**Status: implemented and validated.**

- Introduce strict `spec_version: "2.0"`. The provider schema advertises only the three v2 families; direct validation retains a stable wrong-version diagnostic plus regenerate/retry guidance. Do not add a v1 provider schema or compatibility adapter.
- Keep one provider-safe root tool object and three render action names.
- Define `spec` as a discoverable typed union of Data Model, Architecture, and Sequence schemas; enforce action ↔ family matching at execution.
- Set `additionalProperties: false` throughout and return path-specific unknown-field diagnostics.
- Derive static TypeScript types from the runtime schemas.
- Preserve semantic diagnostic codes and JSON paths; message wording may improve.
- Retain only semantic refinements not expressible in the structural schema, including:
  - source-reference integrity
  - unique ids and endpoint integrity
  - grounding requirements
  - family density and degree limits
  - sequence step and activation rules
  - render privacy
- Remove from Spec v2:
  - `product_mark`
  - `layout_mode`
  - `source_position`
  - relationship endpoint anchors
- Every family uses deterministic automatic layout.
- Every semantic element retains **Diagram Evidence References**. Artifacts expose the element-to-source mapping as inspectable provenance without claiming independent factual verification.
- Enforce **Diagram Render Privacy** across every rendered string. Reject authentication material, Salesforce org ids, usernames or email addresses, instance URLs, and authentication URLs. Execution-only `target_org` is neither rendered nor persisted.
- Shrink the lazy cheatsheet to workflow, grounding, update/readiness semantics, and one compact example per family. Do not duplicate the field-by-field schema.

### P2 verification

- Schema tests cover all three families, strict unknown fields, action/family mismatch, and v1 rejection.
- Mutation tests cover every retained semantic refinement and stable diagnostic path.
- Privacy fixtures place sensitive-looking values in every rendered text field.
- All checked-in specs and fixtures migrate to v2 in the same milestone.
- Compiled automatic-layout payloads remain deterministic.

## P3 — Salesforce-focused public action set

**Status: implemented and validated.**

Retain only:

- `status`
- `documents`
- `create_document`
- `render_salesforce_data_model`
- `render_salesforce_architecture`
- `render_salesforce_sequence`
- `cheatsheet`

Remove in the modernization release without a deprecation adapter:

- `search`
- raw `execute`
- standalone `screenshot`
- `script_workspace`
- `script_status`

Repository review found no code consumers outside SF tldraw and generated documentation. Generic capability remains available through the upstream `tldraw-offline` Pi skill. Runtime execute and screenshot operations remain private where Salesforce rendering requires them.

### P3 verification

- Tool schema and registration expose only the retained actions.
- Salesforce render paths still resolve documents, execute internally, capture evidence, redact failures, and reject unsafe screenshot sources.
- Generated catalog/docs and extension guidance point generic tldraw work to the upstream skill.
- Removed actions and their public-only tests, formatters, acknowledgements, and standalone artifacts are deleted in the same milestone.

## P4 — cross-family renderer simplification experiment

**Status: evaluated; no shared-layer replacement approved.**

The checked-in live smoke and 30-case sequence matrix pass. A temporary v2-normalized replay of the 230-case public Gallery corpus initially exposed dense cardinality-marker overlaps after legacy source geometry was removed. Automatic layout now reserves card capacity for both preferred and alternate routing sides, reserves self-loop capacity on both exterior sides, and keeps compact cards at least 110 units apart; the pinned corpus passes 230/230 with zero readiness blockers at hash `b480b8b855aa0ce76b93913c73c384494f802149025ba3faf84182efe7600539`. Checked-in per-model maxima for route obstructions, independent-route crossings, and shared corridors make any regression against that qualified baseline fail the live matrix while allowing improvements.

The v1.12 helper review found no replacement that passes the deletion test. SF tldraw already uses `createArrowBetweenShapes`, `translateShapes`, and `getLints`; `createShapeIfMissing` intentionally does not update existing shapes and therefore cannot satisfy managed-content refresh with preserve-mode positioning. `boxShapes` does not implement the Salesforce profile contract, and document scripts use the wrong durability level. The experimental larger-pitch path was deleted, and the current shared renderer remains until upstream exposes an equivalent managed-diagram primitive that produces net deletion without behavior loss.

The first experiment covers Data Model, Architecture, and Sequence together, but only at their shared canvas apply/reconcile/readiness seam.

It must preserve:

- Spec v2 semantics
- each family's deterministic automatic layout
- stable managed semantic ids and roles
- preserve/relayout/replace behavior
- user annotations and positions under preserve mode
- Salesforce readiness and evidence contracts

The experiment can use newer native tldraw helpers for common shape application, reconciliation, grouping, bindings, layering, lint collection, and evidence. It does not replace all family layout/routing algorithms, move static rendering into persistent document scripts, or introduce a generic drawing language.

### Evidence corpus

Replacement requires both:

1. checked-in public-safe golden fixtures that run in CI, and
2. pinned external Gallery and sequence corpora used for manual release qualification with expected count and hash.

The baseline is the completed Spec v2 automatic renderer after P0–P3, not the legacy source-layout renderer.

### Acceptance gate

The replacement must prove:

- the same managed semantic ids and roles
- zero readiness blockers and actionable tldraw lints
- no worse readiness, route-obstruction, crossing, shared-corridor, typography, binding, or marker metrics
- preservation of user-created annotations and human-managed positions
- approved bounded visual samples across all three families
- net production-code deletion
- fewer duplicated apply/reconcile paths
- no new hypothetical seam with only one adapter

Old and experimental implementations coexist only in tests or an isolated spike. If the experiment passes, replace the production path atomically and delete the old path in the same change. If it fails, delete the experiment.

## Non-goals

- Replacing tldraw offline with the tldraw SDK Agent Starter Kit
- Adding MCP or another Pi process between SF tldraw and the local Canvas API
- Reimplementing the upstream generic tldraw skill
- Adding diagram families, settings, layout strategies, or readiness metrics during modernization
- Persisting static diagrams through document scripts
- Weakening script trust, screenshot validation, grounding, provenance, render privacy, or managed-element ownership
