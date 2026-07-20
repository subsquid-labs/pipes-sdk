# ADR-3 — The source owns a monotonic finalized floor; sinks persist it verbatim

Status: Accepted (historical)

## Context

Different portal replicas and sources disagree on finality depth; a replica swap or
transient absence of a finalized head could "un-finalize" data already released to
immutable storage. Clamping could live in every sink (N implementations, N bugs) or
once in the source.

## Decision

The source maintains the single monotonic finalized watermark, clamping every reported
head upward against the floor and re-seeding it from persisted sink state (`finalized`
only, never `latest`). Sinks persist the clamped values verbatim and never re-derive
finality.

## Consequences

Finality logic exists exactly once (INV-2, INV-12, WP-2, RP-4); immutable sinks are
safe against head regressions. Trade-off: a floor poisoned too high (e.g. adopted from
a foreign pipe's state, GAP-7) never self-corrects — monotonicity is deliberate and
absolute. Shapes DEF-6, REQ-5.
