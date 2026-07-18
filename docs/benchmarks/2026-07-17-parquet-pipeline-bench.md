# Full-pipeline Parquet benchmark: DuckDB vs @dsnp/parquetjs

**Measured runtime code:** reviewed base through `c478d4d`, stderr logger commit `858b6c2`, and the matrix launcher patch later committed in `1e669d5`; `dd7c424` is documentation-only and is not measured runtime code
**Date:** 2026-07-17–18 · **Branch:** `worktree-parquet-duckdb-engine`
**Versions:** `@subsquid/pipes 1.0.0-alpha.16`, `@duckdb/node-api 1.5.4-r.1`, `@dsnp/parquetjs 1.8.7`, Node v22.23.1, pnpm 10.17.0
**Machine:** MacBook Pro (Mac14,9), Apple M2 Pro (10 cores: 6 performance + 4 efficiency), 16 GB, macOS 26.1 (Darwin 25.1.0), arm64
**Harness:** `packages/pipes/scripts/bench-pipeline/` · 96 clean timed cells, 0 failures

## Verdict

- DuckDB was more than 5% faster end to end on 11 of 16 pipelines and essentially tied at about 1% (within 1.5%) on `btc-blocks` and `polygon-blocks`. The largest gains were `ethereum-transactions` at **1.92× wall / 2.26× main-thread**, `ethereum-receipts` at **1.79× / 2.19×**, and `polygon-receipts` at **1.60× / 2.01×**.
- The BTC result is mixed and smaller than the isolated-writer result: `btc-inputs` gained **1.12× wall / 1.14× main-thread** and `btc-outputs` gained **1.08× / 1.10×**, while nested `btc-transactions` regressed to **0.94× / 0.96×** and `btc-blocks` was flat.
- Nested shape is a warning, not a universal verdict. DuckDB's clearest loss was the STRUCT-heavy `ethereum-traces` pipeline at **0.62× wall / 0.61× main-thread** (8.8 s vs 5.5 s wall), while the dual-representation STRUCTs in `polygon-transactions` still gained **1.26× / 1.39×**.
- DuckDB used more peak RSS on 11 of 16 pipelines. The largest relative increases were `polygon-event-decoder` (1,216 vs 671 MiB, +81%) and `polygon-logs` (987 vs 561 MiB, +76%); conversely it used less RSS for the two large nested transaction pipelines (`btc-transactions`, 1,421 vs 1,799 MiB; `polygon-transactions`, 966 vs 1,358 MiB). DuckDB produced a smaller file on 15 pipelines and tied `btc-blocks` at the table's 0.1 MiB resolution.
- Median maximum event-loop stall was lower with DuckDB on 13 of 16 pipelines, often materially so for receipts, logs, and event decoding. The exceptions were `btc-blocks` (87 vs 58 ms), `btc-outputs` (3,251 vs 3,127 ms), and especially `ethereum-traces` (846 vs 478 ms). Maxima from three repetitions are directional, not a stall-distribution estimate.

## Method

Each cell replays a recorded Portal fixture through the complete public-SDK path: Portal source, field selection, indexer-specific mapper, and `parquetTarget`. `portalSqliteCache` stores finalized `StreamData` batches, so timed runs are network-free while preserving the finality metadata that drives Parquet flushes. Each `(indexer × engine × repetition)` runs in a fresh OS process; cells are sequential, and engines are interleaved inside each repetition. The table reports medians of three repetitions.

Both engines used SNAPPY compression, the SDK's 100,000-row row-group default, a 128 MiB rollover limit, and identical input fixtures. DuckDB used two threads. Wall time covers replay, transform, and Parquet output. Main-thread time is event-loop active time; CPU is process user + system time; RSS is sampled every 250 ms; stalls come from Node's 10 ms-resolution event-loop delay monitor. Output files are inspected before the temporary cell directory is removed.

The clean timed matrix ran on AC power from 2026-07-17 23:48:06 to 2026-07-18 00:13:16 (UTC-03:00), with no other CPU- or disk-heavy repository work. The aggregator validated exactly 96 records, reps 1–3 for both engines, and identical row counts and ranges for every engine pair. This is a single-host, three-repetition directional benchmark; it does not establish statistical significance or Linux/x86 production performance.

### Recorded fixtures

Cache sizes below are post-process SQLite main-file sizes after WAL checkpointing.

| indexer | Portal block range | recorded rows | cache MiB |
|---|---:|---:|---:|
| btc-blocks | 895,000–896,999 | 2,000 | 0.6 |
| btc-transactions | 900,000–900,099 | 242,087 | 98.3 |
| btc-outputs | 900,000–900,099 | 667,713 | 31.7 |
| btc-inputs | 900,000–900,099 | 754,719 | 74.5 |
| ethereum-blocks | 21,000,000–21,004,999 | 5,000 | 3.9 |
| ethereum-transactions | 21,000,000–21,000,999 | 214,935 | 41.9 |
| ethereum-logs | 21,000,000–21,000,499 | 175,314 | 9.5 |
| ethereum-receipts | 21,000,000–21,000,999 | 214,935 | 15.5 |
| ethereum-traces | 21,000,000–21,000,199 | 170,540 | 9.7 |
| ethereum-token-transfers | 21,000,000–21,000,999 | 203,907 | 13.7 |
| ethereum-event-decoder | 21,000,000–21,000,499 | 175,314 | 10.8 |
| polygon-blocks | 65,000,000–65,004,999 | 5,000 | 3.4 |
| polygon-transactions | 65,000,000–65,000,999 | 96,215 | 29.3 |
| polygon-logs | 65,000,000–65,000,499 | 243,598 | 12.9 |
| polygon-receipts | 65,000,000–65,000,999 | 96,215 | 6.5 |
| polygon-event-decoder | 65,000,000–65,000,499 | 243,598 | 13.9 |

The initial recorder process printed `0.0 MiB` for the two smallest block-only caches because their writes were still represented through SQLite WAL/checkpoint state when size was sampled. After process exit, cache-only replays reported 0.6 MiB and 3.4 MiB with the same nonzero rows; the files measured 638,976 and 3,571,712 bytes respectively.

### Intentional divergences from gfs

1. Mappers emit final parquet-ready values directly (decimal strings for NUMERIC and milliseconds for TIMESTAMP), rather than gfs's two-stage map-then-encode path.
2. The event-decoder registry is a representative subset of exactly 19 canonical signatures, 15 Ethereum address registrations, and 10 Polygon address registrations, not the 219-registration gfs file.
3. `decodeScript` approximates gfs address extraction with `bitcoinjs-lib` payment builders, preserving the same library and per-script attempt class rather than reproducing every gfs classifier detail.
4. The benchmark has no BigQuery, GCS, or validation stages; it measures the Parquet backfill path only.

### Run hygiene and exclusions

The first parity attempt exposed a harness-launch defect: `run-matrix.ts` spawned a bare `pnpm`, but the required Node 22/Corepack environment did not provide a standalone child-process shim. A test-first launcher-only fix changed children to the current Node executable with `--import tsx`; the focused test moved from one expected failure to 41/41 passing. The subsequent clean parity matrix contained exactly 32 validated records.

An initial timed attempt was discarded in full after its line-count gate found 115 records: a separate concurrent external Claude benchmark process had appended an interleaved duplicate prefix through cell 19 to the same results file. No records were trimmed or selected. After confirming that no benchmark process remained, the entire results file was deleted and all 96 cells were rerun with one matrix process through one continuously polled execution session. Only that clean rerun is reported below.

## Results

For the `duckdb vs parquetjs` rows, wall, main-thread, and CPU are `parquetjs / duckdb`, so values above 1 mean DuckDB is faster or uses less time. Throughput is `duckdb / parquetjs`, so values above 1 also favor DuckDB.

| indexer | engine | rows | wall s | rows/s | main-thread s | cpu s | max stall ms | peak RSS MB | file MB |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| btc-blocks | parquetjs | 2000 | 1.4 | 1429 | 1.1 | 1.7 | 58 | 444 | 0.5 |
| btc-blocks | duckdb | 2000 | 1.4 | 1438 | 1.1 | 1.7 | 87 | 471 | 0.5 |
| btc-blocks | duckdb vs parquetjs | — | 1.01× | 1.01× | 1.00× | 1.01× | — | — | — |
| btc-inputs | parquetjs | 754719 | 48.4 | 15595 | 47.8 | 55.3 | 1922 | 704 | 152.1 |
| btc-inputs | duckdb | 754719 | 43.4 | 17401 | 42.0 | 48.0 | 1817 | 987 | 149.2 |
| btc-inputs | duckdb vs parquetjs | — | 1.12× | 1.12× | 1.14× | 1.15× | — | — | — |
| btc-outputs | parquetjs | 667713 | 42.9 | 15550 | 42.5 | 48.9 | 3127 | 733 | 97.7 |
| btc-outputs | duckdb | 667713 | 39.9 | 16728 | 38.8 | 44.2 | 3251 | 1039 | 92.8 |
| btc-outputs | duckdb vs parquetjs | — | 1.08× | 1.08× | 1.10× | 1.11× | — | — | — |
| btc-transactions | parquetjs | 242087 | 103.0 | 2350 | 102.3 | 121.2 | 3299 | 1799 | 233.5 |
| btc-transactions | duckdb | 242087 | 109.7 | 2208 | 107.0 | 119.1 | 3051 | 1421 | 228.6 |
| btc-transactions | duckdb vs parquetjs | — | 0.94× | 0.94× | 0.96× | 1.02× | — | — | — |
| ethereum-blocks | parquetjs | 5000 | 1.4 | 3498 | 1.1 | 1.6 | 335 | 555 | 6.7 |
| ethereum-blocks | duckdb | 5000 | 1.7 | 2992 | 1.3 | 1.7 | 298 | 530 | 6.5 |
| ethereum-blocks | duckdb vs parquetjs | — | 0.86× | 0.86× | 0.83× | 0.97× | — | — | — |
| ethereum-event-decoder | parquetjs | 175314 | 5.9 | 29936 | 5.5 | 7.0 | 572 | 748 | 37.7 |
| ethereum-event-decoder | duckdb | 175314 | 3.7 | 47711 | 3.1 | 3.8 | 366 | 1120 | 32.3 |
| ethereum-event-decoder | duckdb vs parquetjs | — | 1.59× | 1.59× | 1.79× | 1.81× | — | — | — |
| ethereum-logs | parquetjs | 175314 | 3.0 | 58025 | 2.6 | 3.4 | 298 | 506 | 19.7 |
| ethereum-logs | duckdb | 175314 | 2.2 | 78769 | 1.7 | 2.3 | 169 | 686 | 17.4 |
| ethereum-logs | duckdb vs parquetjs | — | 1.36× | 1.36× | 1.51× | 1.49× | — | — | — |
| ethereum-receipts | parquetjs | 214935 | 3.2 | 66505 | 2.9 | 3.5 | 374 | 567 | 26.9 |
| ethereum-receipts | duckdb | 214935 | 1.8 | 119320 | 1.3 | 1.9 | 144 | 658 | 25.6 |
| ethereum-receipts | duckdb vs parquetjs | — | 1.79× | 1.79× | 2.19× | 1.90× | — | — | — |
| ethereum-token-transfers | parquetjs | 203907 | 4.6 | 44565 | 4.2 | 5.4 | 335 | 576 | 23.3 |
| ethereum-token-transfers | duckdb | 203907 | 2.9 | 69776 | 2.4 | 3.3 | 209 | 786 | 19.7 |
| ethereum-token-transfers | duckdb vs parquetjs | — | 1.57× | 1.57× | 1.71× | 1.64× | — | — | — |
| ethereum-traces | parquetjs | 170540 | 5.5 | 30946 | 5.2 | 6.2 | 478 | 656 | 21.7 |
| ethereum-traces | duckdb | 170540 | 8.8 | 19273 | 8.4 | 9.1 | 846 | 1021 | 16.6 |
| ethereum-traces | duckdb vs parquetjs | — | 0.62× | 0.62× | 0.61× | 0.68× | — | — | — |
| ethereum-transactions | parquetjs | 214935 | 8.4 | 25555 | 7.9 | 9.7 | 595 | 907 | 74.7 |
| ethereum-transactions | duckdb | 214935 | 4.4 | 49061 | 3.5 | 4.7 | 354 | 1148 | 71.5 |
| ethereum-transactions | duckdb vs parquetjs | — | 1.92× | 1.92× | 2.26× | 2.05× | — | — | — |
| polygon-blocks | parquetjs | 5000 | 0.8 | 6419 | 0.5 | 0.8 | 140 | 356 | 5.9 |
| polygon-blocks | duckdb | 5000 | 0.8 | 6502 | 0.4 | 0.7 | 88 | 313 | 5.8 |
| polygon-blocks | duckdb vs parquetjs | — | 1.01× | 1.01× | 1.08× | 1.13× | — | — | — |
| polygon-event-decoder | parquetjs | 243598 | 7.2 | 33699 | 6.8 | 8.4 | 471 | 671 | 34.9 |
| polygon-event-decoder | duckdb | 243598 | 4.6 | 52585 | 3.9 | 5.1 | 396 | 1216 | 26.4 |
| polygon-event-decoder | duckdb vs parquetjs | — | 1.56× | 1.56× | 1.76× | 1.64× | — | — | — |
| polygon-logs | parquetjs | 243598 | 4.2 | 57956 | 3.9 | 4.9 | 284 | 561 | 27.5 |
| polygon-logs | duckdb | 243598 | 3.3 | 74134 | 2.7 | 3.5 | 263 | 987 | 24.4 |
| polygon-logs | duckdb vs parquetjs | — | 1.28× | 1.28× | 1.43× | 1.41× | — | — | — |
| polygon-receipts | parquetjs | 96215 | 1.7 | 56133 | 1.4 | 1.8 | 358 | 436 | 11.5 |
| polygon-receipts | duckdb | 96215 | 1.1 | 89630 | 0.7 | 1.0 | 135 | 430 | 10.1 |
| polygon-receipts | duckdb vs parquetjs | — | 1.60× | 1.60× | 2.01× | 1.84× | — | — | — |
| polygon-transactions | parquetjs | 96215 | 6.3 | 15313 | 5.9 | 7.6 | 857 | 1358 | 67.5 |
| polygon-transactions | duckdb | 96215 | 5.0 | 19294 | 4.3 | 5.4 | 377 | 966 | 64.4 |
| polygon-transactions | duckdb vs parquetjs | — | 1.26× | 1.26× | 1.39× | 1.41× | — | — | — |

## Comparison to the isolated-writer benchmark

The isolated-writer benchmark found much larger DuckDB gains on flat and string-heavy schemas (2.6–4.9×) and a 1.7× BTC-output-shaped writer gain, while heavily nested data favored parquetjs by 2.8×. The full pipeline includes replay, decoding, mapping, and target orchestration, so Amdahl's law predicts that non-writer work will dilute writer-only gains; the observed `btc-outputs` 1.08× and `btc-inputs` 1.12× wall gains are below the earlier roughly +25% gfs canary reference. `ethereum-traces` remains directionally consistent with the isolated nested loss, but the mild `btc-transactions` regression and the `polygon-transactions` win show that “contains STRUCT/LIST” alone is not a sufficient crossover rule. Conversely, wide scalar-heavy `ethereum-transactions` retains a large 1.92× full-pipeline wall gain. These comparisons are consistent with the prior mechanisms but do not isolate causality inside these end-to-end runs.

## Reproduce

Start with an absent `scripts/bench-pipeline/.fixtures/results.jsonl`, because the matrix appends durable results.

```bash
cd packages/pipes
mise exec node@22.23.1 -- corepack pnpm tsx scripts/bench-pipeline/record.ts
mise exec node@22.23.1 -- corepack pnpm tsx scripts/bench-pipeline/run-matrix.ts --reps 3
mise exec node@22.23.1 -- corepack pnpm tsx scripts/bench-pipeline/aggregate.ts
```
