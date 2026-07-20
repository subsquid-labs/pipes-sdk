# ADR-1 — Chain integrity is the portal's job, not the pipe's

Status: Accepted (historical)

## Context

A streaming client could re-verify parent-hash linkage of every received block, or
trust the gateway. Verification in the client duplicates work the portal already does,
requires hash access on every chain family, and cannot detect a portal serving a
consistent-but-wrong chain anyway.

## Decision

The pipe sends a parent-hash anchor with each stream request and advances it per block;
the portal validates linkage and signals divergence with a 409 + canonical chain. The
pipe never independently verifies hashes, ordering, or finality assignment.

## Consequences

Simpler, chain-agnostic core; single source of chain truth. The portal is fully trusted
(trust model in 01); portal contract violations must be *detected as inconsistencies*
and halt (WP-41, RP-43, FM-14…FM-16) rather than be repaired. Shapes NG1, NG5, WP-10,
WP-40, IB-3, IB-4.
