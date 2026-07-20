# ADR-15 — Class-A sinks: the repair hook becomes mandatory

Status: Proposed

## Context

The append-lagged durability class (CN-13) commits data before the cursor; its
exactly-once guarantee exists only if rows above the cursor are removed on recovery
and fork — work delegated to an author-supplied repair hook. The reference binding
makes that hook optional: omitting it silently degrades to divergence (data present
above the cursor, re-delivered on resume; fork cleanup a no-op) with no error (GAP-3).

## Decision (proposed)

A class-A sink configuration without a repair hook is a startup configuration error
(coded, E2xxx band of the binding). Alternative considered: keep it optional but emit
a warning — rejected, because the failure it permits is silent data corruption, which
REQ-3 exists to exclude.

## Consequences

RP-42's "normatively required" note becomes enforced; a breaking change for
deployments that omitted the hook (they were silently incorrect); CT-2's class-A
kill-point tests become unconditional. Blocked on: OQ-3 ratification.
