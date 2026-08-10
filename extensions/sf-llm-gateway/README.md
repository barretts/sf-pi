# sf-llm-gateway — Code Walkthrough

> **Optional gateway provider.** This extension ships with no default endpoint
> or credentials. To use it, run `/login sf-llm-gateway`, or provide
> compatible automation environment variables. If you do not
> use a compatible gateway, disable it with
> `/sf-pi disable sf-llm-gateway`.

This document explains the design and runtime flow of the LLM Gateway provider
extension. Read this before making changes.

## What It Does

Registers one complete Pi Provider and keeps gateway endpoint handling behind
provider-neutral protocol adapters. Pi owns credential persistence/logout, provider-scoped model
storage, refresh coordination, and dispatch by real model API tags. SF Pi keeps
endpoint normalization, conservative model inference, terminal error guidance,
diagnostics, spend, and telemetry.

## Key Architecture: One Complete Provider, Three APIs

The canonical Provider id is `sf-llm-gateway`, matching the slash command.
Discovered models retain their real API tag:

| Discovered API mode | Generic adapter                  |
| ------------------- | -------------------------------- |
| Chat Completions    | `streamSfGatewayOpenAI[Full]`    |
| Responses           | `streamSfGatewayResponses[Full]` |
| Messages            | `streamSfGatewayAnthropic[Full]` |

Pi's Provider API map dispatches from the resolved model API tag. SF Pi does not
switch protocols after a request starts or infer backend placement from exact
model IDs.

The Provider registers with an empty static model list. Authenticated discovery
supplies callable model IDs, and Pi restores and persists the last successful
catalog through `ModelsStore`; configured endpoints are materialized only at
request time and are not copied into the model cache. Startup performs no
model-discovery network request. A fresh uncached provider exposes no models
until login or `/sf-llm-gateway refresh` succeeds.

### Authentication

`/login sf-llm-gateway` is the primary setup flow:

1. Pi always shows the non-secret gateway root URL. Press Enter to keep the
   current value or type a replacement.
2. SF Pi collects the API key through the shared fixed-mask
   `lib/common/secure-credential-prompt.ts` component; Pi's visible stock secret
   prompt is never called.
3. The Provider returns a canonical `ApiKeyCredential`. Pi persists the key and
   default URL and owns `/logout` removal.

Project/global saved URLs can override the credential's default URL. Environment
variables remain automation fallbacks. The canonical provider identity requires
a one-time `/login sf-llm-gateway`; credentials and cache entries stored under
prior provider identities are not copied or deleted.

## Generic protocol adapters

`lib/transport.ts` exposes thin adapters for Chat Completions, Responses, and
Messages. Pi owns protocol streaming, tool serialization, retries, cancellation,
and thinking selection. SF Pi materializes the configured gateway endpoint and
normalizes bounded terminal error guidance; it does not encode exact route
aliases, backend placement, traffic tiers, or model-specific payload mutations.

### Discovered model metadata

Authenticated model metadata supplies API mode, context/output limits,
reasoning support, and input capabilities. When an exact discovered ID exists in
Pi's public built-in catalog, SF Pi inherits portable name, protocol, reasoning,
input, context/output, and thinking-map fields while keeping gateway cost at zero
and discarding provider identity, headers, and provider-specific compatibility.
Remaining fields use conservative defaults. Pi persists the last successful
catalog so discovered models remain available offline.

## Runtime Flow

```
Extension loads
  ├─ installWireTrace()                 ← opt-in, redacted gateway trace
  ├─ registerProvider(completeProvider) ← empty baseline + Pi cache restore
  ├─ registerEntryRenderer()            ← human-only headless report renderer
  ├─ registerCommand("sf-llm-gateway")
  ├─ on("session_start")               → bind cwd/UI/model registry; local settings repair
  ├─ on("turn_end")                    → update footer status; first turn_end also
  │                                       kicks refreshUsageDetails (daily activity, key list)
  ├─ on("model_select")                → refresh footer; Pi/user settings retain thinking authority
  ├─ on("after_provider_response")     → record throttle/upstream signal (gateway provider)
  └─ on("session_shutdown")            → cancel auth UI; clear cwd/footer/provider state
```

## Connecting

Use Pi's provider login as the primary connection flow:

```text
/login sf-llm-gateway
  → review URL (Enter keeps the current value)
  → enter API key in SF Pi's masked component
  → Pi persists the credential and starts a bounded provider refresh
```

`/sf-llm-gateway setup [global|project]` is non-secret, persistence-only
configuration for the saved endpoint override and scoped model mode. It performs
no model discovery, usage probe, enable, or disable work; those remain explicit
Manager actions and slash subcommands. Help and certificate settings remain
available through their documented environment or saved-config fields.

Adjacent **Connect** group rows make the rest of the onboarding self-service:

- **Open token page in browser** — launches the configured gateway root in
  your browser so you can sign in and copy a token without leaving pi.
- **Import from Claude Code** — imports a non-secret URL and CA candidates.
  Credential presence can be detected for guidance, but the value is never
  returned or copied; authenticate through `/login`.
- **One-shot onboard** — chains non-secret Claude Code import + CA discovery →
  Pi model refresh → doctor preflight → set default in a single keystroke.
  When the doctor surfaces a TLS-class failure on macOS, the chain hands off to
  **Fix corporate CA**.
- **Fix corporate CA (macOS)** — wires `NODE_EXTRA_CA_CERTS` into both the
  LaunchAgent (Dock/Spotlight launches) and `~/.zshenv` (Terminal launches)
  in one shot. Adopts an existing PEM found in saved candidates, shell exports,
  or bounded Claude Code / DevBar / AI Suite locations such as
  `~/.claude/*.pem`, `~/.devbar/*.pem`, and `~/.aisuite/conf/*.pem`; falls
  back to downloading from saved `caBundleSource` (or
  `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE`) when the bundle source is
  configured. Public sf-pi ships no default download URL on purpose — the
  source is organization-specific.

Splash-side, when the most recent doctor run flagged a TLS failure on
macOS and no fix has been applied, sf-welcome adds a single muted nudge
row under the gateway status: "`/sf-llm-gateway fix-ca-bundle` — Wire your
corporate CA into Node — LaunchAgent + ~/.zshenv in one shot." The row is
gated by `isSfPiExtensionEnabled("sf-llm-gateway")` so external
users never see it, and the gate reads pre-persisted state — no live
probing on the splash hot path.

## Configuration

Request authentication uses these explicit precedence rules:

- **API key**: Pi `ApiKeyCredential` > `SF_LLM_GATEWAY_API_KEY` > missing.
- **Base URL**: project/global saved non-secret override > URL stored with the Pi credential > `SF_LLM_GATEWAY_BASE_URL` > missing.
- **Help URL**: saved.helpUrl > `SF_LLM_GATEWAY_HELP_URL` > unset.
  Optional. When set, the doctor appends a trailing `More info: <url>`
  recommendation. Empty by default; organizations can wire it via env or saved
  config.
- **CA bundle download URL**: saved.caBundleSource >
  `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE` > unset. Used by
  `fix-ca-bundle` when no local PEM is found. Empty default — set this to opt
  into the bootstrap path.
- **CA bundle candidate paths**: saved.caBundleCandidates (string[]).
  Extra absolute paths the `fix-ca-bundle` probe scans before the
  built-in well-known list (`~/.aisuite/conf/*.pem`).
- **Saved config**: `~/.pi/agent/sf-llm-gateway.json` (global),
  `.pi/sf-llm-gateway.json` (project)
- **Scoped model mode**: saved config can keep gateway scope **additive**
  (prepend `sf-llm-gateway/*`) or **exclusive**
  (replace scoped models with only gateway models and restore the prior scope on disable)

Project-scoped non-secret config overrides global. A Pi-saved credential wins
over stale key environment variables. URL userinfo is rejected so credentials
cannot be embedded in non-secret endpoint configuration.

### Advanced / automation

Environment variables remain available for automation and CI:

- **Env vars**: `SF_LLM_GATEWAY_BASE_URL` + `SF_LLM_GATEWAY_API_KEY`
  for shell-driven automation.
  Direct edits of `sf-llm-gateway.json` are supported only for
  non-secret settings. Existing `apiKey` fields are detected only for migration
  guidance and explicit confirmed cleanup; no request, setup, or import path uses,
  creates, copies, or silently removes them.

Configure the base URL as your organization's gateway **root URL**, for
example `https://your-gateway.example.com`. If a user pastes a known route
suffix such as `/v1` or a model-specific route suffix, the config layer
canonicalizes it back to the root. Runtime endpoint helpers then derive the
correct routes: OpenAI-compatible chat/model discovery uses the gateway's `/v1`
route, Anthropic Messages uses the gateway root because the SDK appends
`/v1/messages`, and admin calls such as `/v2/user/info`, `/user/info`, and
`/key/info` use the gateway root.

## Zero-cost gateway billing

All models report `cost: 0` because the gateway is pre-paid. Billing is tracked
separately via user-info endpoints. The footer prefers the lightweight
`/v2/user/info` self-lookup, uses `/key/info` only for key-scoped details, and
falls back to the legacy `/user/info` route for older or v2-denying gateways.

## Command Surface

`/sf-llm-gateway` with no args opens SF LLM Gateway in the SF Pi Manager. The first
group, **Connect**, exposes endpoint setup, native `/login` guidance, open
the token page in a browser, or import from Claude Code. Subsequent groups
cover post-connect tweaks (`on`, `off`, `set-default`), discovery and
diagnostics, utilities, and reference output.

The slash command and provider identity are both `sf-llm-gateway`, so setup,
model routing, and `/login` use one canonical name.

The Manager detail page preserves the grouped command surface. Press `S` to switch global/project scope. The `setup` action edits only non-secret endpoint and model-scope settings; read-only reports use the standard Manager info popup. In headless/print/RPC mode, the no-args command falls back to text status.

Primary actions are grouped as:

| Group                   | Actions                                           | Purpose                                                                                          |
| ----------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Connect                 | `setup`, `import-claude`, `open-token`, `onboard` | Configure non-secret settings, discover existing setup, and hand credentials to native `/login`. |
| Setup                   | `on`, `off`, `set-default`                        | Enable/disable routing and control defaults.                                                     |
| Discovery & diagnostics | `refresh`, `models`, `doctor`, `usage-probe`      | Re-probe model discovery, health, and usage scope.                                               |
| Utilities               | `tokens`                                          | Count prompt tokens/cost.                                                                        |
| Reference               | `status`, `help`                                  | Print complete text reports for copying or headless use.                                         |

Slash completions use the same command metadata as the panel, so subcommands
such as `tokens`, `onboard`, `open-token`, `import-claude`, `doctor`, and
`usage-probe` show short self-explanatory descriptions while typing.

Display-only command reports stay outside model context. TUI uses the existing
information panel, RPC emits notifications, JSON emits state-only custom-entry
events, and print mode writes the report while appending the same model-invisible
entry to the active session.

## Behavior Matrix

| Event/Trigger                | Condition                        | Result                                                                                                                                    |
| ---------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Extension load               | —                                | Register one complete Provider; synchronously expose baseline and restore Pi's model cache offline                                        |
| session_start                | —                                | Bind cwd/UI/model registry and run local settings repair; no discovery network                                                            |
| turn_end                     | model is on gateway provider     | Update footer (context + monthly usage); first turn_end also kicks refreshUsageDetails (daily activity, key list)                         |
| turn_end                     | model is not on gateway provider | Clear footer status                                                                                                                       |
| model_select                 | any model change                 | Refresh footer; never mutate Pi's active thinking level                                                                                   |
| after_provider_response      | gateway model + 2xx/3xx          | Clear any live throttle/upstream badge                                                                                                    |
| after_provider_response      | gateway model + 429              | Record throttle signal, footer shows ⚠ badge for 60s                                                                                      |
| after_provider_response      | gateway model + >=500            | Record upstream signal, footer shows ⚠ badge for 60s                                                                                      |
| session_shutdown             | —                                | Cancel credential UI and clear cwd/auth/footer/provider state                                                                             |
| /command (no args)           | interactive UI                   | Open the SF Pi Manager detail page                                                                                                        |
| /command (no args)           | no UI                            | Print text status report                                                                                                                  |
| /command on                  | missing credentials              | Configure endpoint if needed and prefill `/login sf-llm-gateway`                                                                          |
| /command on                  | credentials present              | Save non-secret scope/default settings and explicitly refresh Pi models                                                                   |
| /command off                 | additive scope                   | Disable, remove gateway pattern, switch to off-default                                                                                    |
| /command off                 | exclusive scope                  | Disable, restore previous scoped models, switch to off-default                                                                            |
| /command refresh             | —                                | Re-discover, refresh monthly usage                                                                                                        |
| /command usage-probe         | —                                | Force a read-only usage probe and classify key/user spend scope                                                                           |
| /command usage-probe --trace | —                                | Render the per-endpoint trace (timings + status) from the last refresh                                                                    |
| Monthly usage fetch          | cached < 60 s old                | Use cache                                                                                                                                 |
| Monthly usage fetch          | stale or forced                  | Fetch gateway `/v2/user/info`; retry with the `/key/info` user id only when required; fallback to legacy `/user/info` for older gateways. |

## File Structure

<!-- GENERATED:file-structure:start -->

```
extensions/sf-llm-gateway/
  lib/                        ← implementation modules
  tests/                      ← Behavior Proofs and test fixtures
  AGENTS.md                   ← agent editing rules
  index.ts                    ← Pi extension entry point
  manifest.json               ← source-of-truth extension metadata
  README.md                   ← human behavior and usage
```

<!-- GENERATED:file-structure:end -->

## Testing Strategy

Tests cover exported pure helpers. Functions that need Pi runtime context
(event handlers, command handlers, UI interactions) are tested via manual QA.

To run all unit tests: `npm test`

Exported helpers are marked with `// Exported for unit tests.` in the source.

## Doctor: `/sf-llm-gateway doctor`

Run `/sf-llm-gateway doctor` when the gateway appears connected but
requests fail. It is read-only and checks the configured URL, the normalized
OpenAI-compatible route, the gateway root route, API key presence, model
discovery, and gateway health. It interprets common failures such as 401 auth
errors, SSO/browser redirects, and `model=v1` routing mistakes.

## Usage probe: `/sf-llm-gateway usage-probe`

Run `/sf-llm-gateway usage-probe` after key rotation or when usage
numbers look surprising. It forces a read-only user-info + `/key/info` refresh,
reports the live gateway connection classification, shows monthly/user spend and
current-key spend separately, and explicitly explains whether the available data
proves a true lifetime user counter. The welcome splash does not render a Lifetime
Usage line because the currently available gateway endpoints do not prove true
user-lifetime spend.

## Debugging: wire trace

When the gateway returns empty or unexpected responses, enable the opt-in
wire trace to capture raw request/response bytes on disk:

```bash
SF_LLM_GATEWAY_TRACE=1 pi
```

On activation, `lib/wire-trace.ts` wraps `globalThis.fetch` and logs one JSON
line per request, response header block, and SSE chunk to
`~/.pi/agent/sf-llm-gateway.trace.jsonl`. The file is truncated on
each pi launch and filtered by the gateway base URL, so other providers'
requests pass through untouched.

The `/sf-llm-gateway status` report shows a `Wire trace: ON` line
with the file path while tracing is active; the line is omitted when the
env var is not `1`.

A fetch wrapper is preferred over Pi's `onPayload` / `onChunk` hooks because
`onChunk` runs after pi-ai's SSE parser — if pi-ai drops a chunk, `onChunk`
wouldn't show it. The raw body is ground truth from the gateway.

## Troubleshooting

**A discovered model shows its raw ID or conservative 128K/4K metadata:**
Reload the extension or restart Pi, then run `/sf-llm-gateway refresh`. Exact
discovered IDs inherit portable metadata from Pi's public model catalog during
refresh. If Pi previously clamped thinking while the conservative entry was
active, select the desired level again with `/thinking`; SF Pi never changes the
user-owned thinking setting itself.

**Startup warning `No models match pattern "sf-llm-gateway/*"`:**
A fresh uncached provider has no models until authenticated discovery succeeds.
Run `/login sf-llm-gateway`, then `/sf-llm-gateway refresh`. Later
offline starts restore the last successful catalog from Pi's model store.

**Model discovery only returns `no-default-models`:**
Some LiteLLM configurations use `no-default-models` as an access-control
sentinel rather than a callable model id. The extension filters that sentinel
from `/v1/models`; when no callable peers remain, discovery fails without
replacing the last successful cached catalog. Run `/sf-llm-gateway doctor` to
verify endpoint and credential readiness.

**Login says the API key was saved but the model catalog could not be refreshed:**
Credential persistence succeeded, but the required `/v1/models` request failed.
Run `/sf-llm-gateway doctor` to distinguish authentication, wrong-root/redirect,
TLS, timeout, and service failures. The status report preserves only bounded,
public-safe failure categories and says explicitly when no cached catalog is
available. Setup remains usable because saving non-secret settings never waits
for discovery.

**Gateway fails on startup or tool calls error out immediately:**
Run `/login sf-llm-gateway` for first-time onboarding. Login collects
a missing non-secret root URL and then opens SF Pi's masked API-key component.
`/sf-llm-gateway setup` edits only non-secret project/global overrides; Claude
Code import never copies credentials. Environment variables remain automation
fallbacks. The base URL should be the gateway root, for
example `https://your-gateway.example.com`. If a user pastes a route with a
public suffix `/v1`, the extension canonicalizes it back to the gateway root.
Run `/sf-llm-gateway doctor` for endpoint and credential preflight checks.

**A discovered model fails during a request:**
The public client does not infer deployment routes, traffic tiers, strict-tool
support, or advanced thinking from a model ID. Confirm that authenticated
metadata reports the correct API mode, or use Pi's local `models.json` override
for supported model fields.

**Footer shows `⚠` badge after a 429 or 5xx:**
`provider-telemetry.ts` parses retry-after headers and surfaces a 60s
badge. The next successful 2xx/3xx clears it. If the badge sticks, check
`/sf-llm-gateway status` for the live throttle/upstream signal.

**I set `/thinking` to a different level but subsequent model switches reset it:**
SF Pi never selects or persists a Gateway thinking level. Gateway model metadata
may advertise reasoning support, while Pi inherits and clamps the active
user/settings choice when models change. Check Pi's `/thinking` selection
and `defaultThinkingLevel` setting if an unexpected level remains active.

**Monthly-usage footer is stale or missing:**
Usage is cached for 60 seconds and refreshes automatically on every
`turn_end`; run `/sf-llm-gateway refresh` to force a usage probe
immediately. The extension first tries the lightweight `/v2/user/info`
self-lookup. If a gateway requires an explicit user id, it derives the
current id from `/key/info` and retries `/v2/user/info?user_id=...`; if v2
is unavailable, it falls back to legacy `/user/info`. If you're using
sf-welcome or sf-devbar as consumers, they read from the shared store in
`lib/common/monthly-usage/` — the gateway must be registered and have
succeeded at least once.

**Old and new gateway keys are confusing status or tests:**
Saved pi config wins over `SF_LLM_GATEWAY_API_KEY`. If both are set
and differ, `/sf-llm-gateway status` and `doctor` warn that the env var is
ignored. If the env key is newer, run `/sf-llm-gateway` to save it; otherwise
remove the stale env var from your shell or Keychain setup. If the gateway
reports multiple keys on the
account, confirm the active masked key in status, verify pi works with the
current key, then prune older unused keys in the gateway UI.

**Doctor reports `WARN: fetch failed` on macOS even though `curl` works:**
Node on macOS ignores the system keychain. When the gateway sits behind a
corporate CA, every Node fetch fails with a generic `fetch failed` while
`curl` (which uses the keychain) succeeds. The doctor recognizes this
fingerprint and points at `/sf-llm-gateway fix-ca-bundle`, which wires
`NODE_EXTRA_CA_CERTS` into both the LaunchAgent (Dock/Spotlight launches)
and `~/.zshenv` (Terminal launches) in one shot. The fix probes
well-known paths in Claude Code, DevBar, and AI Suite config folders, adopts
valid PEM paths already referenced by `NODE_EXTRA_CA_CERTS` in `~/.zshrc`,
`~/.zprofile`, `~/.zshenv`, or the sf-pi LaunchAgent, and includes any extras
saved under `caBundleCandidates` in the gateway saved config. If `NODE_EXTRA_CA_CERTS` is only
in `~/.zshrc` or `~/.zprofile`, doctor calls that out because pi may not see it
for every launch path; `fix-ca-bundle` mirrors the valid bundle into
`~/.zshenv` and the LaunchAgent. When no candidate is found and
saved `caBundleSource` (or `SF_LLM_GATEWAY_CA_BUNDLE_SOURCE`)
is set, the action downloads the bundle into
`~/.pi/agent/sf-llm-gateway/ca-bundle.pem` after explicit
confirmation. Each disk-mutating step is HITL-gated; a sentinel-guarded
block in `~/.zshenv` makes re-applies idempotent.

**`/sf-llm-gateway onboard` says `not configured`:**
The one-shot chain stops short when no saved gateway URL+key exists post‑
import. Either run `/sf-llm-gateway setup` to enter them manually, or
run `/sf-llm-gateway open-token` to grab a token from the gateway UI.
The chain also saves detected CA bundle candidates so a later TLS handoff can
adopt an existing bundle instead of requiring a download URL. It halts before
`set-default` when the doctor preflight fails — follow the next-action hint
embedded in the report (TLS → fix-ca-bundle, auth → setup, redirect → fix the
base URL).

**Splash keeps showing the `/sf-llm-gateway fix-ca-bundle` nudge after I
ran the fix:**
The nudge gates on `~/.pi/agent/sf-pi/sf-llm-gateway/ca-bundle-fixer.json`
being populated. The fix-ca-bundle action writes that file on a successful
apply. If the file is missing (e.g. the apply was interrupted or you
rolled it back manually), re-run the action so the splash sees the
applied state. The same row also clears once the next doctor run
persists `failureClass: null` to `ca-probe.json`, which happens
automatically on the deferred `turn_end` refresh.
