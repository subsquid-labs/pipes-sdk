# Full-pipeline Parquet engine benchmark: 16 real indexers, DuckDB vs @dsnp/parquetjs

**Date:** 2026-07-17 · **Branch:** `worktree-parquet-duckdb-engine`
**Versions:** `@duckdb/node-api 1.5.4-r.1`, `@dsnp/parquetjs 1.8.7`, Node v22.23.1
**Machine:** Apple M2 Pro, 10 cores, 16 GB, macOS/arm64 — ratios are the transferable part; absolute numbers are not prod-representative
**Harness:** `packages/pipes/scripts/bench-pipeline/` (recorder, per-cell runner, matrix driver, aggregator)

Complements the writer-isolated micro-benchmark (`docs/benchmarks/2026-07-16-parquet-engine-deep-bench.md`): this one runs the **whole pipe** — portal data (recorded to SQLite, replayed offline) → decode/map → `parquetTarget` — so the numbers include decoding and show what a real indexer gains end-to-end, not just in the writer.

## Method

- **Fixtures first:** each indexer's block range is recorded once from the live SQD portal into a SQLite portal-cache (`record.ts`); every benchmark cell replays it offline, so both engines and all reps see byte-identical input with zero network variance.
- **One fresh OS process per cell** (indexer × engine × rep), strictly sequential, engines interleaved within each rep (`run-matrix.ts`). Stdout protocol: exactly one JSON metrics line per cell (indexer diagnostics go to stderr).
- **Metrics per cell** (`run-one.ts`): wall s, rows/s (end-to-end), main-thread s (event-loop utilization), process CPU s (includes DuckDB's native threads), max event-loop stall (monitorEventLoopDelay), peak RSS (sampled), files written, output MB. Output correctness is enforced: cells fail on inspection errors, and the registered indexers carry a dual-engine readback E2E.
- **This report's numbers are from a single-rep run** (n=1 per cell; the harness defaults to `--reps 3` medians). Treat small margins (<10%) as noise; the cross-indexer pattern is the finding, and it matches the writer-isolated deep bench.

## The indexers

| Indexer | Chain | Range | Rows | Cols | Nested columns |
|---|---|---|--:|--:|---|
| btc-blocks | Bitcoin | 895000–896999 | 2,000 | 13 | — |
| btc-transactions | Bitcoin | 900000–900099 | 242,087 | 17 | `inputs: LIST<STRUCT>`, `outputs: LIST<STRUCT>` |
| btc-outputs | Bitcoin | 900000–900099 | 667,713 | 11 | `addresses: LIST<UTF8>` |
| btc-inputs | Bitcoin | 900000–900099 | 754,719 | 14 | `addresses: LIST<UTF8>` |
| ethereum-blocks | Ethereum | 21000000–21004999 | 5,000 | 22 | `withdrawals: LIST<STRUCT>` |
| ethereum-transactions | Ethereum | 21000000–21000999 | 214,935 | 22 | `access_list: LIST<STRUCT>` |
| ethereum-logs | Ethereum | 21000000–21000499 | 175,314 | 10 | `topics: LIST<UTF8>` |
| ethereum-receipts | Ethereum | 21000000–21000999 | 214,935 | 14 | — |
| ethereum-traces | Ethereum | 21000000–21000199 | 170,540 | 11 | `trace_address: LIST<INT64>`, `action: STRUCT`, `result: STRUCT` |
| ethereum-token-transfers | Ethereum | 21000000–21000999 | 203,907 | 17 | — (decoded via `evmEventDecoder`, ERC-20/721/1155 registry) |
| ethereum-event-decoder | Ethereum | 21000000–21000499 | 175,314 | 21 | `topics: LIST<UTF8>` (every log decoded via the event registry) |
| polygon-blocks | Polygon | 65000000–65004999 | 5,000 | 21 | `difficulty/total_difficulty: STRUCT`, `uncles: LIST<UTF8>` |
| polygon-transactions | Polygon | 65000000–65000999 | 96,215 | 21 | `access_list: LIST<STRUCT>` + 5 decimal `STRUCT` twins |
| polygon-logs | Polygon | 65000000–65000499 | 243,598 | 10 | `topics: LIST<UTF8>` |
| polygon-receipts | Polygon | 65000000–65000999 | 96,215 | 14 | — |
| polygon-event-decoder | Polygon | 65000000–65000499 | 243,598 | 21 | `topics: LIST<UTF8>` |

## Results (end-to-end, single rep)

| indexer | engine | rows | wall s | rows/s | main-thread s | cpu s | max stall ms | peak RSS MB | file MB |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|
| btc-blocks | parquetjs | 2000 | 1.4 | 1390 | 1.1 | 1.8 | 55 | 450 | 0.5 |
| btc-blocks | duckdb | 2000 | 1.5 | 1303 | 1.2 | 1.8 | 129 | 440 | 0.5 |
| btc-inputs | parquetjs | 754719 | 47.3 | 15968 | 46.7 | 54.0 | 1851 | 832 | 152.1 |
| btc-inputs | duckdb | 754719 | 41.9 | 18018 | 40.6 | 46.9 | 1730 | 1245 | 149.2 |
| btc-outputs | parquetjs | 667713 | 46.5 | 14358 | 46.1 | 51.6 | 3236 | 765 | 97.7 |
| btc-outputs | duckdb | 667713 | 40.4 | 16522 | 39.6 | 44.6 | 3236 | 1147 | 92.8 |
| btc-transactions | parquetjs | 242087 | 107.9 | 2244 | 107.2 | 125.4 | 3567 | 1713 | 233.5 |
| btc-transactions | duckdb | 242087 | 159.6 | 1516 | 156.4 | 141.6 | 8615 | 1108 | 228.6 |
| ethereum-blocks | parquetjs | 5000 | 1.4 | 3461 | 1.1 | 1.6 | 269 | 542 | 6.7 |
| ethereum-blocks | duckdb | 5000 | 1.7 | 2967 | 1.3 | 1.7 | 301 | 561 | 6.5 |
| ethereum-event-decoder | parquetjs | 175314 | 5.8 | 30037 | 5.5 | 7.0 | 547 | 793 | 37.7 |
| ethereum-event-decoder | duckdb | 175314 | 3.5 | 49462 | 3.0 | 3.8 | 365 | 1067 | 32.3 |
| ethereum-logs | parquetjs | 175314 | 2.9 | 59802 | 2.5 | 3.4 | 272 | 519 | 19.7 |
| ethereum-logs | duckdb | 175314 | 2.2 | 81499 | 1.7 | 2.3 | 168 | 771 | 17.4 |
| ethereum-receipts | parquetjs | 214935 | 3.2 | 66179 | 2.9 | 3.6 | 400 | 580 | 26.9 |
| ethereum-receipts | duckdb | 214935 | 1.8 | 121721 | 1.2 | 1.8 | 164 | 701 | 25.6 |
| ethereum-token-transfers | parquetjs | 203907 | 4.5 | 45210 | 4.1 | 5.3 | 322 | 618 | 23.3 |
| ethereum-token-transfers | duckdb | 203907 | 3.0 | 67954 | 2.3 | 3.2 | 198 | 813 | 19.7 |
| ethereum-traces | parquetjs | 170540 | 5.4 | 31805 | 5.0 | 6.1 | 489 | 645 | 21.7 |
| ethereum-traces | duckdb | 170540 | 8.5 | 20011 | 8.0 | 9.0 | 760 | 1024 | 16.6 |
| ethereum-transactions | parquetjs | 214935 | 8.1 | 26392 | 7.7 | 9.3 | 551 | 888 | 74.7 |
| ethereum-transactions | duckdb | 214935 | 4.3 | 49532 | 3.5 | 4.7 | 384 | 1377 | 71.5 |
| polygon-blocks | parquetjs | 5000 | 0.8 | 6324 | 0.5 | 0.8 | 140 | 373 | 5.9 |
| polygon-blocks | duckdb | 5000 | 0.7 | 6730 | 0.4 | 0.7 | 90 | 326 | 5.8 |
| polygon-event-decoder | parquetjs | 243598 | 7.2 | 33739 | 6.8 | 8.4 | 457 | 687 | 34.9 |
| polygon-event-decoder | duckdb | 243598 | 4.6 | 53292 | 3.8 | 4.9 | 336 | 1329 | 26.4 |
| polygon-logs | parquetjs | 243598 | 4.3 | 57023 | 3.9 | 4.9 | 283 | 538 | 27.5 |
| polygon-logs | duckdb | 243598 | 3.2 | 75161 | 2.7 | 3.4 | 210 | 1147 | 24.4 |
| polygon-receipts | parquetjs | 96215 | 1.7 | 57573 | 1.3 | 1.7 | 354 | 451 | 11.5 |
| polygon-receipts | duckdb | 96215 | 1.1 | 84948 | 0.7 | 1.1 | 136 | 443 | 10.1 |
| polygon-transactions | parquetjs | 96215 | 5.9 | 16226 | 5.5 | 7.4 | 690 | 1253 | 67.5 |
| polygon-transactions | duckdb | 96215 | 5.0 | 19418 | 4.2 | 5.4 | 380 | 1018 | 64.4 |

### Speedup summary (duckdb ÷ parquetjs, end-to-end rows/s)

| Indexer | Speedup | | Indexer | Speedup |
|---|--:|---|---|--:|
| ethereum-transactions | **1.88×** | | polygon-transactions | 1.20× |
| ethereum-receipts | **1.84×** | | btc-outputs | 1.15× |
| ethereum-event-decoder | **1.65×** | | btc-inputs | 1.13× |
| polygon-event-decoder | **1.58×** | | polygon-blocks | 1.06× |
| ethereum-token-transfers | **1.50×** | | btc-blocks | 0.94× |
| polygon-receipts | **1.47×** | | ethereum-blocks | 0.86× |
| ethereum-logs | **1.36×** | | btc-transactions | **0.68×** |
| polygon-logs | **1.32×** | | ethereum-traces | **0.63×** |

## Reading the results

- **DuckDB wins 11 of 16 indexers — every flat/tabular one** (transactions, receipts, logs, token transfers, decoded events) by 1.1–1.9×. Main-thread relief exceeds the wall-clock win (ethereum-receipts: 2.30× less main-thread time), total CPU is *lower* too, worst-case event-loop stalls shrink, and output files are consistently slightly smaller.
- **The two nesting-heavy indexers lose**, confirming the writer-isolated deep bench: `btc-transactions` (two `LIST<STRUCT>` collections per row) runs at 0.68× with its worst stall ballooning to 8.6 s (vs 3.6 s), and `ethereum-traces` (`STRUCT` action/result per row) at 0.63×. The cause is the client's per-value JS→native conversion plus a main-thread-busy nested COPY.
- **Nesting volume, not presence, is what matters:** small or usually-empty nested columns (`topics`, `addresses`, `access_list`, Polygon's decimal `STRUCT` twins) don't flip the verdict — polygon-transactions still wins 1.20× with six nested columns. Rows *dominated* by populated nested collections do.
- **Blocks indexers are effectively neutral noise:** 2k–5k rows complete in ~1–2 s wall, dominated by per-run fixed costs.
- **End-to-end margins compress the writer-only margins** (decoding shares the pipeline): btc-outputs measures 1.7× writer-only but 1.15× end-to-end because BTC script decoding dominates its pipeline; write-heavy ethereum-transactions keeps 1.88×.
- **Memory:** duckdb peaks ~200–600 MB higher on most winning cells (staging lives in the shared in-memory instance until COPY).

## Recommendation

Enable `engine: 'duckdb'` per table for flat schemas — the biggest wins are exactly the highest-volume production shapes (EVM transactions, receipts, logs, decoded events). Keep `parquetjs` for tables dominated by populated nested collections (`btc-transactions`-like, `traces`-like) until a batch `appendDataChunk` nested fast-path lands.

## Reproduce

```bash
cd packages/pipes
# 1. Record fixtures (live portal, once):
pnpm tsx scripts/bench-pipeline/record.ts
# 2. Run the matrix (offline replay; defaults: all indexers, both engines, 3 reps):
pnpm tsx scripts/bench-pipeline/run-matrix.ts
# 3. Aggregate to markdown:
pnpm tsx scripts/bench-pipeline/aggregate.ts
```

Single cell: `pnpm tsx scripts/bench-pipeline/run-one.ts --indexer btc-outputs --engine duckdb --rep 1`
