# ADR-9 — Runtime ABI interpretation over code generation

Status: Accepted (historical)

## Context

EVM decoding traditionally uses a codegen step (typegen) producing typed decoders at
build time. Codegen adds a toolchain step, drifts from source ABIs, and complicates
quick pipelines. The alternative — interpreting standard JSON ABIs at runtime — was
historically slower.

## Decision

Convert standard JSON ABIs (including build-artifact formats) into decoder codecs at
runtime; no codegen step. The codec layer is chosen for decode speed (an order of
magnitude faster than the common generic decoding library, per release notes).

## Consequences

Zero-toolchain onboarding; ABI edge cases (unsupported types) surface at runtime
startup rather than build time and must fail loudly. Typed-decode parity with the old
generated code is a fixture-tested equivalence (CT-5). Shapes DEF-16, WP-21.
