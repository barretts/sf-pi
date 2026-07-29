# SF Brain — Code Walkthrough

## What It Does

SF Brain injects two compact hidden context messages:

1. The immutable **Salesforce Engineering Constitution** from [`SF_CONSTITUTION.md`](./SF_CONSTITUTION.md).
2. A tiny **SF Pi Routing Summary** that prioritizes active SF Pi tools and lists only disabled capability owners with their `/sf-pi enable <id>` recovery path.

The constitution establishes Salesforce-first interpretation, Salesforce Change Authority, Behavior-Proof-First Development, minimal-change/evidence expectations, Guardrail authority, raw CLI fallback rules, context discipline, and direct paths to per-extension `AGENT_GUIDE.md` files. Detailed recipes are not always-on context.

User guidance can extend—but never replace—the bundled constitution through `<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`. Legacy replacement-style `SF_KERNEL.md` overrides are intentionally unsupported.

SF Brain also provides a content-safe advisory **Instruction Surface Report** in the SF Pi Manager and through a contributor script. It never registers LLM tools.

## Runtime Flow

```text
before_agent_start
  ├─ constitution live on active branch? → skip
  ├─ otherwise resolve cached sf CLI availability
  ├─ load bundled constitution + optional append-only user guidance
  └─ inject hidden sf-brain-constitution message

before_agent_start
  ├─ build tiny routing summary from package-filter state
  ├─ matching live summary exists? → skip
  └─ inject hidden sf-pi-routing-summary message

context
  └─ keep only the latest live constitution/routing-summary message
```

Compaction-aware session projection re-injects the constitution only when its live entry has been compacted away. Mutable routing state is replaced only when capability enablement changes.

When sf CLI is unavailable, the full constitution remains present and receives a short `<sf_cli_status>` note. SF Brain never fabricates command output or embeds an installation cookbook in always-on context.

## Why Hidden Custom Messages

- Stable bytes benefit provider prompt caching.
- `/resume`, `/fork`, and `/reload` retain live context through the session log.
- Active-branch projection prevents superseded mutable context from accumulating.
- Static principles remain separate from Pi's generic coding prompt and user/project instructions.

## Behavior Matrix

| Event                | Condition                           | Result                                 |
| -------------------- | ----------------------------------- | -------------------------------------- |
| `before_agent_start` | live constitution exists            | skip                                   |
| `before_agent_start` | constitution absent/post-compaction | inject bundled constitution + addendum |
| `before_agent_start` | sf CLI unavailable                  | include compact CLI-status note        |
| `before_agent_start` | routing summary unchanged           | skip                                   |
| `before_agent_start` | extension enablement changed        | inject updated tiny summary            |
| `context`            | older SF Brain context exists       | retain latest value only               |

## Append-Only User Guidance

Create `<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md` to add user-specific guidance. The content is wrapped in `<sf_user_constitution_addendum>` and follows the bundled constitution. Empty or unreadable files are ignored.

`SF_KERNEL.md` is not read. This is a deliberate clean break: custom replacement kernels must be reviewed and migrated manually so old instructions cannot silently remove the Salesforce-first and behavior-proof baseline.

## Instruction Surface Diagnostics

**SF Pi Manager → SF Brain → Instruction surface** opens a read-only report of model-visible context size. It separates SF Pi-owned tool definitions, prompt guidance, hidden context, bundled extension skills, and the externally owned Salesforce skill surface. Counts are advisory characters plus an explicitly approximate characters-divided-by-four token estimate.

The diagnostic uses Pi's public system-prompt options, active tools, skills, and active-branch session projection. It never renders or persists prompt text, context-file contents, tool schemas, skill descriptions, credentials, org details, session ids, or user-specific paths.

```bash
npm run instruction-surface:report
npm run e2e:instruction-behavior -- --model <model> --scenario apex-behavior-fix
```

Artifacts default to `.pi/state/sf-brain/`. The opt-in behavior regression allows bounded local context reads and blocks every non-local tool before execution.

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-brain/
  lib/
    constitution.ts         ← implementation module
    instruction-surface-artifact.ts← implementation module
    instruction-surface-baseline.ts← implementation module
    instruction-surface-manager.ts← implementation module
    instruction-surface-panel.ts← implementation module
    instruction-surface-report.ts← implementation module
    instruction-surface-runtime.ts← implementation module
    routing-summary.ts      ← implementation module
  tests/
    constitution.test.ts    ← unit / smoke test
    injection.test.ts       ← unit / smoke test
    instruction-behavior-eval.test.ts← unit / smoke test
    instruction-surface-artifact.test.ts← unit / smoke test
    instruction-surface-baseline.test.ts← unit / smoke test
    instruction-surface-manager.test.ts← unit / smoke test
    instruction-surface-panel.test.ts← unit / smoke test
    instruction-surface-report.test.ts← unit / smoke test
    instruction-surface-runtime.test.ts← unit / smoke test
    instruction-surface-script.test.ts← unit / smoke test
    progressive-docs.test.ts← unit / smoke test
    routing-summary.test.ts ← unit / smoke test
    smoke.test.ts           ← unit / smoke test
  AGENT_GUIDE.md            ← supporting file
  index.ts                  ← Pi extension entry point
  manifest.json             ← source-of-truth extension metadata
  README.md                 ← human + agent walkthrough
  SF_CONSTITUTION.md        ← supporting file
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Covered behavior includes:

- the bundled constitution is present with or without sf CLI;
- user guidance is append-only and legacy `SF_KERNEL.md` is ignored;
- direct per-extension guide paths are in the constitution;
- the all-enabled routing summary stays tiny;
- disabled capability owners include only their enablement path;
- active-branch and compaction-aware injection deduplication;
- content-safe Instruction Surface classification, baseline comparison, Manager rendering, and exact-Pi report artifacts;
- opt-in behavior-eval facts without hidden scoring or tool execution.

Run focused tests with:

```bash
npx vitest run extensions/sf-brain/tests
```

## Troubleshooting

**The constitution never appears in model context:**

- Confirm `sf-brain` is enabled in `/sf-pi`.
- Start a new session if an older session contains the retired `sf-brain-kernel` entry.
- Inspect the session JSONL for `customType: sf-brain-constitution`; the message uses `display: false`.

**My user guidance does not take effect:**

- Use exactly `<globalAgentDir>/sf-brain/SF_CONSTITUTION_APPEND.md`.
- Legacy `<globalAgentDir>/sf-brain/SF_KERNEL.md` is intentionally ignored.
- Start a new session after changing the addendum; an existing live constitution entry remains stable by design.

**The Instruction Surface baseline is not comparable:**

- Baseline comparison requires the same measurement schema and audited Pi Runtime version.
- Regenerate/review the advisory baseline after intentional runtime or measurement changes.
