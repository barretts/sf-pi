# Agent Script Quality Analysis Is Native, AST-Grounded, and Separate from Compilation

## Status

Accepted

## Context

Agent Script can compile successfully while still containing deterministic flow defects, unsupported deterministic-action patterns, dead workflow elements, or maintainability risks. Treating these findings as compiler errors would contradict **Agent Script Compile Validity**, while routing them through Salesforce Code Analyzer would add an ESLint adapter and a second configuration surface before native Agent Script quality behavior is proven.

SF Agent Script already uses the official `@sf-agentscript/*` parser, schema, compiler, language, and LSP packages. The official language package provides extensible lint passes, typed shared facts, and source ranges. SF Pi also already owns a stable structural projection and a source-versioned local analysis cache.

## Decision

SF Agent Script owns native **Agent Script Quality Passes** over one `.agent` file at a time. Quality analysis uses the official Agent Script parser and Agentforce schema as its only language source of truth and extends the official lint-pass framework with SF Pi-owned universal rules.

SF Pi adds an **Agent Script Flow Projection** derived from the official AST. It distinguishes deterministic one-way transitions, planner-selected transitions, returning subagent delegations, and connected-agent invocations with conditions and source ranges. Graph algorithms use the existing `@dagrejs/graphlib` dependency; SF Pi does not copy an upstream graph framework or introduce another Agent Script parser.

The existing `agentscript_authoring` family tool gains `inspect/quality`; `inspect/review` composes the same quality result with compile, deployment, and optional org-readiness evidence. Edit-time feedback remains limited to compilation and proven **Agent Script Hardening Diagnostics**. Full quality runs after the agent settles and during explicit quality/review requests. High and Moderate settled findings can drive a progress-gated **Agent Script Quality Repair Loop**; Low, Info, and metrics remain human-only.

A High deterministic finding pauses local-file publication without changing compile validity. Users can explicitly approve a session-scoped **Agent Script Quality Publication Override** for one bundle and the reviewed High rule IDs. Newly appearing High rules require another approval. A separately disclosed quality-analysis failure can use the same bundle-scoped session override and is never represented as a clean result. Activation of an already published version is not reanalyzed when its source identity cannot be proven from the local file.

The first release contains only universal rules and report-only metrics. It has no numeric quality score and no organization policy configuration. Each rule has a global-only On/Off preference; project settings cannot override it, and every result discloses disabled coverage. Moderate, Low, and Info findings can use the rule-specific `# sf-agentscript-ignore-next-line <rule-id>: <reason>` suppression; High findings and metrics cannot be suppressed inline.

Direct `sf code-analyzer run` compatibility is deferred. A future ESLint adapter may translate the same native quality results, but ESLint and Salesforce Code Analyzer do not own the v1 rule implementation or configuration.

## Consequences

- SF Pi maintains only Agentforce-specific quality rules and AST-to-flow meaning, not a parser, grammar, type system, or generic graph library.
- Compile-valid source can be publication-blocked by SF Pi quality policy while remaining explicitly compile-valid.
- The rule catalog must skip unknown semantics rather than infer unsupported flow or type facts.
- Existing local source-text hardening checks receive a targeted parity migration: contradicted rules are removed, uncertain rules are deferred, and defensible rules move to official AST passes.
- Project-wide aggregation, organization-specific policy, cross-bundle connected-agent analysis, and Code Analyzer compatibility remain later decisions.
- The v1 catalog and grounding live in `extensions/sf-agentscript/QUALITY_RULES.md`.
