---
id: "0012"
status: accepted
date: 2026-05-21
---

# ADR 0012: VitePress Documentation Site

## Context

SF Pi already keeps user docs, contributor docs, generated command references, and extension README files in the repository, but the root README has become the only polished public entry point. A GitHub Pages documentation site should make the project easier to navigate without creating a second source of truth or moving every extension README under `docs/`.

## Decision

Use VitePress from the existing `docs/` directory and publish it through GitHub Pages. The site is user-first, uses a small curated navigation set, keeps narrative pages hand-authored, reuses existing generated command documentation, generates or marker-updates factual extension inventory from catalog metadata, and links to detailed docs outside `docs/` with absolute GitHub source links.

## Consequences

- `docs/` becomes both an in-repo documentation folder and the VitePress source root.
- The root README remains a complete GitHub quickstart, but gains a prominent documentation-site link.
- Extension README files remain co-located with extension source instead of being copied into the site.
- Docs builds become part of local/CI validation so the published GitHub Pages link does not silently drift or break.
