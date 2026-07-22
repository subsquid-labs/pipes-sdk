# ADR-18 — Parquet sink: pluggable segment-writer engine seam

Status: Accepted

## Context

Parquet encoding ran on the JS thread via `@dsnp/parquetjs`; production profiles
attributed roughly half of main-thread CPU to it on file-sink workloads. A native
encoder was wanted without duplicating the sink's staging, rotation, checkpointing,
recovery and fork machinery — and review asked that the seam admit any implementation
rather than hardcode two engines. The obstacle was schema translation: engines speak
different native schema and row representations.

## Decision

Introduce a `ParquetEngine` seam that owns exactly one thing: writing finalized
plain-JS rows of a declared table into a Parquet file at a temp path the sink assigns.
The sink keeps owning everything around the writer — staging, finalization buffering,
rotation triggers, coverage tracking, checkpoints, recovery, fork handling, metrics.
No engine-specific schema mechanism: the SDK's engine-neutral declared column model
plus the documented plain-JS row-value contract is the complete input; each engine
translates it to its native representation privately. Capability limits are enforced
by throwing from `engine.table()` at construction.

The seam's invariants are enforced structurally, not by documentation. The sink picks
every temp path and passes it to `createSegment(tmpPath)`; the writer's surface is
`append(rows)` / `size()` / `finish()` / `abort()`, so an engine has no way to name,
rename, fsync or delete files — and no way to see a block number or coverage window,
which only the sink knows (ADR-6 names files for the window the pipe processed, not
row content). Row counts are sink bookkeeping. After `finish()`, the sink verifies
the file's Parquet magic bytes (refusing with `E2320` otherwise) and runs the publish
tail (inverted-range refusal → fsync → collision check → atomic rename → dir fsync)
itself; on the error path the sink deletes the temp file after `abort()`. A segment
may finish with zero rows — tail closing claims a window with a real, schema-only
file — so `finish()` must produce a valid file even if `append` never ran. The
temp-naming and finalize helpers are sink-internal, not exported API. The remaining
non-structural contract is minimal: the bytes an engine writes must be real Parquet
(checked at publication) and rows arrive in the documented plain-JS shape (an input
format, not an honor-system rule).

`settings.engine` takes an engine instance; omitted selects the default parquetjs
engine. The core entry statically imports `@dsnp/parquetjs`, so the module graph —
not a runtime loader — enforces its optional-peer status: importing the entry without
the package installed fails at import time with the runtime's own module-not-found
error. Alternative engines live in their own packages and import their own libraries;
the SDK never references them.

## Consequences

Engines are interchangeable without touching IB-22 state formats or CN-32 fork
mechanics, and naming/publication decisions (ADR-6) bind every engine by construction
— a third-party engine cannot break `.tmp-*` recovery, coverage-window naming or the
durability tail even deliberately, and a non-Parquet output fails at the checkpoint
instead of corrupting a downstream reader. Third-party engines become possible;
engine capability gaps surface at construction — FM-25's fail-at-startup posture —
not mid-run. Batched `append(rows)` keeps per-row `await` overhead out of the seam
for columnar/native engines. The parquetjs default keeps zero-config behavior
unchanged. The public surface shrinks to the three engine types plus `SegmentWriter`
and `PublishedSegment`; the helpers formerly exported for engines to call
(`nextTmpPath`, `finalizeSegmentFile`) are no longer API the SDK must keep stable.
