# ADR 0102: SF Herdr Is Forward-Only on the Current Split Tools

Status: accepted

## Decision

SF Herdr supports only the current upstream tool set: `herdr_layout`,
`herdr_pane`, and `herdr_agent`. It has no adapter, version switch, migration,
or dual schema.

The `/sf-herdr` command, Manager actions, doctor, help, and global settings panel
register whenever the extension loads. `sf_herdr_plan` registers only during
`session_start` when `HERDR_ENV=1`, `HERDR_PANE_ID` exists, and all three current
tools are active. SF Welcome and SF Herdr use one shared readiness calculation.

The planner is intentionally small and non-mutating:

- `intent` and `primaryWorkflow` are required;
- steps contain current tool/action pairs and compact explanatory text;
- the first step is `herdr_layout.pane_split`;
- later steps reference the opaque pane ID at `details.pane.pane_id` from that
  result rather than constructing an ID;
- ordinary workflows use `herdr_pane`, while review work uses `herdr_agent`;
- the planner never supplies a shell command;
- only a freshly created ephemeral pane is closed, and only after observed
  success; failure or timeout stays open for inspection.

Settings are global-only native Pi settings at `sfPi.herdr`. The complete schema
is `splitDirection` (`auto`, `right`, or `down`) plus `lifecycleByIntent`. The
retired SF Pi-managed preferences file is inert: it is not read, migrated, or
deleted.

SF Guardrail normalizes `herdr_pane` with `action=run` and a string `command` as
a shell-command subject. The Code Analyzer Herdr handoff retains only the small
shared intent/workflow contract.

The separate official Herdr skill is out of scope.

## Consequences

This hard cut removes profile merging, workflow inference, signal
reconstruction, lane aliases/labels, compatibility prose, and obsolete state.
Users must run a current split-tool runtime to receive planner registration.
The reduced plan is easier to validate against the authoritative upstream tool
schemas, and no stale pane identity can cross the split-result boundary.

This ADR supersedes the legacy runtime Interface, workflow-profile, signal-inference, and pane-alias portions of ADRs 0016 and 0068. Their non-mutating orchestration and fresh-lane safety decisions remain in force. ADR 0015 remains superseded by ADR 0093.
