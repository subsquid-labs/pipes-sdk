# ADR-12 — Unify decode-error hook semantics across network modules

Status: Accepted

## Context

The two decoder-bearing network modules disagreed on what the decode-error hook means:
in one, the hook observed and the failure was always fatal; in the other, a hook that
returned without throwing suppressed the record silently. Same hook shape, opposite
semantics — a conformance suite cannot encode both as intended behavior, and a
second-language implementation must know which to copy.

## Decision

Adopt **skip-with-hook** as the single policy: the default hook re-throws (fatal by
default), but a user-supplied hook that returns suppresses the record, which is then
counted in an observable skip metric. Fatal-only modules migrate by keeping their
default; authors who relied on observe-only behavior see no change unless their hook
already swallowed (currently a no-op bug on the fatal module).

Both decoders now share one `defaultDecodeError` + `recordSuppressedDecode` helper
(`core/decode-error.ts`): the evm decoder's unconditional trailing `throw` is gone, and
suppressions on both increment `sqd_decode_errors_skipped_total{id}`.

## Consequences

WP-23 collapses from "declared per module" to one uniform rule; INV-31 gains a skip
counter; the fatal module's behavior changes for non-throwing hooks (breaking, minor).
Ratification and implementation landed together, closing the earlier per-module
divergence.
