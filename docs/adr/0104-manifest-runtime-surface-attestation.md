---
id: "0104"
status: accepted
date: 2026-08-10
---

# ADR 0104: Manifests Are Attested Against Real Runtime Registration

## Context

Extension manifests drive the generated catalog and documentation, but runtime
commands, providers, tools, and lifecycle hooks are registered by extension
code. Lexical source scans could confirm that names appeared somewhere without
proving that a real factory reached the registration, and delegated hook
registration required a hand-maintained allowlist.

Conditional tools also have valid availability states. Slack tools are absent
without authentication, and the Herdr planner is absent until the current Herdr
environment and control tools are ready. A factory-only snapshot therefore
cannot describe every supported runtime surface.

## Decision

Treat each manifest's runtime arrays as its available capability contract:

- `commands`, `providers`, and `events` must exactly match registrations made by
  the real extension factory;
- no controlled scenario may register an undeclared tool;
- the union of tools across controlled supported scenarios must exactly match
  `manifest.tools`;
- duplicate command, provider, or tool registration inside one non-reload
  scenario is invalid; multiple handlers for one declared event are allowed;
- conditional availability is exercised by extension-local scenario adapters
  that invoke the real factory and lifecycle handlers without calling tool
  registration helpers directly.

One sequential runtime-surface suite discovers every manifest, loads every real
factory, runs in temporary project/global state, blocks unexpected network and
`pi.exec` activity, and uses bounded lifecycle waits. Slack and Herdr own the
only current conditional scenario adapters. The normal `npm test` lane owns this
attestation; `npm run test:runtime-surface` is the focused developer command.

Documentation health continues to check whether manifest commands and tools are
mentioned in extension READMEs. It no longer uses lexical source scans as proof
of runtime registration.

## Consequences

- Code remains the implemented-behavior authority while manifests remain the
  generated inventory contract.
- A missing or extra runtime registration fails through the same public factory
  seam Pi loads.
- New conditional registration requires an extension-local positive/negative
  scenario adapter instead of a central allowlist.
- The attestation proves registration and availability, not command or tool
  execution correctness; existing behavior tests remain necessary.
- Factory/startup registration must remain cache-first and must not require live
  credentials, orgs, network calls, or subprocesses merely to expose declared
  surfaces.
