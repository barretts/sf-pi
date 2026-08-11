# Contributing Guide For sf-pi

This page lists the operational governance model of this project, as well as
the recommendations and requirements for how to best contribute to `sf-pi`.
We strive to obey these as best as possible. As always, thanks for
contributing – we hope these guidelines make it easier and shed some light on
our approach and processes.

# Governance Model

## Community Based

The intent and goal of open sourcing this project is to increase the
contributor and user base. The governance model is one where new project
leads (`admins`) will be added to the project based on their contributions
and efforts, a so-called "do-acracy" or "meritocracy" similar to that used
by all Apache Software Foundation projects.

# Getting started

Project discussion happens in [GitHub
Issues](https://github.com/salesforce/sf-pi/issues) and
[Discussions](https://github.com/salesforce/sf-pi/discussions). Please also
take a look at the project [roadmap](ROADMAP.md) to see where we are headed.

# Issues, requests & ideas

Use GitHub Issues to submit issues, enhancement requests, and discuss ideas.

### Bug Reports and Fixes

- If you find a bug, please search for it in the
  [Issues](https://github.com/salesforce/sf-pi/issues), and if it isn't
  already tracked,
  [create a new issue](https://github.com/salesforce/sf-pi/issues/new).
  Fill out the "Bug Report" section of the issue template. Even if an Issue
  is closed, feel free to comment and add details, it will still be
  reviewed.
- Issues that have already been identified as a bug (note: able to
  reproduce) will be labelled `bug`.
- If you'd like to submit a fix for a bug, [send a Pull
  Request](#creating-a-pull-request) and mention the Issue number.
  - Include tests that isolate the bug and verify that it was fixed.

### New Features

- If you'd like to add new functionality to this project, describe the
  problem you want to solve in a [new
  Issue](https://github.com/salesforce/sf-pi/issues/new).
- Issues that have been identified as a feature request will be labelled
  `enhancement`.
- If you'd like to implement the new feature, please wait for feedback from
  the project maintainers before spending too much time writing the code.
  In some cases, `enhancement`s may not align well with the project
  objectives at the time.

### Tests, Documentation, Miscellaneous

- If you'd like to improve the tests, make the documentation clearer, have
  an alternative implementation of something that may have advantages over
  the way it's currently done, or you have any other change, we would be
  happy to hear about it!
  - If it's a trivial change, go ahead and [send a Pull
    Request](#creating-a-pull-request) with the changes you have in mind.
  - If not, [open an Issue](https://github.com/salesforce/sf-pi/issues/new)
    to discuss the idea first.

If you're new to our project and looking for some way to make your first
contribution, look for Issues labelled `good first contribution`.

# Contribution Checklist

- [x] Clean, simple, well-styled code
- [x] Commits should be atomic and messages must be descriptive. Related
      issues should be mentioned by Issue number.
- [x] Comments
  - Module-level & function-level comments.
  - Comments on complex blocks of code or algorithms (include references
    to sources).
- [x] Tests
  - The test suite must pass.
  - Increase code coverage, not the reverse.
- [x] Dependencies
  - Minimize number of dependencies.
  - Prefer Apache 2.0, BSD3, MIT, ISC, and MPL licenses.
- [x] Reviews
  - Changes must be approved via peer code review.

# Creating a Pull Request

1. **Ensure the bug/feature was not already reported** by searching on
   GitHub under Issues. If none exists, create a new issue so that other
   contributors can keep track of what you are trying to add/fix and offer
   suggestions (or let you know if there is already an effort in
   progress).
2. **Clone** the forked repo to your machine.
3. **Create** a new branch to contain your work (e.g. `git checkout -b
fix-issue-11`).
4. **Commit** changes to your own branch.
5. **Push** your work back up to your fork.
6. **Submit** a Pull Request against the `main` branch and refer to the
   issue(s) you are fixing. Try not to pollute your pull request with
   unintended changes. Keep it simple and small.
7. **Sign** the Salesforce CLA (you will be prompted to do so when
   submitting the Pull Request).

> **NOTE**: Be sure to [sync your
> fork](https://help.github.com/articles/syncing-a-fork/) before making a
> pull request.

# Contributor License Agreement ("CLA")

In order to accept your pull request, we need you to submit a CLA. You only
need to do this once to work on any of Salesforce's open source projects.

Complete your CLA here: <https://cla.salesforce.com/sign-cla>

# Issues

We use GitHub issues to track public bugs. Please ensure your description
is clear and has sufficient instructions to be able to reproduce the issue.

# Code of Conduct

Please follow our [Code of Conduct](CODE_OF_CONDUCT.md).

# License

By contributing your code, you agree to license your contribution under the
terms of our project [LICENSE](LICENSE.txt) and to sign the [Salesforce
CLA](https://cla.salesforce.com/sign-cla).

---

# Development setup

Everything below is specific to working on `sf-pi` locally.

## Clone and install

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

`npm run lint` covers formatting, generated Data 360/catalog drift, docs and
SPDX policy, shared connection/lifecycle policy, and ESLint. `npm run validate`
covers the broader local lane: generated checks, docs health and site build,
formatting and types, structural/runtime import checks, and the full test
suite. Both validate generated artifacts without regenerating them.
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
Do not create a second copy registry or repeat marketing lists in generated
metadata.

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
  contract files. Exact agent entrypoints live in `docs.primaryFiles`.
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
