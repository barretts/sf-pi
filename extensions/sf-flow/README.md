# SF Flow

## What It Does

SF Flow is a lean lifecycle extension for Salesforce Flow metadata. It helps agents choose a general-purpose Flow family, inspect and diagnose local source, validate one exact Flow without saving it, run targeted Flow tests, and present graph structure as Mermaid-backed terminal diagrams.

Normal Pi `read`, `write`, and `edit` tools own source changes. SF Flow never deploys or activates a Flow.

## Core Flow Families

V1 provides authoring blueprints for:

1. Screen Flow
2. Autolaunched Flow
3. Record-Triggered Flow, including before-save, after-save, and before-delete timing
4. Schedule-Triggered Flow
5. Platform Event-Triggered Flow

Other Metadata API process and trigger values are reported as specialized. SF Flow can inspect their common graph shape but does not claim type-specific authoring proficiency for them.

## Lifecycle

Use the `sf_flow` family tool:

```text
status, org.preflight
project.scan, flow.inspect, author.plan, diagnose.file, quality.rules
fix.apply
validate.check
test.discover, test.plan, test.run, test.result, test.rerun
```

The intended loop is:

1. Run `author.plan` or `flow.inspect` to establish the Flow family and structure.
2. Edit `.flow-meta.xml` with normal Pi file tools.
3. Run `diagnose.file` until deterministic local findings are resolved. It returns the exact source version and any safe source-bound quick fixes.
4. Apply only a current `fix.apply` result when API version, Auto-Layout, or unused-variable cleanup is appropriate. Business logic remains with normal Pi edits.
5. Run `validate.check` against the intended org. This is a one-file Metadata API check-only operation and saves no metadata.
6. Run the smallest relevant targeted Flow test when an eligible Flow test exists in the org.

A successful local diagnosis does not establish deployment readiness. Salesforce check-only validation is the platform evidence boundary.

## Org-Grounded Authoring

`author.plan` remains local when `target_org` is omitted. With an explicit target, it performs bounded read-only grounding for:

- the requested object or platform event and intent-relevant fields;
- matching standard, Apex, Flow, external-service, and quick actions with input/output contracts;
- matching active or latest autolaunched subflows with input/output variables.

Each plan discloses API calls and grounding gaps. Results are bounded to prevent full-schema or full-action dumps, and no grounding occurs at startup or after ordinary file edits.

## Local Diagnostics

The small V1 analyzer reports source-located findings for:

- malformed XML or a non-Flow root;
- missing core metadata and inconsistent core family/trigger configuration;
- duplicate element or resource names;
- missing or dangling connector targets and unreachable elements;
- unresolved local references and invalid record context;
- database operations inside loops;
- missing fault paths, with Get Records treated as lower severity than mutation/action elements;
- elements that Salesforce documents as unavailable in before-save record-triggered flows.

Every analysis discloses skipped coverage. Broad formula, org-action, and project-wide analysis remains with Salesforce Code Analyzer.

The data-first rule catalog includes independent evaluators for all 30 published Lightning Flow Scanner rule concepts plus SF Pi-native correctness checks. Generation, review, and audit profiles keep policy-specific or noisy findings out of the automatic edit path. Use `quality.rules` to inspect the registry and [`QUALITY_RULES.md`](./QUALITY_RULES.md) for the full contract.

## Bounded Repair Loop

After a successful Flow file write or edit, SF Flow runs the low-noise generation profile. High and Moderate findings can steer at most three agent repair rounds. The loop stops when source is clean, the finding signature repeats, or the round limit is reached. It never performs hidden business-logic mutations.

`diagnose.file` can offer three deterministic fixes:

- set `apiVersion` to the SFDX project source version;
- add or correct `AUTO_LAYOUT_CANVAS` metadata;
- remove an exact unused local variable.

`fix.apply` requires the `fix_id` and SHA-256 `source_version` from the current diagnosis. It refuses stale source and re-diagnoses after writing.

## Flow Result Cards

Human-facing results use a normalized Flow Run Digest. Cards show:

- action outcome and target;
- Flow family, trigger, and object or event;
- local and API evidence rails;
- source-located findings or test failures;
- Mermaid-backed Flow topology;
- artifact paths and a next step.

Mermaid source is rendered as terminal Unicode when it fits. Narrow or unsupported diagrams fall back to a compact message, while complete `.mmd` source remains available as a Flow Artifact.

## Commands

```text
/sf-flow          Open SF Flow in the SF Pi Manager
/sf-flow status   Print status
/sf-flow help     Print lifecycle actions
```

## Safety and Data Boundaries

- No startup org probes, project scans, subprocesses, or network calls.
- Automatic post-edit feedback is local-only, bounded to three actionable rounds, and stays silent for clean files.
- `fix.apply` is limited to source-bound API-version, Auto-Layout, and unused-variable fixes and participates in Pi's file mutation queue.
- `validate.check` stages one Flow in a temporary directory with `checkOnly=true`; it never deploys or activates.
- Test runs require explicit Flow API names or Flow test names and never default to all tests.
- Complete evidence is persisted under `<globalAgentDir>/sf-pi/sf-flow/`; model-facing output stays compact.
- No Flow execution, deployment, activation, full-screen editor, LSP, VS Code package, or AI-backed generation service is included in V1.

## Live E2E Evidence

The E2E harness has passed against a connected non-production org at API 67.0: org preflight, clean local diagnosis, one-file Metadata API check-only validation, FlowTest metadata discovery, queued targeted `test.run`, and polled `test.result` completion.

A dedicated public-safe draft autolaunched Flow and FlowTest fixture is available under `scripts/e2e/fixtures/sf-flow/`. Provisioning always performs check-only first and requires an explicit `--deploy` flag. The fixture creates no data records and requires no activation.

The actual wide and 48-column Result Cards were rendered through the production component. Mermaid topology remained readable at both widths; long metadata and artifact paths use compact headers and hanging indentation.

To remove the dedicated fixture later, delete `FlowTest:SfPi_Flow_Test_Fixture_Happy_Path` followed by `Flow:SfPi_Flow_Test_Fixture` from the chosen non-production org.

## Acknowledgements

SF Flow's quality-rule design is informed by the public rule documentation and black-box behavior of [Lightning Flow Scanner](https://lightningflowscanner.org/), an [MIT-licensed open-source project](https://github.com/Flow-Scanner/lightning-flow-scanner). SF Flow is an independent white-room implementation and does not include Lightning Flow Scanner production source code.

The exact upstream core package is pinned as a dev-only parity oracle. Fresh SF Pi fixtures compare rule occurrence and applicability without copying implementation, messages, regexes, or upstream example flows. See [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Official References

- [Metadata API Flow reference](https://developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/meta_visual_workflow.htm)
- [Flow Builder best practices](https://help.salesforce.com/s/articleView?id=platform.flow_prep_bestpractices.htm&type=5)
- [Before-save record-triggered flows](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_record.htm&type=5)
- [Scheduled paths](https://help.salesforce.com/s/articleView?id=platform.flow_concepts_trigger_scheduled_path.htm&type=5)
- [Run Flow tests](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_flow_run_test.html)
- [Get Flow test results](https://developer.salesforce.com/docs/platform/salesforce-cli-reference/guide/cli_reference_flow_get_test.html)

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-flow/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->
