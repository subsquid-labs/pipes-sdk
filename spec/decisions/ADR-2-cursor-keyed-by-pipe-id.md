# ADR-2 — Resume cursors are keyed by pipe id, with one-time legacy migration

Status: Accepted (historical)

## Context

Early versions stored every pipe's cursor under one static key (`stream`); two pipes
sharing an offset table silently overwrote each other's progress. Alternatives: keep
the shared default (data loss), or key by pipe id and migrate existing deployments.

## Decision

Cursor state is keyed by the pipe id (explicit sink-level key overrides; ADR-2 keeps
the legacy constant only as a migration source). Bindings holding legacy-keyed state
migrate it to the new key exactly once, observably. Where silent adoption could cause
re-processing (write-ahead and file sinks), the binding refuses instead of migrating.

## Consequences

Multi-pipe stores become safe (INV-35, REQ-11); blank ids must be rejected (WP-3).
Migration introduces a race window that must be closed per binding — one binding still
migrates without a lock (GAP-7). Shapes DEF-9, RP-30…RP-32.
