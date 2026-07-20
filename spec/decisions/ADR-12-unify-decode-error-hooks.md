# ADR-12 — Unify decode-error hook semantics across network modules

Status: Proposed

## Context

The two decoder-bearing network modules disagree on what the decode-error hook means
(GAP-1): in one, the hook observes and the failure is always fatal; in the other, a
hook that returns without throwing suppresses the record silently. Same hook shape,
opposite semantics — a conformance suite cannot encode both as intended behavior, and
a second-language implementation must know which to copy.

## Decision (proposed)

Adopt **skip-with-hook** as the single policy: the default hook re-throws (fatal by
default), but a user-supplied hook that returns suppresses the record, which is then
counted in an observable skip metric. Fatal-only modules migrate by keeping their
default; authors who relied on observe-only behavior see no change unless their hook
already swallowed (currently a no-op bug on the fatal module).

## Consequences

WP-23 collapses from "declared per module" to one uniform rule; INV-31 gains a skip
counter; the fatal module's behavior changes for non-throwing hooks (breaking, minor).
Blocked on: OQ-1 ratification.
