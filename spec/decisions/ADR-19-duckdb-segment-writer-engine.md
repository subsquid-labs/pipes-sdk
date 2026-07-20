# ADR-19 — DuckDB-backed Parquet segment writer, adopted on benchmark evidence

Status: Accepted

## Context

With the engine seam (ADR-17) in place, a native encoder had to earn adoption with
measurements. Three benchmark tiers ran: a micro-bench (append/publish per engine), a
deep bench (fresh process per configuration across schema shapes, codecs, segment
sizes and thread counts), and a full-pipeline offline replay of 16 production indexer
shapes over recorded portal fixtures
([deep bench](../../docs/benchmarks/2026-07-16-parquet-engine-deep-bench.md),
[pipeline bench](../../docs/benchmarks/2026-07-17-parquet-pipeline-bench.md);
harnesses live in `docs/benchmarks/parquet-engines/`). Findings: the duckdb engine's
win is native encoding efficiency, not offloading — COPY runs mostly on the calling
JS thread for SNAPPY/GZIP, and only expensive codecs (BROTLI) measurably parallelize
onto DuckDB's workers. Flat schemas roughly halve write-path main-thread CPU
(wide/string schemas gain up to ~6.5× on appends); deeply nested schemas regress;
the motivating BTC-outputs shape measured ~1.7× effective write throughput.

## Decision

Ship the duckdb engine as the opt-in second built-in behind the `/duckdb` entry
(ADR-18); parquetjs stays the default. The engine stages rows in an in-memory staging
table on a process-shared DuckDB instance — one instance per distinct
(threads, memory-limit) setting, bounded so the native thread and memory footprint
stays fixed regardless of how many tables or pipes a process runs — and publishes
each segment with a native COPY at the file-level codec, then the shared finalize
tail. Because no growing temp file exists before COPY, byte-based rotation uses a
calibrated bytes-per-row estimate, seeded conservatively and corrected from each
published segment. Per-column compression codecs are rejected at construction (COPY
encodes one codec per file).

## Consequences

An interrupted COPY leaves only a temp file that startup recovery already deletes —
IB-22 state formats and CN-32 fork mechanics are unchanged. Byte rotation is
approximate (it was always a soft, batch-boundary target); common-codec publishes
stall the JS thread in proportion to segment size, so segment sizing gains an
explicit latency trade; deeply nested schemas should stay on parquetjs. The engine
adds an optional native dependency with platform-specific builds.
