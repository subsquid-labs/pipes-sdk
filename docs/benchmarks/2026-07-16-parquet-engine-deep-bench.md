# Parquet engine deep benchmark: DuckDB vs @dsnp/parquetjs

**Date:** 2026-07-16 · **Branch:** `worktree-parquet-duckdb-engine` @ `cce25b6`
**Versions:** `@duckdb/node-api 1.5.4-r.1`, `@dsnp/parquetjs 1.8.7`, Node v23.9.0
**Machine:** Apple M2 Pro, 10 cores, 16 GB, macOS/arm64 — *directional for the Linux x86 prod hosts, not authoritative*
**Harness:** `docs/benchmarks/parquet-engines/bench-parquet-deep.ts` (fresh process per configuration; 240 samples, 0 errors)

---

## Verdict

**The DuckDB engine is genuinely superior for flat, wide, and string-heavy schemas — including the BTC workload that motivated it. It is decisively *inferior* for heavily nested schemas, and it wins for a different reason than the docs claim.**

| Condition | Winner | Margin (effective throughput) |
|---|---|---|
| Flat scalar schemas (narrow or wide) | **duckdb** | 2.6–4.9× |
| String-heavy schemas | **duckdb** | 3.0× |
| BTC-outputs shape (scalars + one small LIST) | **duckdb** | 1.7× |
| GZIP compression | **duckdb** | 1.7× |
| BROTLI compression | **duckdb** | 7× (parquetjs is effectively unusable: 9k rows/s, ~1 s event-loop stalls) |
| Tiny segments (1k rows) | **duckdb** | 1.9× (both engines crater; fs fixed costs dominate) |
| Very large segments (500k rows) | **duckdb** | 1.24× (margin narrows; see publish stall) |
| **Heavily nested schemas** (LIST\<STRUCT\>, LIST\<LIST\>, JSON-dominated rows) | **parquetjs** | **2.8× (duckdb loses on every metric except file size)** |
| Constrained memory | **parquetjs** | duckdb peaks 1.4–3.5× higher RSS |
| Uniform rotation-stall sensitivity (tip-following) | **parquetjs** | duckdb pays one hard 0.1–0.7 s event-loop stall per rotation |

Three claims from the feature's own documentation need honest correction:

1. **"Encoding/compression moves onto DuckDB worker threads" — mostly false in practice.** Direct measurement shows the `COPY` executes almost entirely **on the calling JS thread** for SNAPPY/GZIP (500k-row COPY: 692 ms wall, 692 ms main-thread-busy, ~0 idle). Only expensive compression (BROTLI) genuinely parallelizes onto DuckDB's workers (publish 1.34 s wall with just 91 ms main-thread busy, and ~2.5 s of measured off-main CPU). The engine's advantage on common codecs is **native code being ~2× more efficient than JS**, not offloading.
2. **"Roughly halving main-thread CPU"** — accurate for the BTC shape (−41%), understated for wide/string schemas (−77…−83%), and **inverted for nested schemas (+180%)**.
3. **Thread count is irrelevant for cheap codecs** (threads=1 ≈ threads=4 within noise at 100k-row segments) — the win does *not* depend on spare cores. It would matter for BROTLI.

---

## Method

- One **fresh process per configuration** (engine × schema × rows × codec × threads), 2 replicas each, 2–6 segments per process. Segment 0 is discarded as cold; tables report warm medians with min–max ranges. This eliminates the cross-engine warmup/ordering bias the earlier single-process micro-bench (`bench-parquet.ts`) had.
- **Fair input contracts:** parquetjs receives `buildRowWrapper`-wrapped rows (as `ParquetStore` does in production); duckdb receives plain rows. Same frozen 10k-row pool, same generator, same `rowGroupSize` (100 000, the SDK default), same codec both sides.
- **Metrics:** wall-clock per phase; append rows/s; *effective* rows/s (append + publish, what a backfill sustains); **main-thread occupancy** via `perf_hooks` event-loop utilization (active ms — the honest "does it free the JS thread" metric); process CPU (includes DuckDB's native threads); worst single `appendRow` stall; stalls >10 ms; file size; peak RSS.
- **Runs:** 240 segment samples across 48 processes, all sequential (no parallel contamination), ~4 min total, 0 errors.

### Known limitations (read before quoting numbers)

- **Pooled rows inflate compression/file-size results.** Cycling a 10k-row pool makes dictionary encoding unrealistically effective, mostly benefiting duckdb's file sizes (e.g. UNCOMPRESSED 12.66 MB vs 1.36 MB is *not* a real-world ratio). The committed `bench-parquet.ts` with 200k **unique** rows measured 3.1 MiB vs 2.3 MiB — **~1.35× smaller is the honest file-size expectation**, and duckdb's COPY times here are likely flattered by ~1.3–1.5× for the same reason (unique-row publish at 200k measured 0.26–0.31 s there vs an extrapolated ~0.2 s here).
- **Apple Silicon/macOS ≠ prod Linux x86.** Ratios are more trustworthy than absolute numbers. The gfs CPU-profile repro remains the authoritative proof.
- The writer is measured **in isolation** — no portal decoding competing for the main thread. Main-thread-ms is the transferable metric.
- Measured loop overhead (2 × `performance.now()` per row) is included identically for both engines.
- Variance is real (GC, thermal, memory pressure): duckdb `wide_flat` had one warm sample at 167k rows/s vs a 404k median; nested duckdb publish ranged 2.7–7.4 s across runs. Ranges are shown; medians are quoted.

---

## T1 — Schema sweep (100k rows/segment, SNAPPY, duckdb threads=2, warm medians)

| Schema | Engine | Append rows/s | Effective rows/s | Main-thread ms/100k | CPU ms/100k | Stalls >10ms /seg | File MB | Peak RSS MB |
|---|---|---|---|---|---|---|---|---|
| flat_narrow | parquetjs | 576k (485–688k) | 539k | 178 | 189 | 0 | 0.44 | 161 |
| flat_narrow | **duckdb** | **1.68M** (1.43–2.16M) | **1.38M** | **62** | **67** | 0 | 0.24 | 155 |
| btc_outputs | parquetjs | 171k (121–193k) | 162k | 594 | 622 | 1–10 (≤22 ms) | 1.56 | 244 |
| btc_outputs | **duckdb** | **394k** (366–404k) | **277k** | **352** | **381** | 0–2 (≤13 ms) | 0.51 | 339 |
| wide_flat (25 cols) | parquetjs | 62k (59–67k) | 62k | 1 604 | 1 773 | 13 (≤83 ms) | 6.27 | 475 |
| wide_flat | **duckdb** | **404k** (168–413k) | **302k** | **275** | **335** | 0–1 | 2.84 | 346 |
| string_heavy | parquetjs | 182k (158–195k) | 178k | 551 | 617 | 13 (≤31 ms) | 4.32 | 303 |
| string_heavy | **duckdb** | **906k** (674–984k) | **533k** | **128** | **190** | 0 | 1.17 | 423 |
| **nested_heavy** | **parquetjs** | **45k** (40–49k) | **45k** | **2 207** | **2 292** | 13 (≤109 ms) | 4.69 | 572 |
| nested_heavy | duckdb | 28k (26–30k) | 16k | 6 176 | 5 830 | 56 (≤57 ms) + 2.7–7.4 s publish | 2.63 | **1 460** |

The wider/stringier the rows, the bigger duckdb's win (up to 6.5× append on 25 scalar columns — parquetjs's per-cell JS shredding collapses). Nested is the hard counterexample: duckdb pays per-value JS wrapper-tree construction (`listValue`/`structValue` → recursive `createValue` N-API conversion) on append **and** a multi-second, main-thread-busy nested COPY on publish.

## T2 — Segment size (btc_outputs, SNAPPY)

| Rows/segment | Engine | Effective rows/s | Publish ms | Main-thread ms/100k |
|---|---|---|---|---|
| 1 000 | parquetjs | 48k | 16 | 1 415 |
| 1 000 | **duckdb** | **90k** | **8** | **350** |
| 10 000 | parquetjs | 136k | 20 | 654 |
| 10 000 | **duckdb** | **238k** | 19 | **354** |
| 100 000 | parquetjs | 162k | 25 | 594 |
| 100 000 | **duckdb** | **277k** | 101 | **352** |
| 500 000 | parquetjs | 210k | 17 | 475 |
| 500 000 | **duckdb** | **261k** | **534** | **382** |

duckdb wins at every size (no small-segment crossover — COPY fixed costs are tiny). But its **publish wall grows linearly with staged rows** while parquetjs's publish stays ~20 ms because parquetjs already paid encoding incrementally during append (observed as ~13 encode slices per 100k rows). The duckdb margin therefore narrows as segments grow: 1.9× → 1.24× from 1k to 500k rows.

## T3 — Codec sweep (btc_outputs, 100k rows)

| Codec | Engine | Append rows/s | Effective rows/s | Main-thread ms/100k | Max stall |
|---|---|---|---|---|---|
| UNCOMPRESSED | parquetjs | 204k | 200k | 489 | 33 ms |
| UNCOMPRESSED | **duckdb** | **408k** | **286k** | **339** | 12 ms |
| SNAPPY | parquetjs | 171k | 162k | 594 | 22 ms |
| SNAPPY | **duckdb** | **394k** | **277k** | **352** | 13 ms |
| GZIP | parquetjs | 177k | 173k | 566 | 16 ms |
| GZIP | **duckdb** | **397k** | **285k** | **343** | 10 ms |
| BROTLI | parquetjs | **9k** | 9k | **11 143** | **~1 000 ms** |
| BROTLI | **duckdb** | **397k** | **63k** | **343** | 10 ms |

duckdb's append rate is **codec-invariant** (~394–408k — staging defers all encoding); parquetjs pays compression inline. GZIP is fine on both (Node's zlib is native). **BROTLI on parquetjs is catastrophic** (zlib brotli at quality 11 on the main thread: 44× slower appends, one-second stalls); duckdb makes brotli practical — and it is the one case where compression measurably runs on DuckDB's worker threads (publish 1 336 ms wall, only 91 ms main-thread-busy, ~2.5 s off-main CPU). Note the two engines use different brotli quality defaults, so their file sizes aren't directly comparable.

## T4 — DuckDB thread sensitivity (btc_outputs, 100k, SNAPPY)

| threads | Append rows/s | Effective rows/s | Publish ms (main-thread-busy) |
|---|---|---|---|
| 1 | 381k | 270k | 103 (94) |
| 2 (default) | 394k | 277k | 101 (92) |
| 4 | 395k | 282k | 105 (98) |

Within noise. For cheap codecs the win comes from the appender/COPY native path itself, executed on the calling thread — **it does not depend on spare cores**, which matters on the contended prod host (~18 containers / 16 cores). Expect threads to matter only for expensive codecs (BROTLI) and possibly for very large row groups.

## T5 — Publish-path decomposition (probe, isolated steps)

| Step | btc 100k | btc 500k | nested 100k |
|---|---|---|---|
| append (staging) | 224 ms busy | 1 331 ms busy | 4 287 ms busy |
| `flushSync` | 9 ms | 18 ms | 44 ms |
| **`COPY` (SNAPPY)** | **98 ms busy, 0 idle** | **692 ms busy, 0 idle** | **2 599 ms busy, 0 idle** |
| `DROP TABLE` | <1 ms | 2 ms | 6 ms |

A forced-GC control (`BENCH_GC=1`, `--expose-gc`) collected only 10–40 ms between phases and did not remove the publish busy time — **the COPY itself occupies the main thread**; it is not GC debt. Consequences:

- Every duckdb segment rotation is **one hard event-loop stall ≈ the COPY duration**: ~0.1 s per 100k rows, ~0.7 s at 500k (SNAPPY, this machine; unique-row data likely ~1.3–1.5× slower). parquetjs instead distributes ~13 stalls of 15–80 ms per 100k rows through append.
- Between rotations, duckdb appends are near-perfectly smooth (0 stalls >10 ms on flat/wide/string schemas) — the better behavior for keeping a pipe's decode loop responsive *most* of the time.
- Sizing `rollover.maxBytes` under duckdb now has an explicit latency trade: bigger segments = fewer but longer main-thread stalls.

## Memory

duckdb peak RSS exceeds parquetjs by 1.4–3.5×: 339 vs 244 MB (btc 100k), 914 vs 260 MB (btc 500k), 1 460 vs 572 MB (nested 100k). The staging table lives in the shared in-memory instance until COPY + DROP. The 2 GB default `memoryLimit` bounds the instance, but **container memory budgets must account for roughly +0.5–1 GB at large segment sizes** relative to the parquetjs baseline.

Fixed costs are negligible in production: ~110 ms one-time instance setup per process; cold first segments run 1.1–1.9× the warm time.

---

## What this means for the gfs BTC rollout

- The motivating table shapes (outputs/inputs/transactions ≈ `btc_outputs`) sit squarely in duckdb's winning region: **~1.7× effective write throughput, ~41% less main-thread time in the write path, smoother appends** (pool-caveat: expect the effective-throughput edge closer to ~1.5× on unique data).
- With the production profile attributing ~50% of main-thread CPU to parquet writing, a 41% write-path reduction predicts **~20% less total main-thread CPU → roughly +25% end-to-end throughput if main-thread-bound** — a solid win, but set canary expectations at +20–30%, not 2×. (The 2× figure applies to the write path itself, and more for wide/string tables.)
- Watch two things in the canary: **rotation stalls** (COPY bursts at segment boundaries — check portal-stream backpressure behavior) and **container RSS** (+0.5–1 GB at large segments).
- **Do not enable duckdb for heavily nested tables** — schemas dominated by LIST\<STRUCT\>/LIST\<LIST\>/JSON columns are 2–3× *worse* under duckdb today. BTC's small `addresses` list is fine; five-element struct-lists per row are not. The boundary sits between "one small list column" and "several nested columns per row".

## Follow-up opportunities (out of scope here)

1. **Docs correction:** `ParquetSettings.engine` JSDoc says encoding moves "onto DuckDB worker threads" — true only for expensive codecs; the general win is native-encode efficiency. Worth rewording before release.
2. **Nested fast path:** the client's per-value `createValue` conversion is the nested bottleneck; batch `appendDataChunk` vectors (already noted as a deferred optimization in the plan) could flip the nested verdict.
3. **Rotation stall mitigation:** if COPY stalls prove problematic at the tip, investigate chunked COPY or accepting smaller `maxBytes` under duckdb.
4. BROTLI + duckdb is a genuinely new capability (viable high-ratio archival output) — consider exposing it as a recommended archival profile.

## Reproduce

```bash
cd packages/pipes
# single cell:
pnpm tsx ../../docs/benchmarks/parquet-engines/bench-parquet-deep.ts --engine duckdb --schema btc_outputs \
  --rows 100000 --codec SNAPPY --threads 2 --segments 4 --rep 1
# GC-decomposition mode:
BENCH_GC=1 NODE_OPTIONS=--expose-gc pnpm tsx ../../docs/benchmarks/parquet-engines/bench-parquet-deep.ts ...
```

Full matrix driver + aggregator + probe preserved in the session scratchpad (`deep-bench/run.sh`, `aggregate.mjs`, `probe-publish.mts`); raw data: `results.jsonl` (240 samples).
