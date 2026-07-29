# SF Herdr Agent Guide

Use SF Herdr only when the user explicitly requests Herdr or when operating inside an active Herdr-managed pane with the relevant upstream tools available.

## Workflow

1. Call `sf_herdr_plan` for a Salesforce lane plan. The result is non-mutating and chooses lane lifecycle, not shell commands.
2. Inspect existing workspace/tab/pane topology with upstream Herdr layout tools.
3. Create a fresh ephemeral lane just in time for command-scoped tests, previews, evals, validations, or log tails.
4. Let the owning Salesforce extension choose the actual workflow command.
5. Watch/read the lane until its workflow success condition.
6. Close fresh ephemeral lanes only after success. Preserve failed or timed-out lanes for inspection and ask before cleanup.

## Boundaries

- Do not use Herdr for ordinary one-shot commands or file edits.
- Preserve UI focus unless the user asks to switch.
- Do not shrink the orchestrator below a practical working area or stack many splits directly from it.
- Use sticky/manual lanes for servers or long-lived reviewer agents; never silently reuse stale ephemeral panes.
- If Herdr is unavailable, fall back to the normal SF Pi tool path without blocking the Salesforce task.
