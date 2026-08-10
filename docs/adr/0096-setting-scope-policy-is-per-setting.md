---
id: "0096"
status: proposed
date: 2026-07-30
---

# ADR 0096: Setting scope policy is declared per setting

Each user-facing SF Pi setting declares a **Setting Scope Policy**: Global-Only or Project-Inheritable. Global-Only settings resolve a user-wide value and default without granting project authority; Project-Inheritable settings resolve each field from project to global to default. The presence of a project settings section never grants project override authority to sibling settings implicitly. Existing whole-section settings adapters remain the shipped behavior until a behavior-proven migration is approved, so current contributor and architecture guidance must not present this proposal as implemented.

This keeps policy controls such as Agent Script quality rules global while allowing genuinely project-specific developer preferences. It rejects both a universal project-override rule and extension-wide implicit scope because either can accidentally broaden authority or materialize inherited values.
