---
id: "0099"
status: accepted
date: 2026-08-04
---

# Agent Script Eval Supports Deterministic Turn Response Integrity

## Context

The Salesforce Evaluation API returns the final planner response and the complete nested `lastExecution.llmEvents` sequence for each observed turn. A turn can therefore pass final-response evaluators while containing multiple earlier non-empty LLM completions that a channel could expose. Model-based rubrics can inspect the full event collection, but counting non-empty completions is deterministic and should not require another model call.

Complete response evidence requires an `agent.get_state` after `agent.send_message`. Treating an absent state snapshot as zero LLM events would create false passing evidence. Existing EvalSpecs without a response-integrity policy must remain compatible.

## Decision

EvalSpec supports extension-owned source metadata:

```json
{
  "sf_pi": {
    "turn_response_integrity": {
      "max_nonempty_llm_contents": 1,
      "severity": "error"
    }
  }
}
```

`sf_pi` metadata is retained in source and executed snapshots but is never sent as an Evaluation API test step. `sf-agentscript` deterministically parses every `lastExecution.llmEvents` response and records pass, warning, or unavailable turn evidence.

With `severity: "warning"`, response integrity remains advisory and does not alter the Evaluation API verdict. With `severity: "error"`, any turn above the configured maximum makes evidence Failed. Missing response-sequence evidence makes evidence Incomplete. Strict policy requires exactly one `agent.get_state` after every `agent.send_message`; invalid or unobservable suites fail local preflight before org calls or Run artifact creation.

Turn-response evidence is stored as a separate local section in `evidence.json`; `raw.json` remains the untouched Evaluation API response. Eval verdict semantics advance to version 2. Suite content, including the `sf_pi` policy, remains part of source/executed digests and exact-version release identity.

## Consequences

- Existing suites without `sf_pi.turn_response_integrity` retain their prior verdict behavior.
- Voice and other streaming-sensitive suites can make multiple non-empty completions release-blocking without a model evaluator.
- Warning policy can be adopted before enforcing the gate.
- Strict suites cannot silently pass when `get_state` evidence is missing.
- Eval Studio projectability reports the exact turn missing or duplicating `get_state`.
- Generated release baselines inherit the designated suite's response-integrity policy.
- Scenario runs and resolved seed snapshots preserve the policy.
- Human preview, eval reports, and Eval Studio can display the same deterministic evidence while remaining separate from actual TTS/audio proof.
