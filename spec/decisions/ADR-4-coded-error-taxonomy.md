# ADR-4 — Coded, banded error taxonomy as the stable error surface

Status: Accepted (historical)

## Context

Errors were heterogeneous bare exceptions; programs matched on message text, which
rewording broke. The docs site needed one authoritative error reference.

## Decision

Every author-visible error carries a stable `Exxxx` code from banded ranges (E0xxx
configuration, E1xxx fork, E2yxx per sink binding) plus a documentation URL. Codes are
append-only; messages are free to change; matching is on code/type only.

## Consequences

Stable programmatic error handling across versions and languages (REQ-13, INV-31,
IB-50). Obligation: the emitted set must stay in sync with the registry — currently
unenforced by CI (GAP-13), and one defined code is dead (GAP-4).
