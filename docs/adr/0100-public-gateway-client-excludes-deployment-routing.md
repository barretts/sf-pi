# ADR 0100: Public Gateway Client Excludes Deployment Routing

Status: accepted

The public SF LLM Gateway client keeps Pi-owned authentication, authenticated model discovery, offline catalog caching, selection, usage/status surfaces, and provider-neutral Chat Completions, Responses, and Messages adapters. It does not encode exact route aliases, backend placement, traffic tiers, strict-tool allowlists, advanced thinking maps, direct backend probes, protocol fallback, or model-specific payload and stream-finalization behavior. Neutral authenticated metadata may supply API mode and basic capabilities. For an exact discovered ID, SF Pi may inherit portable display and capability fields from Pi's public built-in model catalog, but never provider identity, cost, headers, or provider-specific compatibility. Remaining facts use conservative defaults, and tests and documentation use synthetic model identifiers.
