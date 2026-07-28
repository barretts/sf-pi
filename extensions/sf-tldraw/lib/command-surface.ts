/* SPDX-License-Identifier: Apache-2.0 */
import type { SfPiCommandAction } from "../../../lib/common/command-actions.ts";

export type SfTldrawCommandAction = "status" | "documents" | "cheatsheet" | "help";

export const SF_TLDRAW_ACTIONS: SfPiCommandAction<SfTldrawCommandAction>[] = [
  {
    value: "status",
    label: "Check Canvas API status",
    description: "Probe the local tldraw runtime and report supported capabilities.",
    group: "Runtime",
  },
  {
    value: "documents",
    label: "List open documents",
    description: "List open tldraw boards and their opaque document ids.",
    group: "Runtime",
  },
  {
    value: "cheatsheet",
    label: "Open diagram cheatsheet",
    description: "Show the lazy Salesforce Diagram Spec and action reference.",
    group: "Reference",
  },
  {
    value: "help",
    label: "Show help",
    description: "Show command usage and runtime limitations.",
    group: "Reference",
  },
];

export function renderHelp(): string {
  return [
    "# SF tldraw",
    "",
    "Deterministically render grounded Salesforce diagrams into an editable local tldraw canvas.",
    "",
    "Commands:",
    "- `/sf-tldraw` — open the SF Pi Manager detail page.",
    "- `/sf-tldraw status` — probe runtime/API readiness.",
    "- `/sf-tldraw documents` — list currently open documents.",
    "- `/sf-tldraw cheatsheet` — show the lazy tool/spec reference.",
    "",
    "Agent tool:",
    "- `tldraw_canvas` provides v1.12 status, document discovery/creation, and three Salesforce render profiles.",
    "",
    "Runtime boundary:",
    "- tldraw offline v1.12 is required.",
    "- Use the separate create_document tool action when no document is open; render actions never create files implicitly.",
    "- Generic canvas editing and document scripts use the upstream `tldraw-offline` Pi skill.",
    "- sf-tldraw never falls back to OS automation or direct `.tldraw` archive generation.",
  ].join("\n");
}
