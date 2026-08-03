# SF Agent Script Uses Official AgentScript Packages

SF Agent Script uses exact-versioned public `@sf-agentscript/*` npm packages as its Agent Script toolchain source instead of a vendored compiler bundle. This keeps parser, compiler, language-service, and LSP behavior aligned with the maintained AgentScript packages while SF Pi retains a thin hardening adapter for Salesforce/pi-specific diagnostics, quick fixes, rendering, and workflow guardrails.

## Consequences

- `@sf-agentscript/agentforce` is the primary parser/compiler/dialect source for local Agent Script authoring.
- `@sf-agentscript/language` and `@sf-agentscript/lsp` own generic AgentScript diagnostics, quick fixes, and reference/definition semantics where SF Pi exposes those capabilities. Explicit compile/check preserves every upstream severity; automatic edit-loop feedback narrows presentation to errors and warnings.
- Local authoring follows **Agent Script Dual Upstream Analysis**: SF Pi retains both the official `compileSource` result and the official `processDocument` result for one source identity. Diagnostics form one deterministic union deduplicated by code, source range, and message; any severity-1 result blocks compile validity. Detailed diagnostics remain ordered by source position and then severity/code for stable navigation, while compact summaries prioritize severity. Compiler output, ranges, and the upstream mutable document remain available alongside LSP document state, symbol indexes, navigation, and code actions. SF Pi does not expose an upstream-pipeline-divergence status or choose one official result as the winner.
- SF Pi keeps Structural Agent Script Inspection because it is a stable agent-facing projection, not a raw compiler AST or generic LSP feature.
- Package versions are pinned exactly so diagnostic and compile behavior change only through intentional dependency refreshes.
- Local package support does not prove target-org server compiler support. SF Pi surfaces non-blocking **Agent Script Org Compiler Compatibility Risks** for locally recognized features with observed rollout lag and still requires live server compile evidence before claiming org compatibility.
