---
id: "0093"
status: accepted
date: 2026-07-29
supersedes: ["0015"]
---

# Salesforce Instruction Surface Uses a Constitution and Progressive Docs

## Context

SF Pi's model-visible startup context repeats bundled-extension workflows across the Salesforce Operator Kernel, runtime extension map, tool guidance, extension-owned skills, and reference documentation. A measured fresh session showed that duplicated prose is material, but users value immediate one-call access to every enabled SF Pi tool and native Pi visibility for external Salesforce skills.

## Decision

SF Pi treats its model-visible startup context as the **Salesforce Instruction Surface** and measures the independently owned **External Salesforce Skill Surface** alongside it. SF Pi retains eager activation and complete callable schemas for enabled tools, retains Pi-native visibility for every external Salesforce skill description, and treats that external content as a measured fixed cost.

The always-visible SF Pi baseline becomes a 700–1,000 token **Salesforce Engineering Constitution** containing only universal Salesforce-first interpretation, **Salesforce Change Authority**, **Behavior-Proof-First Development**, minimal-change and evidence expectations, Guardrail authority, context discipline, and raw CLI fallback principles. The bundled constitution is always present. User customization is append-only through `SF_CONSTITUTION_APPEND.md`; legacy replacement-style `SF_KERNEL.md` support is removed without a runtime compatibility path.

Detailed bundled-extension operating guidance uses **Progressive SF Pi Documentation** in `extensions/<id>/AGENT_GUIDE.md`. The constitution contains direct topic-to-guide paths, and the model decides when deeper guidance is useful. Existing extension-owned Agent Script and SF Browser skills migrate to guides and stop registering as Pi skills; external Salesforce skills remain separate. `SF_REFERENCE_MAP.md` is retired after unique guidance moves to the owning guide or existing contributor documentation.

The runtime extension context becomes a tiny **SF Pi Routing Summary**: active SF Pi tools take priority over external skills and raw CLI, and disabled **Capability Owners** include their enablement path. It no longer repeats the enabled extension catalog. The Salesforce environment block retains only operational facts. Guardrail emits a **Guardrail Context Summary** with its mediator contract, active hard blocks, and non-default overrides instead of the complete rule catalog.

Tool `promptGuidelines` have no rigid per-tool size limit, but duplicated parameter catalogs, recipes, and workflows are manually removed in favor of schemas, guides, and enforcement. An advisory **Instruction Surface Report** measures contributors and baseline changes without failing CI. Required deterministic tests prove composition and lifecycle contracts; an opt-in **Instruction Behavior Eval** reports live-model routing, grounding, proof-first posture, CLI use, release ordering, and evidence quality without initially blocking CI.

## Consequences

- Enabled SF Pi tools remain immediately callable in one model step, preserving current ergonomics at the intentional cost of full eager tool schemas.
- External Salesforce skills remain automatically selectable through Pi and outside SF Pi documentation ownership.
- Global operating prose becomes smaller and has clearer ownership, while detailed guidance enters context only when the model chooses to read it.
- User replacement kernels and the two bundled extension-owned skill commands are breaking removals documented in release notes rather than maintained through compatibility branches.
- Instruction size is observable but advisory; behavioral regression evidence, not a token score alone, determines whether the redesign succeeds.
