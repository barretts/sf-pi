# SF Herdr

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
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENT_GUIDE.md              ← agent operating guide
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

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
