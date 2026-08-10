---
id: "0092"
status: accepted
date: 2026-07-28
---

# Agent Script Quality Rule Settings Are Global-Only and Sparse

Agent Script quality controls live only in global Pi settings under `sfPi.agentScript.quality`; project settings cannot change rule behavior. The SF Agent Script Manager settings page renders one On/Off row per canonical rule, all stable v1 rules default On, future experimental rules default Off, and persistence stores only deviations from catalog defaults. Disabling a rule removes it from reporting, repair, metrics, and publication gating, while every quality result discloses enabled/disabled coverage. There is no master quality-disable switch, settings are read dynamically without reload, and `quality.autoRun` affects only the deferred post-agent pass—not explicit quality/review or publication preflight.
