# ADR-15 — Class-A sinks: repair stays the author's, its absence is made loud

Status: Accepted — settles who owns class-A repair

## Context

The append-lagged durability class (CN-13) commits data before the cursor; its
exactly-once guarantee exists only if rows above the cursor are removed on recovery
and fork — work RP-42 delegates to an author-supplied repair hook. The reference
binding made that hook optional and its omission silent: divergence (data present above
the cursor, re-delivered on resume; fork cleanup a no-op) with no error — the defect this
ADR resolves.

The delegation is not an oversight — it follows from the binding's design. The
ClickHouse `store` is a thin escape hatch: the author calls `store.insert(anyTable)`
freely inside `onData`, and the binding is deliberately schema-blind. It does not know
which tables were written, exactly as it does not know how to undo them — repair is
delegated to the author for the same reason rollback is. A binding that reconstructed
the table set (by intercepting `store.insert`, or by requiring a tracked-table
declaration) would be fighting that design, acquiring schema knowledge the design
keeps outside it.

So the fix is not to replace the delegation but to stop it failing silently. Mandating
the hook was considered and rejected under this ADR (see below): presence is satisfiable
by `async () => {}`, so a startup check proves nothing about repair happening, and the
hard error is a breaking change for a guarantee it cannot actually enforce.

## Decision

The repair hook stays **delegated and optional** — the binding cannot own class-A
repair without violating its schema-blind design. Its absence is made loud, not silent:

- **Startup warning**, stream-independent. The data-then-cursor write is non-atomic on
  any stream, so an unclean restart re-delivers rows above the cursor as duplicates on a
  `/finalized-stream` pipe just as on the hot stream. The warning fires whenever a
  class-A target has no `onRollback`.
- **Coded fork refusal (E2007)**, hot stream only. A fork requires removing rows above
  the fork point; without a handler that cannot happen, so the binding refuses rather
  than returning an un-rolled-back cursor. Finalized streams never fork, so this cannot
  arise there.

The recovery crash window without a hook is an **accepted, documented deviation** from
REQ-3/CN-13's exactly-once, not an open defect: it is warned, not repaired — the author's
responsibility. This is a conscious choice recorded here, permitted by REQ-3's "per the
sink's durability class" and CN-13's "exactly-once iff RP-42 met", and by Phase 1's
"accepted as documented deviations" exit criterion.

Alternatives considered. *Mandatory hook — coded startup error when absent* (the earlier
form of this ADR): rejected as chosen non-breaking — a `async () => {}` satisfies the
check without repairing, and the hard error breaks every deployment that omitted the
hook. *Binding repairs itself, tracking tables via `store.insert` and persisting the
set*: rejected — it fights the schema-blind design, turning `store.insert` into a schema
interception point the binding is meant not to have. *Require a tracked-table declaration
(as the BigQuery binding has)*: rejected for the same reason — it constrains the free
`store.insert` model the ClickHouse target exists to provide.

## Consequences

RP-42 remains the author's obligation, now surfaced loudly instead of silently: the
warning and E2007 tell an author who omitted the hook that they are exposed, at startup
and at fork respectively. The exactly-once claim in CN-13 still rests on author diligence
on the recovery path — this ADR accepts that as a conscious deviation rather than leaving
it an unresolved gap. IB-20 states the warning and E2007 normatively. CT-2's class-A
kill-point tests (the outstanding coverage, tracked with the other classes) must cover the
no-hook recovery window as a documented deviation, not a pass.
