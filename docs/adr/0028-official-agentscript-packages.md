# SF Agent Script Uses Official AgentScript Packages

SF Agent Script uses exact-versioned public `@sf-agentscript/*` npm packages as its Agent Script toolchain source instead of a vendored compiler bundle. This keeps parser, compiler, language-service, and LSP behavior aligned with the maintained AgentScript packages while SF Pi retains a thin hardening adapter for Salesforce/pi-specific diagnostics, quick fixes, rendering, and workflow guardrails.

## Consequences

- `@sf-agentscript/agentforce` is the primary parser/compiler/dialect source for local Agent Script authoring.
- `@sf-agentscript/language` and `@sf-agentscript/lsp` own generic AgentScript diagnostics, quick fixes, and reference/definition semantics where SF Pi exposes those capabilities. Explicit compile/check preserves every upstream severity; automatic edit-loop feedback narrows presentation to errors and warnings.
- SF Pi keeps Structural Agent Script Inspection because it is a stable agent-facing projection, not a raw compiler AST or generic LSP feature.
- Package versions are pinned exactly so diagnostic and compile behavior change only through intentional dependency refreshes.
- Local package support does not prove target-org server compiler support. SF Pi surfaces non-blocking **Agent Script Org Compiler Compatibility Risks** for locally recognized features with observed rollout lag and still requires live server compile evidence before claiming org compatibility.
