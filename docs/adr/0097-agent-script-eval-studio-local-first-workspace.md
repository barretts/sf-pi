---
id: "0097"
status: accepted
date: 2026-08-03
---

# Agent Script Eval Studio Is a Local-First EvalSpec Workspace

Agent Script uses a Pi-native **Agent Script Eval Studio**, opened by `/sf-agentscript evals`, as the local-first human workspace for source-controlled **Agent Script Eval Suites** and persisted Run evidence. One Suite is one executable EvalSpec JSON file for one Agent API identity; one Scenario contains one shared session, one or more ordered user turns, and at least one Turn- or Scenario-scoped evaluator. EvalSpec JSON remains the only source-controlled authoring format: the Studio projects it into conversations and evidence views but adds no registry, sidecar, or second scenario language. Salesforce is contacted only for an explicit version-resolution or execution action.

The Studio can run one Suite or one diagnostic Scenario at a time per project through an explicit **Agent Script Eval Run Target**. New runs default to the Active BotVersion, historical reruns prefill their exact target for visible review, and release-contract execution remains a distinct action for a pending latest non-Active version. A Run begins only after local projectability/structure checks and target resolution succeed; only then does it persist immutable source and executed-spec snapshots. Closing the Studio does not cancel a Run, cancellation is explicit, and a definitively orphaned Run becomes Interrupted rather than remaining Running or becoming a behavioral failure.

Run execution state and evidence verdict are separate. Execution state records Running, Completed, Cancelled, Interrupted, or Infrastructure Failed; evidence verdicts are total decisions rather than aggregate green counts. Passed requires every expected result to return effectively true with complete transport and step evidence; explicit behavioral failures are Failed, missing or errored evidence is Incomplete, unresolved evidence is Unverified, and historical Runs preserve both their recorded verdict and the current interpretation. Scenario-scope Runs, Ad Hoc Runs, Advanced/Unverified evaluators, legacy evidence, and stale-source badges remain visible but cannot masquerade as complete release evidence.

Authoring remains conversational. New Suite, New Scenario, Edit, and Diagnose actions collect a compact **Agent Script Eval Authoring Brief**, close the Studio, and prefill the Pi editor for the Agent; the MVP does not directly edit JSON, auto-reopen, browse live org data, automate Preview replay, calculate inferred Agent-level coverage, or delete Run artifacts. The Generated Baseline Suite is visible and read-only, while the designated release Suite remains source-controlled. The Studio reuses existing eval execution and release contracts instead of introducing another backend or lifecycle.
