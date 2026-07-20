# ADR-13 — The spec lives at the repository root as the language-neutral contract

Status: Proposed

## Context

The project intends multiple implementations (TypeScript today; Rust planned; possibly
Go/Python) behind one behavior and one set of persistent/wire formats, with a shared
dashboard. The contract could live inside the TypeScript package (implying TS owns it),
in a separate spec repository (coordination overhead, drift across repos), or at the
monorepo root.

## Decision (proposed)

The spec suite lives at `spec/` in the repository root. Implementations live beside it
and each MUST pass the CT suite (13) and the format round-trips (IB-20…IB-26, CN-45)
to claim conformance. Conformance fixtures (golden wire/state/scrape files) accumulate
under the spec as they are built (13, Phase 0–2).

## Consequences

One atomic change can update the contract and all implementations; the dashboard
targets the spec's observability binding, not any implementation. REQ-23 becomes
enforceable. Requires ratifying this location and the conformance gate in CI.
