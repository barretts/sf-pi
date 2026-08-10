---
id: "0051"
status: accepted
date: 2026-06-15
---

# Extension commands deep-link to the Manager Surface

> **Implementation status:** Complete. Every command-bearing extension's primary
> interactive no-args command routes to its matching SF Pi Manager detail page.
> A package-wide Behavior Proof invokes the real factories and command handlers.

Bundled extension no-args slash commands should act as shortcuts to that extension's SF Pi Manager detail page when an interactive UI is available. Explicit subcommands remain stable for scriptable and direct workflows.

For example, `/sf-guardrail` opens the Manager Surface directly at `SF Pi › SF Guardrail`, while `/sf-guardrail audit`, `/sf-guardrail forget`, and other subcommands still execute directly. `/sf-pi open <extension-id> [settings]` provides the generic deep-link command used by extension shortcuts and by users who want to jump to a specific page.

This consolidates extension UI around one navigation model instead of maintaining a separate no-args panel for every extension. It also keeps extension-specific command surfaces useful: no-args commands become discoverability shortcuts, while explicit subcommands remain stable automation and power-user entrypoints.

**Consequences**

The SF Pi Manager owns the interactive extension detail route. Configurable extension settings continue to drill into the Settings page introduced by ADR 0050. Extension-owned actions can appear on the Manager detail page and may delegate to existing slash subcommands, preserving the current command behavior without duplicating implementation logic.

Non-interactive modes should keep concise text/status behavior rather than trying to open a Manager UI.

The cutover is package-wide: Apex, LWC, and SOQL migrate their remaining
interactive no-args local panels in the same release that makes the
Manager-first Behavior Proof blocking. Existing commands are not grandfathered, and
the old exemption path is deleted rather than retained as a warning-only
transition.

The package-wide blocking Behavior Proof loads every bundled command-bearing
extension, invokes its primary interactive no-args command, and verifies that it
opens the matching Manager detail route. Extensions without slash commands are
non-applicable, and the Manager itself remains the destination-specific special
case.
