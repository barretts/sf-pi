---
id: "0088"
status: superseded
date: 2026-07-27
supersededBy: ["0109"]
---

# ADR 0088: Pi 0.82.0 Runtime Floor

SF Pi raises its **Pi Runtime Floor** from `0.81.1` to `0.82.0` so production source can use Pi 0.82 extension Interfaces without compatibility shims or an untested “loadable but unsupported” tier. Stable runtimes below `0.82.0`, prereleases, and Pi 1.x or later are blocked with exact `pi update --self` repair guidance. SF Pi does not retain a pre-floor bootstrap Module or automatically mutate the runtime that is currently hosting it. Required compatibility CI starts at exact Pi `0.82.0`; ADR 0079's forward-compatibility behavior for newer stable Pi 0.x releases remains in force.

The floor contract changes atomically across package metadata, runtime gates, Doctor/update guidance, documentation, lockfile, and version-policy tests. The delivery may include dependency maintenance required to prove the latest audited edge, but unrelated product behavior remains separate. Raising the floor makes Pi 0.82 Interfaces available, but does not by itself authorize constrained sampling or any other feature whose SF Pi schema or workflow contract has not passed the **Behavior Proof Ladder**. This supersedes ADR 0079 only where it names `0.81.1` as the hard floor and required compatibility edge.
