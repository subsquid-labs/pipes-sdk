# ADR-19 — DuckDB segment-writer engine ships outside the SDK

Status: Accepted

## Context

With the engine seam (ADR-18) in place, a DuckDB-backed engine was built and
measured against parquetjs across three benchmark tiers: a micro-bench
(append/publish per engine), a deep bench (fresh process per configuration across
schema shapes, codecs, segment sizes and thread counts), and a full-pipeline offline
replay of 16 production indexer shapes over recorded portal fixtures. Findings: the
duckdb engine's win is native encoding efficiency, not offloading — COPY runs mostly
on the calling JS thread for SNAPPY/GZIP, and only expensive codecs (BROTLI)
measurably parallelize onto DuckDB's workers. Flat schemas roughly halve write-path
main-thread CPU (wide/string schemas gain up to ~6.5× on appends); deeply nested
schemas regress; the motivating BTC-outputs shape measured ~1.7× effective write
throughput. A real but workload-specific win did not justify shipping a native,
platform-built dependency in the SDK.

## Decision

The SDK ships exactly one engine — parquetjs — and stays engine-agnostic behind the
ADR-18 seam. The DuckDB engine is maintained by its consumer (the GFS pipeline's
`@pipeline/core`), implementing the public `ParquetEngine` contract and reusing the
shared segment toolkit, with no SDK involvement. The engine-comparison benchmark
harness, its reports, and the extracted engine source are archived with the consumer
(`sqd/360/google/parquet-engine-benchmarks/`).

## Consequences

The SDK carries no native optional dependency and no duckdb-specific error code
(E2316 retired, number unassigned). The seam is the compatibility contract: changes
to `ParquetEngine`, `SegmentWriter` or the segment toolkit are breaking for external
engines and must be versioned accordingly. DuckDB-specific behaviors
(estimate-based byte rotation, single file-level codec, publish-time JS-thread
stalls) are documented where the engine lives.
