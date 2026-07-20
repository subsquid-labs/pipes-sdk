# ADR-7 — ClickHouse rollback via engine-aware sign-netting

Status: Accepted (historical)

## Context

The original rollback read rows back with `SELECT * FINAL` (full-table scan) and
inserted cancel rows blindly: wrong under insert-retry duplicates (double-cancel),
corrupting or failing on non-collapsing engines, and slow on large tables.
Alternatives considered: keep the FINAL read-back (rejected: slow + non-idempotent);
one mechanism for all engines (rejected: unsafe outside the collapsing family).

## Decision

Dispatch on engine family: Collapsing-family tables get net-cancel rows computed by a
`sum(sign)` grouping (idempotent — re-running a rollback is a no-op; correct under
retry duplicates; propagates through materialized views); other engines get a
lightweight DELETE with an explicit warning that materialized views retain rolled-back
rows; `Distributed` tables are refused. A minmax skip index on the block-number column
is auto-created so rollback pruning is independent of the table's ORDER BY.

## Consequences

Rollback is correct, idempotent, and fast on large tables for the supported family;
unsupported shapes fail loudly at startup instead of corrupting (FM-25). Insert-level
settings (dedup off, pre-merge collapse off) become load-bearing and part of the
binding (IB-20). Shapes CN-33, WP-46.
