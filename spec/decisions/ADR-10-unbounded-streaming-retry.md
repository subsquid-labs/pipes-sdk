# ADR-10 — Streaming transport retries are unbounded (with mandatory signal)

Status: Accepted (historical) — rationale reconstructed by inference

## Context

The transport client's general default is zero retries. A long-running pipe, however,
should survive portal outages of any length: dying after N retries turns every
extended outage into an operator incident, and the correct N is unknowable. The
alternative — bounded retries with process restart supervision — pushes the same
problem up a level.

## Decision

The streaming path overrides the transport default to effectively unlimited retries
with a capped backoff schedule, honoring server pacing. Liveness is preserved by
signal, not by giving up: while retrying, the stall signal (OB-13) must be
continuously observable (LIV-7).

## Consequences

Pipes ride out arbitrary outages unattended (G5). The signal becomes load-bearing —
unbounded *silent* retry would be an outage in disguise, so INV-32/OB-13 are
non-negotiable companions. A reimplementation defaulting to finite retries diverges
observably on portal outages (conformance-relevant, CT-4). Shapes WP-14,
P-STREAM-RETRY-LIMIT.
