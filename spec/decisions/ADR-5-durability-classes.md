# ADR-5 — Per-sink durability classes instead of one commit protocol

Status: Accepted (historical) — rationale partly reconstructed by inference

## Context

Sink stores differ fundamentally in what they can promise: relational stores offer
multi-statement transactions; append-only warehouses offer stream offsets with server
dedupe; immutable files offer atomic rename; columnar append stores offer none of
these. Forcing one commit protocol (e.g. transactional) would exclude most stores;
forcing the weakest would waste the stronger guarantees.

## Decision

The contract defines four durability classes — T (transactional), W (write-ahead),
K (checkpointed-immutable), A (append-lagged) — each with its own commit protocol,
crash window, and recovery obligation, all converging to the same observable
guarantee: effective exactly-once after recovery (REQ-3).

## Consequences

Each store gets the strongest protocol it supports; conformance tests are class-
parameterized (CT-2 kill-point matrix per class). Cost: four recovery paths to verify
instead of one, and class A delegates repair to author code — the weakest link, its
absence made loud (ADR-15). Shapes CN-10…CN-14, 05, 06.
