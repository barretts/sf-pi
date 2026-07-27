# Agent Script Generates Stateful Eval Scenarios for One Evaluation Backend

## Status

Accepted

## Context

SF Agent Script currently generates one-turn Evaluation API step graphs directly from inspected subagents, actions, and connected agents. The current Evaluation API can execute multiple `send_message` and `get_state` steps against one shared session, which is required to prove `after_response` updates and subsequent branch behavior. Salesforce's public Testing API supports conversation-history input, but injected history does not prove that an earlier turn actually mutated session state. Adding both execution paths would create two generators, two result models, and ambiguous evidence semantics.

The live Evaluation API also exposes different evidence than preview. Preview traces contain explicit `RelatedAgentStep` records; eval responses expose `lastExecution`, state snapshots, invoked actions, and LLM events but no direct connected-agent invocation record.

## Decision

SF Agent Script keeps the current Evaluation API as its single eval execution backend and introduces an internal, transport-independent **Agent Script Eval Scenario** model. A deterministic **Agent Script Eval Scenario Compiler** translates scenarios into the existing Evaluation API step graph, centralizing session reuse, step identifiers, references, state checkpoints, and evaluator wiring. The public generated file remains the existing runnable EvalSpec JSON.

Automatic multi-turn generation is evidence-gated. It emits exact state checkpoints only for statically provable `after_response` updates, such as literal assignments or simple arithmetic over known defaults. A behavioral second turn is generated only when a simple source branch is provably activated by those checkpoints. Dynamic updates and unsupported branches are reported as skipped rather than guessed. `include_multi_turn_tests` controls generation and defaults to true.

Eval connected-agent call counts remain unavailable when the API does not expose `RelatedAgentStep`. The digest represents that evidence as unknown with a reason instead of reporting zero or inferring from LLM event order.

## Consequences

- Existing hand-written EvalSpec JSON and `agentscript_eval run` remain compatible.
- Generated specs gain multi-turn counts and structured skip evidence without introducing a second user-maintained format.
- The scenario compiler isolates the current wire protocol so a future supported API can replace the transport without rewriting generation semantics.
- Exact checkpoint evaluators are selected from live-supported evaluator types; unsupported value types are skipped explicitly.
- Batch transport failures are first-class failed-run evidence and must never produce a green zero-result run.
- Preview remains the authoritative source for direct connected-agent invocation telemetry; eval proves state and behavior only from evidence its API exposes.
