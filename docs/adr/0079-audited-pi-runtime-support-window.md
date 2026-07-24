# ADR 0079: Audited Pi Runtime Support Window

Status: accepted; Pi `>=0.81.1 <0.83.0` window implemented

While Pi remains on `0.x`, SF Pi claims support only for explicitly audited runtime releases. The current inclusive floor is Pi 0.81.1 and the exclusive ceiling is 0.83.0. Package metadata, the runtime gate, Doctor/Welcome guidance, and required CI enforce `>=0.81.1 <0.83.0`; widening to Pi 0.83 requires another release audit and behavior proof.

The Pi 0.82.0 audit found the public complete-Provider, authentication, extension lifecycle, and custom-TUI APIs used by SF Pi to be source-compatible with 0.81.1. The 0.82 changes on these surfaces are additive. Exact-runtime type checking and the full SF Pi test suite cover provider registration, Gateway API dispatch, Docs/Slack auth-only providers, credential resolution, lifecycle teardown, and shared masked-input behavior. Required CI tests both the retained 0.81.1 floor and Pi 0.82.0.

Pi 0.81.1 and 0.82.0 still render values submitted through the stock secret prompt. Gateway, SF Docs, and SF Slack therefore continue to bypass that prompt and use the behavior-proven shared SF Pi fixed-mask component from ADR 0087. Provider login still returns canonical credentials to Pi, so Pi alone owns persistence and logout. Existing API-key and OAuth-compatible credentials plus environment-variable authentication remain usable through public runtime APIs.

The runtime gate also rejects prerelease builds throughout the window, matching npm peer-range behavior. Pi 0.82.0 is the recommended exact runtime; Pi 0.81.1 remains supported to avoid breaking existing installations during the compatibility transition.

[ADR 0084](./0084-agent-settled-update-coordinator.md) governs automatic updates: opt-in package updates may continue only through the agent-settled, human-visible coordinator, and the coordinator does not mutate the Pi runtime itself.
