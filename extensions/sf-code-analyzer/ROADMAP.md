# SF Code Analyzer Roadmap

Only one concrete hardening gap remains. The implementation already supports
grouped local scans, optional ApexGuru execution, repeated-finding loop stops,
broader recipe guidance, transcript rows, and report artifacts. Pure helper
coverage exists; the remaining gap is proof through the deferred orchestration
interface itself.

## Now — deferred auto-scan orchestration proofs

Add focused tests through `registerDeferredCodeAnalyzerAutoScan` that prove:

- one local scan group can fail without discarding successful groups, findings,
  or report paths;
- ApexGuru runs after local groups only when enabled and ready, and stale or
  unavailable readiness produces an explicit skip;
- an unchanged violation signature stops the automatic repair loop without
  queuing another follow-up;
- broader validation guidance produced by real group execution reaches the
  queued follow-up.

Completion requires behavior assertions in
`tests/auto-scan-orchestration.test.ts`; source-string checks or isolated
formatter tests do not satisfy this item.

## Non-goals

- Bundling Code Analyzer engines or rules inside SF Pi.
- Automatically running broad/noisy recipes such as `all`, `AppExchange`,
  `cpd`, or `sfge` from deferred auto-scan.
- Hiding SF Browser setup work inside Code Analyzer.
