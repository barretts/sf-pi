# SF Flow Agent Guide

Use `sf_flow` for the Flow-specific lifecycle. Normal Pi file tools own `.flow-meta.xml` edits. SF Flow does not deploy, activate, or execute Flows.

## Behavior-proof-first loop

1. Use `project.scan` to locate checked-in Flows or `author.plan` to select a Core Flow Family. Pass `target_org` only when object fields, action contracts, or subflow inputs/outputs must be grounded in that org. When `workspace` is supplied, file actions resolve paths relative to that explicit SFDX project instead of Pi's current directory.
2. Use `flow.inspect` to understand an existing Flow’s family, trigger, elements, connectors, and Mermaid topology.
3. Reproduce the intended behavior with a Flow test when one already exists and the defect is testable before editing.
4. Edit source with normal Pi file tools. Fast local diagnostics run automatically after successful Flow writes/edits.
5. Run `diagnose.file` explicitly with the `generation` profile during authoring and resolve High findings first. Use `review` for the broader implemented set. Treat skipped coverage as unknown, not clean.
6. Use `quality.rules` when rule status, profile membership, provenance, or planned coverage matters.
7. When diagnosis returns a safe quick fix, pass its exact `fix_id` and `source_version` to `fix.apply`. Re-diagnose after any normal business-logic edit instead of reusing a stale fix.
8. Run `validate.check` against the intended org. It validates one exact Flow with Metadata API `checkOnly=true` and saves nothing.
9. Use `test.plan` and `test.run` for the smallest relevant Flow or Flow test. Poll queued runs with `test.result`; use `test.rerun` only for the prior session-scoped target. Discovery is bounded and reads each selected FlowTest's Tooling API `Metadata` field in a separate single-row query. Runs submit asynchronously even when a wait is requested; SF Flow polls before fetching results. A skipped, aborted, failed, or zero-test terminal result is failed evidence, never a pass.

## Core Flow Family selection

- **Screen**: the process collects or displays information to a user. Validate input, avoid database writes before the first screen, and prevent backward navigation across irreversible actions.
- **Autolaunched**: another automation, API, or application invokes reusable background logic. Define explicit input/output variables and design retries to be idempotent.
- **Record-Triggered**: a record operation starts the Flow. Use before-save for same-record field updates; use after-save for related records or actions that require a committed record; use before-delete only for pre-deletion behavior.
- **Schedule-Triggered**: a global date/time schedule starts batches of matching records. Use selective criteria and idempotent processing.
- **Platform Event-Triggered**: an event message starts the Flow. Filter carefully, handle duplicate delivery, prevent self-publishing loops, and do not plan a Subflow element.

If intent does not establish a Core Flow Family or record transaction timing, call `author.plan` without guessing and use its clarification choices.

## Org-grounding boundary

With `target_org`, `author.plan` reads only bounded object/event describe data, matching invocable action details, and matching autolaunched subflow variable contracts. Missing permissions or endpoint failures become explicit grounding gaps. Grounding never mutates the org and never runs automatically after file edits.

Do not treat an unmatched action or subflow as proof that it is unavailable when coverage reports a gap or bounded truncation. Use the returned field/action/subflow contracts instead of inventing API names or inputs.

## Cross-family authoring patterns

- Plan the business process before writing metadata.
- Use descriptive labels, API names, and descriptions.
- Never hard-code Salesforce record IDs.
- Collect database changes in loops and perform one database operation afterward.
- Add fault paths to database and action elements that can fail.
- Keep reusable subflows small with explicit inputs and outputs; confirm that the caller supports Subflow and that the referenced version is appropriate.
- Treat running context and data access as part of the design, especially for screen/autolaunched flows and scheduled paths.
- Test branches, negative criteria, bulk behavior, retries, and failure paths.

## Preventive quality

`author.plan` compiles family-applicable generation constraints from the data-first quality catalog. The post-edit hook runs the same generation profile locally. High and Moderate findings are repair guidance; no rule silently mutates source.

Lightning Flow Scanner-inspired rules are independent SF Pi implementations. The pinned upstream package runs only in dev parity tests. Use `QUALITY_RULES.md` and `THIRD_PARTY_NOTICES.md` for provenance and coverage.

## Repair-loop boundary

Automatic edit feedback is progress-gated and bounded to three actionable rounds per file. It stops on clean source, a repeated finding signature, or the round limit. High and Moderate findings can steer; Low and Info findings remain available through explicit diagnosis.

The only mutating lifecycle action is `fix.apply`, and it owns exactly three deterministic transformations: project API version, Auto-Layout metadata, and exact unused-variable removal. Every fix is bound to a SHA-256 source version and participates in Pi's per-file mutation queue. All other repairs use normal Pi file tools.

## Evidence boundaries

- `diagnose.file` proves only the small local deterministic rule set.
- `validate.check` proves how the selected org validates the exact staged Flow at that time; it does not save the Flow.
- `test.run` proves only the explicitly selected org Flow tests.
- A Mermaid topology is a graph projection, not proof that Flow Builder accepts the metadata.
- Use `code_analyzer` for broad Flow static analysis. Use `sf_apex` when Flow invokes Apex and Apex behavior needs proof. Use `sf_soql` for schema evidence not established by validation.

## Mermaid topology

SF Flow keeps the Result Card compact and appends bounded topology as a top-level Mermaid block on the next final assistant message. Pi’s native Markdown renderer displays the diagram outside the tool tile and respects the user’s Mermaid rendering setting. Nodes lead with architectural verbs such as START, GET, DECISION, FOR EACH, SET, CREATE, UPDATE, SCREEN, ACTION, and SUBFLOW; relevant object, filter, collection, or assignment detail is folded into the node instead of rendering raw resources as boxes. Normal edges are solid, edges entering durable Create/Update/Delete operations are thick, decision outcomes and loop phases are labeled, and fault edges are dotted. Pi’s terminal renderer supplies theme colors by semantic class: muted borders, normal node text, accent edges and arrowheads, and muted edge labels. Browser-only Mermaid `classDef`, `style`, fill colors, per-node text colors, and Markdown bold in labels are intentionally not emitted because Pi’s terminal renderer ignores them. Uppercase verbs and node shapes carry the visual hierarchy instead. The displayed graph includes up to 100 executable elements, staying below Pi’s native 128-node Mermaid parser ceiling. The persisted `.mmd` Flow Artifact contains the complete executable topology when the display is bounded; use it when the graph is too wide, unsupported, or native Mermaid rendering is disabled.
