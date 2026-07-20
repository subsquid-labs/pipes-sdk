# ADR-14 — Ratify liveness and SLO parameter targets

Status: Proposed

## Context

The spec introduces symbolic liveness bounds and SLO targets (P-STALL-BUDGET-S,
P-FORK-RESOLVE-S, P-STARTUP-S, P-SHUTDOWN-DRAIN-S, P-SLO-BACKFILL-BPS,
P-SLO-COMMIT-P99-MS) with proposed values marked ⚠ in the registry (15). No benchmark
baselines exist in the repository; the proposed numbers are engineering judgment, not
measurements.

## Decision (proposed)

Run the first CT-6 baseline campaign on the reference implementation (scenarios
S1–S6), record results in the SLO table's Baseline column, then fix the ⚠ targets —
adjusting the proposals where baselines contradict them. Also under this ADR: the
P-HEAD-POLL-MS and P-METRICS-PORT review notes, the proposed finite P-BODY-TIMEOUT-MS,
and adding status 529 to P-RETRY-STATUS-SET.

## Consequences

SLOs become regression gates (CT-6); liveness properties (08) become falsifiable with
agreed bounds. Until ratified, CT-4/CT-6 can run but not gate. Blocked on: OQ-4
ratification.
