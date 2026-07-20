# ADR-11 — Cache finalized blocks only; append-only, no invalidation

Status: Accepted (historical) — rationale reconstructed by inference

## Context

A local replay cache speeds up iterative pipeline development. Caching arbitrary
responses would require TTLs, reorg invalidation, and version stamps; caching only
finalized (immutable) blocks requires none of these.

## Decision

Cache exactly the finalized prefix of each batch, keyed by query shape (positional
fields excluded) + block interval; serve contiguous cached intervals and fall through
to the portal at the first gap. No TTL, no eviction, no invalidation.

## Consequences

Cache correctness reduces to finality immutability (RS-25) — structurally impossible
to serve reorged data. Accepted costs: unbounded growth (HZ-6, OQ-5), no re-entry
after falling through to live within a run (RS-23), and unfinalized ranges are never
accelerated. Shapes RS-20…RS-25, IB-25.
