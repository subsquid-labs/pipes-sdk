# ADR-8 — 1.0 vocabulary: one name per concept, no transitional aliases

Status: Accepted (historical)

## Context

Pre-1.0 the surface had accumulated synonyms (sink/target, fork/rollback used
interchangeably, exemplar/preview) and deprecated aliases. Options: keep aliases
through a deprecation window, or break once at the major release.

## Decision

Break once: *fork* names the chain event, *resolveFork* the sink operation (find
ancestor, undo above, return cursor), *rollback* the destructive undo alone (which
also runs on recovery); *target* replaces *sink* in the API (this spec deliberately
says "sink" as the language-neutral term and maps it in 03's terminology table);
every deprecated alias was removed rather than aliased. Wire names (the 409
`previousBlocks` key) were left untouched.

## Consequences

Exactly one name per concept across code, metrics, and docs; dashboards and metric
consumers on old names broke once (renamed gauges). One silent hazard shipped: a
method changed *meaning* while keeping a valid signature for external implementers —
motivating the conformance suite's interface tests (CT-5). Shapes 03 terminology,
IB-42.
