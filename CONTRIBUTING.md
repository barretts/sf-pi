# Contributing to SF Pi

Thanks for contributing to `sf-pi`. This guide owns local setup, validation,
extension changes, pull requests, and releases. Project roles and decisions live
in [`GOVERNANCE.md`](./GOVERNANCE.md); vulnerability reporting lives in
[`SECURITY.md`](./SECURITY.md). Please also follow the
[Code of Conduct](./CODE_OF_CONDUCT.md) and
[public-sanitization policy](./docs/public-sanitization.md).

## Before starting

Search existing [Issues](https://github.com/salesforce/sf-pi/issues) and
[Discussions](https://github.com/salesforce/sf-pi/discussions). Open an issue for
a substantial bug or feature before investing in a broad implementation. Small
documentation corrections, focused tests, and obvious fixes can go directly to
a pull request.

The active [roadmap](./ROADMAP.md) contains only unresolved repository outcomes.
Runtime code and Behavior Proofs remain authoritative for implemented behavior.

## Contribution expectations

- Keep changes small, focused, and consistent with existing style.
- Use atomic Conventional Commits and reference related issues when useful.
- Comment non-obvious contracts and rationale, not obvious syntax.
- Add or update Behavior Proofs for behavioral changes and run the relevant
  focused checks.
- Minimize dependencies and justify any new one.
- Keep public code, docs, examples, tests, and diagnostics source-agnostic and
  free of secrets or private identifiers.
- Use a pull request unless the documented maintainer fast path applies.

## Creating a pull request

1. Fork and clone the repository, then create a focused branch.
2. Make the smallest change that solves the documented problem.
3. Run focused checks while iterating and the broad validation appropriate to
   the change.
4. Push the branch and open a pull request against `main`.
5. Complete the pull request template with tests, generated artifacts, security
   impact, and residual risks.
6. Sign the Salesforce CLA when prompted.

Sync the fork before opening or updating the pull request. Avoid unrelated
formatting or refactors.

## CLA and license

Contributions require the one-time
[Salesforce CLA](https://cla.salesforce.com/sign-cla) and are accepted under the
project's [Apache License 2.0](./LICENSE.txt).

## Development setup

### Clone and install

```bash
git clone https://github.com/salesforce/sf-pi.git
cd sf-pi
npm install
```

`npm install` runs the `prepare` script, which installs Husky hooks:

- `pre-commit` runs gitleaks on the staged diff when available, applies
  lint-staged formatting/fixes, then exports and checks the staged Git snapshot
  for generated catalog drift without changing the index or working tree.
- `commit-msg` validates
  [Conventional Commits](https://www.conventionalcommits.org/).
- `pre-push` blocks force-pushes and deletion of `main`; CI remains the source
  of truth for full lint/typecheck/test validation.

Optional local install for manual testing:

```bash
pi install .
```

## Scripts reference

The most common entry points, grouped by purpose:

| Purpose                  | Command                                                                      | Check-only variant                      |
| ------------------------ | ---------------------------------------------------------------------------- | --------------------------------------- |
| Regenerate catalog       | `npm run generate-catalog`                                                   | `npm run generate-catalog:check`        |
| Check staged catalog     | —                                                                            | `npm run generate-catalog:check-staged` |
| Format                   | `npm run format`                                                             | `npm run format:check`                  |
| SPDX headers             | `npm run spdx`                                                               | `npm run spdx:check`                    |
| Docs health              | `npm run docs:health`                                                        | `npm run docs:health:check`             |
| Source architecture      | —                                                                            | `npm run check:architecture`            |
| Docs site                | `npm run docs:dev` / `npm run docs:preview`                                  | `npm run docs:build`                    |
| ESLint                   | `npm run eslint:fix`                                                         | `npm run eslint`                        |
| Type check               | —                                                                            | `npm run check`                         |
| Command contracts        | —                                                                            | `npm run check:commands`                |
| Manager-first navigation | —                                                                            | `npm run check:manager-first`           |
| Run tests                | `npm test`                                                                   | —                                       |
| Runtime surface contract | `npm run test:runtime-surface`                                               | —                                       |
| Tests + coverage         | `npm run test:coverage`                                                      | —                                       |
| Watch tests              | `npm run test:watch`                                                         | —                                       |
| Lint bundle              | —                                                                            | `npm run lint`                          |
| Full local validation    | —                                                                            | `npm run validate`                      |
| CI-like local validation | —                                                                            | `npm run validate:ci`                   |
| CI artifact guard        | —                                                                            | `bash scripts/check-llm-artifacts.sh`   |
| Instruction surface      | `npm run instruction-surface:report`                                         | —                                       |
| Instruction behavior     | `npm run e2e:instruction-behavior -- --model ...`                            | —                                       |
| Scaffold a new extension | `npm run scaffold -- --id sf-my-ext --category ui --intent "Personalize pi"` | —                                       |

`npm run lint` covers formatting, generated Data 360/catalog drift, docs,
source-architecture and SPDX policy, shared connection/lifecycle policy, and
ESLint. `npm run validate` covers the broader local lane: generated checks,
docs and source-architecture health, site build, formatting and types,
structural/runtime import checks, and the full test suite. Both validate
generated artifacts without regenerating them.
`npm run validate:ci` wraps that lane with the remaining CI-facing lint and
artifact checks and reasserts docs health.

If generated drift is reported, run `npm run generate-catalog` explicitly,
review the complete diff, and stage the intended outputs. The pre-commit check
uses only the Git index, so coherent partial commits are allowed even when
unrelated changes remain unstaged. The lint-staged SPDX, Prettier, and ESLint
fixes remain intentionally mutating for staged files.

## Source of truth

Runtime code and Behavior Proofs define implemented behavior. Each
`extensions/<id>/manifest.json` declares the public routing and documentation
contract attested against that runtime. Generated catalog/docs project the
manifest; the extension README owns human explanation.

### Generated files

Do not edit these manually:

- `catalog/registry.ts`
- `catalog/index.json`
- `docs/extensions.md`
- `docs/extensions/*.md`
- `docs/.vitepress/generated-extension-sidebar.ts`
- `docs/commands.md`
- `docs/agent-orientation.md`
- `docs/adr/README.md`
- generated sections in `README.md`: bundled extensions and command reference
- generated troubleshooting index in `docs/troubleshooting.md`
- generated folder layout in `ARCHITECTURE.md`
- generated file-structure blocks in `extensions/*/README.md`
- normalized `catalog/announcements.json`
- validated / normalized `catalog/recommendations.json`

Regenerate them with:

```bash
npm run generate-catalog
```

## Code style

This repo prefers:

- simple code
- explicit control flow
- clear comments for non-obvious behavior
- small modules split by responsibility
- self-contained extensions

Avoid:

- clever abstractions
- hidden behavior
- broad utility layers that mix unrelated concerns

## Adding or changing an extension

Each extension lives in `extensions/<id>/` and should usually contain:

- `index.ts`
- `manifest.json`
- `README.md`
- `lib/`
- `tests/`

Complex extensions (lots of rules, multiple write surfaces, non-obvious
conventions) should also add an `AGENTS.md` at `extensions/<id>/AGENTS.md`
with a short file map and any editing rules. See
[`extensions/sf-slack/AGENTS.md`](./extensions/sf-slack/AGENTS.md) and
[`extensions/sf-llm-gateway/AGENTS.md`](./extensions/sf-llm-gateway/AGENTS.md)
for examples. Add an extension `ROADMAP.md` only for concrete unresolved
outcomes with observable completion conditions. Remove shipped history and
delete the roadmap when no active outcome remains.

Scaffold a new extension with:

```bash
npm run scaffold -- --id sf-my-extension --category ui --intent "Personalize pi" --name "My Extension"
```

The manifest's `description` is its concise factual catalog description.
`docs.summary` is the longer factual explanation, and `docs.intentGroup` is
one of the generated browse-page outcomes defined in `catalog/types.ts`.
`docs.primaryFiles` is a read-first route capped at eight entries, not a recursive
inventory. Markdown under an extension's `docs/` or `references/` directory must
be covered by `docs.referenceRoots` and a routed index; generated-current roots
also name their repository generator. Do not create a second copy registry or
repeat marketing lists in generated metadata.

The `--category` must be one of the six values defined by
`catalog/types.ts`:

- **`manager`** — the SF Pi Manager meta surface.
- **`provider`** — model or identity providers registered with Pi.
- **`agent-tool`** — extensions that contribute LLM tools or skills.
- **`safety`** — gating, permission, or guardrail extensions.
- **`assistive`** — helpers, diagnostics, prompts, or feedback flows.
- **`ui`** — purely visual surfaces such as splashes, status bars, HUDs, and
  spinners.

### Extension README conventions

An extension README is the human behavior and usage page. Keep it focused:

- **What It Does** is required and describes current user-visible behavior.
- Explain how a human starts the extension and document real commands,
  settings, credentials, safety boundaries, and recovery steps when relevant.
- The generated **File Structure** block gives only directory roles and root
  contract files. A small read-first set lives in `docs.primaryFiles`; deeper
  material is routed through `docs.referenceRoots` indexes.
- Put editing invariants in `AGENTS.md`, tool ordering/recovery in
  `AGENT_GUIDE.md`, rationale in ADRs, and test commands in this guide unless an
  extension has a genuine exception.
- Do not add event-by-event Runtime Flow, Behavior Matrix, or generic Testing
  Strategy sections merely to satisfy a template.

When real extension-specific recovery guidance exists, use a
`## Troubleshooting` section with entries shaped like `**Symptom:**` or
`**Question?**`. The catalog generator includes those entries in the generated
troubleshooting index. Omit the section rather than adding placeholders.

## Proposing a recommended extension

sf-pi keeps a curated list of external open-source pi extensions in
[`catalog/recommendations.json`](./catalog/recommendations.json). We do not
redistribute these packages — we only point at their upstream sources so
users can install them via `pi install`.

To propose a new recommendation:

1. Add an entry to `catalog/recommendations.json` with:
   - a stable sf-pi-local `id` (kebab-case)
   - `name`, `description`, `source`, `homepage`, `license`, `rationale`
   - optional `scope` (`"global"` or `"project"`) if the default differs
2. If it belongs to a bundle (for example `default`), add its id to that
   bundle's `items` array.
3. Bump the top-level `revision` to today's date (`YYYY-MM-DD`). This
   re-arms the one-time nudge for users who already acknowledged the
   previous revision.
4. Run `npm run generate-catalog` — the script validates the schema and
   fails if the `license` is not in the allow-list (`MIT`, `Apache-2.0`,
   `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`).
5. Open the PR with:
   - a link to the upstream repo and its license file
   - a short rationale (why is this worth recommending to sf-pi users?)
   - any compatibility notes (pi version, OS, required auth, etc.)

PRs that broaden the license allow-list must update both
`scripts/generate-catalog.mjs` and `catalog/types.ts` in the same change
and justify the addition in the PR description.

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/).
Husky's `commit-msg` hook enforces this via commitlint. Short version:

```
<type>(<optional-scope>): <short summary>

<optional body>

<optional footer>
```

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
`build`, `ci`, `chore`, `revert`, `security`.

Breaking changes include `!` after the type/scope, or a `BREAKING CHANGE:`
footer. Both trigger a major version bump under `release-please`.

## Maintainer fast path

The PR workflow above is the default for external contributors. Maintainers
may use the solo fast path documented in [`AGENTS.md`](./AGENTS.md): for
low-risk changes, commit directly to `main` and let CI / release-please do the
verification and release work. Use a PR instead for risky changes, public API
breaks, destructive migrations, or when a named reviewer is required.

## Releases

Releases are automated via
[release-please](./.github/workflows/release-please.yml):

1. Conventional-Commit PRs merged to `main` trigger release-please.
2. Release-please opens or updates a release PR with the next version +
   CHANGELOG entry.
3. Once CI is green on the release PR it gets squash-merged (automation
   or maintainer) and the tag + GitHub Release are cut automatically.
