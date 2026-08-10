# Roadmap

This roadmap lists unresolved outcomes in rough priority order. It is not a
release promise. Propose concrete designs through a GitHub issue or discussion.

## Now

- Make extension discovery, manifest validation, generated documentation, and
  runtime registration attestation fail closed with focused Behavior Proofs.
- Finish Manager-first no-args command migration for Apex, LWC, and SOQL, then
  enforce the command contract for every bundled extension.
- Simplify current documentation authorities and agent discovery without
  removing behavior or safety guidance.
- Ratchet test coverage toward 60% and promote remaining useful warn-level
  ESLint rules to errors.
- Add consistent `NO_COLOR=1` behavior across splash, spinner, and DevBar.
- Complete the open `sf-skills` Phase 2 outcomes documented in
  [`extensions/sf-skills/ROADMAP.md`](./extensions/sf-skills/ROADMAP.md).

## Next

- Simplify SF Welcome, SF DevBar, SF Pi Manager, and SF Herdr where Pi-native
  behavior parity is proven, while retaining Salesforce-specific status,
  safety, and workflow value.
- Offer a generic OpenAI-compatible gateway path for environments that cannot
  use Salesforce LLM Gateway.
- Add public, generic example fixtures and focused walkthroughs for bundled
  extension workflows.
- Define a stable plugin API for third-party community extensions.
- Consider per-extension telemetry only if a concrete need justifies an
  explicit privacy review and opt-in design.

## Later

- Support first-class Windows environments outside WSL.
- Provide a programmatic SDK for extension-manager workflows.
- Add catalog-driven splash tips and a compact keyboard-shortcut reference.
- Prepare internationalization boundaries while continuing to ship en-US.
- Establish the maintainership, coverage, external integration, security
  operations, and public API commitments required for a stable 1.0 release.

## Non-goals

- SF Pi is not an IDE; Pi remains the agent runtime.
- SF Pi does not present community-built extensions as official Salesforce
  product features.
- Installed copies do not send active runtime telemetry. Repository automation
  may archive aggregate public GitHub metrics.
- Public source, docs, tests, and examples must not contain confidential
  endpoints, credentials, customer data, private org identifiers, or internal
  discussion artifacts.
