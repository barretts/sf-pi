# SF Herdr — Code Walkthrough

## What It Does

SF Herdr adds a small, non-mutating Salesforce workflow planner for the current
upstream Herdr tools:

- `herdr_layout` creates and inspects topology.
- `herdr_pane` runs and observes ordinary commands.
- `herdr_agent` starts and interacts with coding agents.

The extension always registers `/sf-herdr` with status, doctor, settings, and
help surfaces. It registers `sf_herdr_plan` during `session_start` only when
`HERDR_ENV=1`, `HERDR_PANE_ID` is set, and all three current tools are active.

The standalone [official Herdr skill](https://herdr.dev/docs/agent-skill/) is not
packed by SF Pi or `npm:@ogulcancelik/pi-herdr`. Herdr owns that content and
`herdr --skill` prints the release-matched copy; skill installation remains a
separate follow-up from this structured-tool repair.

## Runtime Flow

```text
extension load
  ├─ register /sf-herdr and Manager/doctor surfaces
  ├─ register session_start gating
  └─ register exact pane-run result normalization

session_start
  ├─ inspect the active tool names and Herdr environment
  └─ register sf_herdr_plan only when the complete current runtime is ready

sf_herdr_plan
  ├─ require intent and primaryWorkflow
  ├─ read global sfPi.herdr settings
  ├─ return structured current tool/action steps
  ├─ carry split.details.pane.pane_id forward as an opaque result reference
  └─ use wait_output's bounded snapshot instead of a separate pane read

tool_result
  └─ normalize only the current successful-empty-body pane run without retrying
```

The planner does not mutate panes and does not generate a shell command. The
owning workflow supplies the command, output marker, agent kind, or prompt.
Ordinary command intents use `herdr_pane`; review uses `herdr_agent`.

## Behavior Matrix

| Event or action      | Condition                                           | Result                                                              |
| -------------------- | --------------------------------------------------- | ------------------------------------------------------------------- |
| Extension load       | Supported Pi runtime                                | Register `/sf-herdr`, Manager actions, doctor, and settings only.   |
| `session_start`      | Herdr environment and all three tools are active    | Register `sf_herdr_plan` for the current session.                   |
| `session_start`      | Environment or any current Herdr tool is missing    | Keep the planner unregistered; status and setup surfaces remain.    |
| `/sf-herdr`          | Interactive, no arguments                           | Open the SF Herdr Manager detail page.                              |
| `/sf-herdr status`   | Any runtime                                         | Report current environment, complete tool readiness, and settings.  |
| `/sf-herdr settings` | Interactive                                         | Open the global split-direction and intent-lifecycle settings page. |
| `sf_herdr_plan`      | Explicit `intent` and `primaryWorkflow`             | Return current structured tool/action steps without mutating panes. |
| `tool_result`        | Exact successful-empty-body `herdr_pane.run` result | Report the submitted command as success without executing it again. |
| Ephemeral plan       | Workflow success is observed in `wait_output`       | Recommend `herdr_pane.close` for the freshly created pane.          |
| Any plan             | Failure, timeout, blocked, or ambiguous completion  | Leave the pane open for inspection and explicit cleanup.            |

## Lifecycle Settings

Global native Pi settings live only at `sfPi.herdr` in the global
`settings.json`:

```json
{
  "sfPi": {
    "herdr": {
      "splitDirection": "auto",
      "lifecycleByIntent": {
        "run-tests": "ephemeral",
        "tail-logs": "ephemeral",
        "deploy-validate": "ephemeral",
        "preview": "ephemeral",
        "eval": "ephemeral",
        "server": "sticky",
        "review": "manual",
        "verify": "ephemeral"
      }
    }
  }
}
```

`splitDirection` accepts `auto`, `right`, or `down`. `auto` omits the direction
so the current upstream layout tool chooses from pane geometry.

- `ephemeral`: close the freshly split pane with `herdr_pane` only after
  observed success.
- `sticky`: keep the pane for continued workflow use.
- `manual`: keep the pane until explicit cleanup.

Failure, timeout, blocked, or ambiguous results always leave the pane open for
inspection. The retired SF Pi preferences file is not read, migrated, or
deleted.

## Commands

| Command              | Description                                                   |
| -------------------- | ------------------------------------------------------------- |
| `/sf-herdr`          | Open SF Herdr in the SF Pi Manager.                           |
| `/sf-herdr status`   | Show current environment, split-tool readiness, and settings. |
| `/sf-herdr doctor`   | Check the environment and all three current upstream tools.   |
| `/sf-herdr settings` | Open the global settings panel.                               |
| `/sf-herdr help`     | Print usage and boundaries.                                   |

## Agent Tool

`sf_herdr_plan` requires both `intent` and `primaryWorkflow`. Its structured
steps use valid current tool/action pairs and result references instead of pane
names. Command plans use the bounded snapshot returned by `wait_output` and do
not add a redundant `herdr_pane.read` step. The compact text mirrors the
structured plan for quick inspection.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-herdr/
  lib/
    config-panel.ts         ← implementation module
    settings.ts             ← implementation module
    sf_herdr_plan-tool.ts   ← implementation module
    status.ts               ← implementation module
    tool-result-normalizer.ts← implementation module
  tests/
    config-panel.test.ts    ← unit / smoke test
    plan-render.test.ts     ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
    tool-result-normalizer.test.ts← unit / smoke test
  AGENT_GUIDE.md            ← supporting file
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

```bash
npm test -- extensions/sf-herdr/tests extensions/sf-welcome/tests/herdr-runtime-status.test.ts extensions/sf-guardrail/tests/safety-subject.test.ts
npm run check -- --pretty false
```

Run the opt-in live smoke only from a disposable Herdr session; it is not part
of default CI:

```bash
SF_HERDR_LIVE_SMOKE=1 npm run e2e:sf-herdr
```

## Troubleshooting

**`sf_herdr_plan` is unavailable:**
Run Pi inside a Herdr pane and verify `/sf-herdr doctor` reports
`herdr_layout`, `herdr_pane`, and `herdr_agent` active. Tool registration is a
session-start decision; restart after correcting the runtime.

**An ephemeral pane stayed open:**
This is intentional unless success was observed. Inspect its recent output and
close it explicitly after deciding it is safe.

**The Herdr package is missing:**
Install `npm:@ogulcancelik/pi-herdr`. SF Herdr does not vendor or manage the
separate official Herdr skill.
