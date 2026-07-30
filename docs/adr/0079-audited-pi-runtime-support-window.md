# ADR 0079: Pi Runtime Forward-Compatibility Policy

Status: accepted; hard floor superseded by ADR 0088, soft audit ceiling remains implemented

SF Pi distinguishes **loadable** Pi releases from **audited** Pi releases. Lack of an audit is not evidence of incompatibility, so a newly published stable Pi 0.x release must not preemptively disable every SF Pi extension.

ADR 0088 raises the hard loadable range to stable Pi `>=0.82.0 <1.0.0`. Runtimes below the floor, prereleases, and Pi 1.x or later remain blocked with bounded repair guidance. The current required-CI audit range is `>=0.82.0 <0.84.0`: exact Pi 0.82.0 remains the floor check, while exact Pi 0.83.0 is used for normal development, repair, and the latest audited edge.

When a stable runtime is inside the hard range but above the audit ceiling, SF Pi:

1. loads every extension normally;
2. emits one process-wide forward-compatibility warning instead of one warning per extension;
3. reports a Doctor warning, not an error;
4. does not recommend a downgrade without a concrete failure; and
5. allows Pi's native update surface to offer the release.

Package metadata follows the hard range (`>=0.82.0 <1.0.0`) so npm does not reject a newly published stable Pi 0.x release. Development dependencies remain pinned to the latest exact audited runtime. Required nightly compatibility starts at the 0.82.0 floor; a non-blocking `latest` canary reports future drift so maintainers can advance the audit ceiling after evidence arrives.

The Pi 0.82.0 floor audit and Pi 0.83.0 edge audit found the public complete-Provider, authentication, extension lifecycle, and custom-TUI APIs used by SF Pi to be source-compatible across the required window. The 0.83 audit also found and repaired one semantic Gateway defect: a synthetic Bedrock Responses terminal event could retain the new streaming-only `pending` stop reason in its finalized message. Exact-runtime type checking and the full SF Pi test suite cover provider registration, Gateway API dispatch, Docs/Slack auth-only providers, credential resolution, lifecycle teardown, and shared masked-input behavior at both edges.

Pi 0.81.1 and 0.82.0 render values submitted through the stock secret prompt, and the Pi 0.83 audit provided no replacement **Secure Credential Prompt Proof**. Gateway, SF Docs, and SF Slack therefore continue to use ADR 0087's shared fixed-mask component. Pi alone owns credential persistence and logout.

[ADR 0084](./0084-agent-settled-update-coordinator.md) keeps automatic Pi runtime mutation out of SF Pi's update coordinator. Pi runtime updates remain user-managed; SF Pi's responsibility is to avoid breaking compatible future stable releases after the update.
