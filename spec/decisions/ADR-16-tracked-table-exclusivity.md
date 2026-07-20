# ADR-16 — Tracked-table exclusivity is declared, not inferred

Status: Proposed

## Context

CN-44's orphan-data guard refuses to start when cursor state is absent but tracked
tables hold data. Written table-wide, it assumes each table belongs to one pipe. The
spec assumes the opposite elsewhere: INV-35 scopes every read, write and deletion to the
bound cursor key, RP-41 leaves co-resident pipes untouched, and NG2 excludes only two
pipes sharing an *id*. Several pipes writing one table is a supported configuration.

The one implementation reads its sync row by key but probes the tracked table without
one, so a second pipe's first run into a populated shared table is refused (GAP-20).
The file binding reaches the same outcome by a different route — data files carry no
pipe id, so two pipes over one directory collide on filename (GAP-35).

The underlying obstacle: absent per-row key attribution, "are these rows mine?" is
unanswerable. Rows generally carry no pipe key.

## Decision (proposed)

Exclusivity becomes a **declaration**, surfaced per binding in IB-27, not something a
sink infers by probing. CN-44 applies only where the tracked tables are declared
exclusive to one cursor key; over shared tables the guard MUST NOT run and the residual
duplication risk on a lost cursor is the operator's.

Alternatives considered. *Add a pipe-key column to every tracked table* — makes the
question decidable, rejected for now: it changes user-owned schemas, breaks existing
deployments, and taxes every write for a guard that fires on operator error. *Drop the
guard to a warning* — rejected: on exclusive tables it prevents silent duplication of
whole history, which is REQ-3's business. *Infer exclusivity from a table having only
one writer observed so far* — rejected as unsound, absence of evidence.

This follows INV-15's existing pattern: the spec requires that a binding's declared
enforcement, or its declared absence, match its IB entry — not that every binding
enforce the same thing.

## Consequences

CN-44 gains a precondition and stops contradicting INV-35. The write-ahead binding's
guard must either become key-scoped or declare the exclusivity it already assumes
(GAP-20). File sinks must namespace data by pipe id or refuse a shared directory with a
coded error rather than a filename collision (GAP-35). Operators gain a knob they can
set wrongly — declaring exclusivity over a shared table is undetectable, and the spec
says so rather than pretending otherwise. Blocked on: OQ-8 ratification.
