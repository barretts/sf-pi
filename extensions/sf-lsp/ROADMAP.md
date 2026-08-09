# SF LSP — Roadmap

Phased plan for the agentic LSP TUI reimagination. Phase 1–3 are shipped.
Future phases are listed here so additional work stays scoped without
growing `index.ts`.

## ✅ Phase 1 — presence (shipped)

- [x] **Live working indicator** (`ctx.ui.setWorkingIndicator`) flips to a
      themed `⠋ LSP Apex…` spinner while diagnostics are being fetched.
- [~] ~~Footer status segment~~ retired in favor of the shared one-line
  readiness row rendered by SF Welcome.
- [~] ~~In-card LSP panel~~ intentionally dropped. Pi's cross-extension
  tool-name conflict detection (`resource-loader.detectExtensionConflicts`)
  refuses to load any extension that re-registers a tool name already
  claimed by another extension. `pi-tool-display` already owns
  `edit`/`write` in most setups. The transcript row, Welcome readiness row,
  working indicator, and rich panel cover the user-facing signal without
  fighting over the tool registry.

## ✅ Phase 2 — continuous visibility (shipped)

- [x] **Inline transcript row** — `pi.appendEntry("sf-lsp", data)` +
      `registerEntryRenderer`. Balanced default (error + transition +
      first unavailable); verbose mode emits every check. User-only, never
      enters LLM context.
- [~] ~~HUD overlay~~ / ~~below-editor widget~~ / ~~footer pill~~ /
  ~~sf-devbar top-bar segment~~ replaced by one compact SF Welcome row
  (`SF LSP  ✓ Apex · ✓ LWC · ✓ Agent Script`) driven by the shared
  `lib/common/sf-lsp-health` registry. The row reports discovery readiness
  only; per-file activity stays in the working indicator and transcript.

## ✅ Phase 3 — controls (shipped)

- [x] **Rich `/sf-lsp` panel** — `ctx.ui.custom` overlay with doctor
      status, recent activity ring, and `SelectList` actions (refresh
      doctor, toggle verbose, shutdown servers).
- [x] **Subcommands** — `/sf-lsp verbose [on|off|toggle]`,
      `/sf-lsp doctor`.
- [x] **Persistent settings** — `verbose` persists to `sfPi.sfLsp` in
      the global Pi settings file. Former `hud` and `icon` keys remain
      ignored for backward-compatible settings reads.

## 🔭 Phase 4 — deeper quick-fixes (planned)

- [ ] Expose Agent Script quick fixes (already present on
      `sfPiDiagnostics.diagnostics[n].fixes`) inside the in-card panel
      with a one-key "apply" chord, similar to VS Code's lightbulb.
- [ ] Keyboard shortcut `Ctrl+.` on a failing file to apply the
      preferred fix.

## 🔭 Phase 5 — workspace-wide view (planned)

- [ ] `/sf-lsp workspace` — fan out doctor + last-check summaries across
      every SF file that has been touched this session, rendered as a
      table inside the rich panel.
- [ ] Optional "lint all open files" action in the panel for batch
      validation before a deploy.

## 🔭 Phase 6 — observability hooks (planned)

- [ ] Append LSP event samples to the session as
      `pi.appendEntry("sf-lsp/event", …)` so `/tree` navigation and
      compaction can replay recent activity state.
- [ ] Offer an "export activity" action that dumps the ring buffer to a
      JSON file for offline analysis.

## Non-goals

- Replacing VS Code's full LSP experience. sf-lsp stays advisory.
- Changing the LLM-facing text appended by `feedback.ts`. That contract
  belongs to the write/edit self-correction loop and stays untouched.
- Owning `.agent` diagnostics when `sf-agentscript` is loaded —
  the precedence rule from Phase 0 still applies.
