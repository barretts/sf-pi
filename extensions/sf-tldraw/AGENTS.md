# sf-tldraw editing rules

Read [`README.md`](./README.md) and [`docs/cheatsheet.md`](./docs/cheatsheet.md) before changing behavior.

## File map

| Responsibility                                           | File                                     |
| -------------------------------------------------------- | ---------------------------------------- |
| Pi registration and Manager-first command                | `index.ts`                               |
| Single family tool and action schema                     | `lib/tldraw_canvas-tool.ts`              |
| Loopback API, bearer-token handling, capability boundary | `lib/runtime-client.ts`                  |
| Grounded Salesforce Diagram Spec checks                  | `lib/spec-validation.ts`                 |
| SLDS icons, marker assets, product-mark gate             | `lib/assets.ts`                          |
| Dagre/fixed-lane placement                               | `lib/layout.ts`                          |
| Family-to-canvas compilation                             | `lib/profiles.ts`                        |
| Fixed tldraw editor program and readiness checks         | `lib/canvas-program.ts`                  |
| Render orchestration and evidence                        | `lib/renderer.ts`, `lib/artifacts.ts`    |
| Five inherited preferences                               | `lib/settings.ts`, `lib/config-panel.ts` |

## Invariants

- Keep one tool: `tldraw_canvas`. Add actions, not more tools.
- Never probe the runtime during module load or block `session_start`. The session hook may read the small server-config presence signal and schedule—but never await—a bounded post-first-paint loopback verification.
- Never guess Salesforce facts. Every semantic element cites a declared source id.
- Never expose the tldraw bearer token, raw auth headers, or private org execution identifiers.
- Use `helpers.createArrowBetweenShapes` for meaningful connectors.
- Sequence activation intervals must be explicit, evidenced spec elements; never infer processing duration from adjacent messages.
- Cross-lane message labels require measured borderless backings and verified z-order above intersecting lifelines or activation bars.
- Cardinality placement must use clipped `getArrowInfo()` terminals and verify the local marker anchor through `getShapePageTransform(marker).applyToPoint(...)`.
- Recursive data-model relationships require an exterior route with distinct card ports; never accept a centre-bound self arrow.
- A successful render requires zero actionable tldraw lints, marker distance at most one canvas unit, and no overlapping marker bounds.
- Verify that requested page creation succeeded before rendering; never fall through to whichever page was already active.
- Preserve user positioning and annotations by default. Only shapes carrying `meta.sfTldraw.managed === true` belong to this extension.
- Never add AppleScript, keystrokes, browser automation, or direct `.tldraw` archive generation as a create-document fallback.
- Keep `docs/cheatsheet.md` lazy. Do not register it as a skill or inject it into every prompt.
- Keep SLDS assets unchanged and update `CREDITS.md` when asset provenance changes.

## Non-goals

- Generic drawing DSL or MCP server.
- Salesforce org querying or docs retrieval; existing SF Pi capability owners gather evidence and pass a normalized spec.
- Mermaid replacement when the user explicitly requests Mermaid or text.
- Silent page splitting, shrink-to-fit, autoplay, or deletion of user annotations.
