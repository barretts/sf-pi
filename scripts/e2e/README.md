<!-- SPDX-License-Identifier: Apache-2.0 -->

# E2E and live-proof harnesses

These opt-in harnesses exercise source modules outside the normal Pi extension host. They are not part of default CI. Each entry states its authority and mutation posture; pass every live target explicitly.

## Data 360

### `data360-v2-action-sweep.ts` — current public-interface proof

Exercises `registry/v2/actions.json` through each owning `data360_*` family and the real v2 dispatcher. It verifies action description, metadata, dry-run resolution, and missing-parameter recovery. Live reads are opt-in and bounded; it does not execute confirmed actions.

```bash
node --experimental-strip-types scripts/e2e/data360-v2-action-sweep.ts \
  --target-org <alias> [--tool data360_query] [--action sql.run]

node --experimental-strip-types scripts/e2e/data360-v2-action-sweep.ts \
  --target-org <alias> --live-read --max-live-read 5
```

### `d360-capability-sweep.ts` — legacy compatibility probe

Exercises the retained facade registry and legacy operation names. It is compatibility evidence, not proof of the public v2 interface. The default path plans/dry-runs; explicit mutation options can create and clean sweep-owned resources and must target an isolated non-production org.

```bash
node --experimental-strip-types scripts/e2e/d360-capability-sweep.ts --target-org <alias>
```

### `d360-stdm-e2e.ts` — read-only legacy-module smoke

Exercises shared target/version resolution, request serialization, safety classification, readiness, metadata, and bounded Data 360 SQL through retained low-level modules. It performs only GET, SELECT, and in-process classification work.

```bash
node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts <alias>
```

### `d360-agent-platform-tracing-e2e.ts` — read-only tracing smoke

Uses the shared Salesforce Connection Module to inspect tracing metadata, run bounded SELECT queries, and reconstruct a trace tree locally. Missing optional tracing data is a clean skip unless `--require-data` is supplied.

```bash
node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts <alias> [--require-data]
```

## Salesforce lifecycle extensions

### `sf-apex-harness-e2e.ts`

Runs the native Apex operation layer against an explicitly deployed harness project. It includes trace/test/log probes and bounded Anonymous Apex rollback behavior, so use a dedicated non-production org and harness fixture.

```bash
npm run e2e:sf-apex-harness -- --org <alias> --harness-cwd <project>
```

### `sf-soql-e2e.ts`

Read-only by default. `--harness-data` creates and cleans temporary Account/Contact fixtures for deterministic relationship coverage and must target a non-production org.

```bash
npm run e2e:sf-soql -- --org <alias> [--harness-data]
```

### `sf-lwc-e2e.ts`

Local-only generated-project harness for project scan, inspection, diagnostics, test discovery/planning, and bounded Jest execution. No Salesforce org is required.

```bash
npm run e2e:sf-lwc
```

## Browser and Herdr

### `sf-browser-pack-harden.ts`

Drives a live headless browser against an explicit non-production org, captures Browser Evidence, and verifies curated navigation surfaces. `--mutate` opens one representative new-record form and cancels without saving; it does not commit the draft.

```bash
npm run e2e:sf-browser-harden -- --org <alias> [--mutate]
```

### `sf-herdr-live-smoke.ts`

Runs only inside a disposable Herdr session. It splits a fresh pane, runs a harmless marker, verifies output, and closes only after observed success. Failure leaves the pane open.

```bash
SF_HERDR_LIVE_SMOKE=1 npm run e2e:sf-herdr
```

## Instruction behavior

### `instruction-behavior/run.ts`

Opt-in live-model routing regression. A probe allows bounded local context reads and blocks every non-local tool before execution, so the harness performs no Salesforce org call, shell command, file edit, browser commit, or collaboration write.

```bash
npm run e2e:instruction-behavior -- --model <model>
npm run e2e:instruction-behavior -- --scenario agentscript-release --limit 1
```

Reports default to `.pi/state/sf-brain/instruction-behavior/<timestamp>/`. Model/provider variance keeps this evidence advisory and non-blocking.
