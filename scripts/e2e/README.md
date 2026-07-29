<!-- SPDX-License-Identifier: Apache-2.0 -->

# scripts/e2e

Live, read-only end-to-end smokes that hit a Salesforce org via the
patched source modules — bypassing the pi extension runtime so they
reflect what's on disk, not what the running pi process bundled at
startup.

These are not part of `npm test` / CI. Most require a real `sf` auth
context and run against a connected org; the Instruction Behavior Eval is a
model-only routing probe and blocks tools before execution.

## d360-stdm-e2e.ts

Full surface check for `sf-data360`: target-org resolution, the body
serialization contract, path normalization, safety classification,
the readiness probe, `list_dmos`, `describe_dmo`, `/ssot/query-sql`
with both body shapes, a joined aggregation, and 404 error-path
classification.

```bash
node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts <orgAlias>
# or
D360_E2E_ORG=<orgAlias> node --experimental-strip-types scripts/e2e/d360-stdm-e2e.ts
```

The script is read-only — every call is a GET, a SQL `SELECT`, or an
in-process classification. Useful when validating a Data Cloud /
Data 360 org on a different API release than the active sf-pi default.

## d360-agent-platform-tracing-e2e.ts

Read-only Agent Platform Tracing smoke. It avoids the `sf` CLI subprocess
path and uses the same `@salesforce/core` Connection transport as the
`d360_*` tools. The script verifies that `ObservabilitySpans__dll`
metadata is visible, runs small bounded `/ssot/query-sql` SELECTs against
`ssot__TelemetryTraceSpan__dlm`, and reconstructs one trace tree locally
when sample spans exist.

```bash
node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts <orgAlias>
# or
D360_E2E_ORG=<orgAlias> node --experimental-strip-types scripts/e2e/d360-agent-platform-tracing-e2e.ts
```

By default, an org without Agent Platform Tracing is reported as a clean
skip. Add `--require-data` or `D360_E2E_REQUIRE_APT=1` when missing
metadata or empty trace data should fail the smoke.

## instruction-behavior/run.ts

Opt-in live-model regression for SF Brain's instruction architecture. The
runner loads public-safe scenarios, records selected tools and actions, and
reports expected or forbidden routing facts without producing a quality score.
A probe extension allows bounded local `read`/`grep`/`find`/`ls` context and
blocks every other tool in `tool_call` before execution, so the harness performs
no Salesforce org call, shell command, file edit, browser commit, or
collaboration write.

```bash
npm run e2e:instruction-behavior -- --model <model>
npm run e2e:instruction-behavior -- --scenario agentscript-release --limit 1
```

Reports are written under
`.pi/state/sf-brain/instruction-behavior/<timestamp>/` unless `--output` is
provided. Model and provider variance make the report advisory and non-blocking.
