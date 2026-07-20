# ADR-17 — Parquet sink: pluggable segment-writer engine seam

Status: Accepted

## Context

Parquet encoding ran on the JS thread via `@dsnp/parquetjs`; production profiles
attributed roughly half of main-thread CPU to it on file-sink workloads. A native
encoder was wanted without duplicating the sink's staging, rotation, checkpointing,
recovery and fork machinery — and review asked that the seam admit any implementation
rather than hardcode two engines. The obstacle was schema translation: engines speak
different native schema and row representations.

## Decision

Introduce a `ParquetEngine` seam that owns exactly one thing: turning finalized
plain-JS rows of a declared table into a Parquet file on disk. The sink keeps owning
everything around the writer — staging, finalization buffering, rotation triggers,
checkpoints, recovery, fork handling, metrics. No engine-specific schema mechanism:
the SDK's engine-neutral declared column model plus the documented plain-JS row-value
contract is the complete input; each engine translates it to its native representation
privately. Capability limits are enforced by throwing from `engine.table()` at
construction. Every engine stages via the shared temp-naming helper and publishes
through the shared finalize tail (fsync → collision check → atomic rename → dir
fsync), so durability, crash recovery and file naming are engine-invariant.
`settings.engine` takes an engine instance; omitted selects the default parquetjs
engine.

## Consequences

Engines are interchangeable without touching IB-22 state formats or CN-32 fork
mechanics, and naming/publication decisions (ADR-6) bind every engine through the
shared tail. Third-party engines become possible; engine capability gaps surface at
construction — FM-25's fail-at-startup posture — not mid-run. The parquetjs default
keeps zero-config behavior unchanged.
