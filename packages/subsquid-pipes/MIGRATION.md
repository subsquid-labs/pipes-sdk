# Migration guide

Step-by-step instructions for updating from the previous release.

---

## ⚠️ Naming overhaul: hard renames, and one name that changed meaning

The public API naming overhaul renames symbols **without** compatibility aliases — this lands in a major release, so old names simply stop existing and the compiler will point you at each one (`resolveFork`, `canonicalBlocks`, `rollback` hooks, `PortalStream`, `add*Request` builder methods, `evmEventDecoder`, `chunkForInsert`, `contractFactorySqliteStore`, CLI `target` config key, `/preview/transformation`, `sqd_processed_block`/`sqd_end_block`, and friends). Deprecated aliases that existed *before* this overhaul (`evmPortalSource`, `contractFactory`'s `factory`, `factorySqliteDatabase`, `chunk`, `createClickhouseTarget`) are still present and will be removed separately.

**One rename will NOT surface as a compile error — the name changed meaning:**

- Before, `FinalizationBuffer.resolveFork(blocks)` was the **pure** resolver: it returned the safe cursor and did **not** touch the buffer.
- Now, `buffer.resolveFork(blocks)` **resolves and drops** — it also removes every buffered row above the safe cursor (it is the old `buffer.fork()`).
- The old pure behavior lives on under a new name: `buffer.resolveForkCursor(blocks)`.

If you called `resolveFork` to inspect the cursor without mutating (e.g. resolving once and applying `dropAbove` to several sibling buffers yourself), switch those calls to `resolveForkCursor` — the call is no longer side-effect-free, and your code will compile without complaint.

Other silent-at-compile-time changes to check: the ClickHouse `onRollback` callback receives `reason: 'recovery' | 'fork'` instead of `type: 'offset_check' | 'blockchain_fork'`; Prometheus dashboards must move to `sqd_processed_block`/`sqd_end_block`; Pipes UI older than this release reads endpoints/payload keys that no longer exist.

---

## 1. Rename portal sources to portal streams

All portal source functions have been renamed to portal streams. Old names are available as deprecated aliases.

```ts
// before
import { evmPortalSource } from '@subsquid/pipes/evm'
import { solanaPortalSource } from '@subsquid/pipes/solana'
import { hyperliquidFillsPortalSource } from '@subsquid/pipes/hyperliquid'

// after
import { evmPortalStream } from '@subsquid/pipes/evm'
import { solanaPortalStream } from '@subsquid/pipes/solana'
import { hyperliquidFillsPortalStream } from '@subsquid/pipes/hyperliquid'
```

---

## 2. Move decoders from `.pipe()` into `outputs`

This is the most common change. Instead of chaining `.pipe(decoder)` after the source, pass your decoder through the `outputs` option.

### Single decoder

```ts
// before
const stream = evmPortalSource({
  portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
}).pipe(
  evmDecoder({
    range: { from: 'latest' },
    events: { transfers: commonAbis.erc20.events.Transfer },
  }),
)

// after
const stream = evmPortalStream({
  portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  outputs: evmDecoder({
    range: { from: 'latest' },
    events: { transfers: commonAbis.erc20.events.Transfer },
  }),
})
```

### Multiple decoders (was `.pipeComposite()`)

```ts
// before
const stream = evmPortalSource({
  portal: 'https://portal.sqd.dev/datasets/base-mainnet',
}).pipeComposite({
  transfers: erc20Transfers({ range }),
  swaps:     uniswapV3Decoder({ range }),
})

// after
const stream = evmPortalStream({
  portal: 'https://portal.sqd.dev/datasets/base-mainnet',
  outputs: {
    transfers: erc20Transfers({ range }),
    swaps:     uniswapV3Decoder({ range }),
  },
})
```

The `data` shape is unchanged — `data.transfers`, `data.swaps` etc. still work as before.

---

## 3. Add a pipe `id` (now required)

Every portal stream now requires an `id`. It must be **globally unique, stable and non-empty** — targets use it as a cursor key to persist progress (see section 10). Two pipes that share the same `id` will overwrite each other's cursor. The `id` is also used to scope log lines and Prometheus metric labels.

Calling `.pipeTo()` without an `id` throws `DefaultPipeIdError` (E0001) at startup; an empty or blank `id` throws at stream construction.

```ts
// before
await evmPortalSource({ portal: '...' })
  .pipe(evmDecoder({ ... }))
  .pipeTo(clickhouseTarget({ ... }))

// after
await evmPortalStream({
  id: 'eth-transfers',     // globally unique, stable ID for cursor persistence
  portal: '...',
  outputs: evmDecoder({ ... }),
}).pipeTo(clickhouseTarget({ ... }))
```

---

## 4. Rename `factory()` to `contractFactory()`

```ts
// before
import { factory, factorySqliteDatabase } from '@subsquid/pipes/evm'

factory({
  address: '0x1f98...',
  event: factoryAbi.PoolCreated,
  parameter: 'pool',
  database: factorySqliteDatabase({ path: './pools.sqlite' }),
})

// after
import { contractFactory, contractFactoryStore } from '@subsquid/pipes/evm'

contractFactory({
  address: '0x1f98...',
  event: factoryAbi.PoolCreated,
  childAddressField: 'pool',            // renamed from `parameter`
  database: contractFactoryStore({ path: './pools.sqlite' }),
})
```

`childAddressField` also accepts a function for custom extraction logic:

```ts
contractFactory({
  address: '0x1f98...',
  event: factoryAbi.PoolCreated,
  childAddressField: (decoded) => decoded.pool,
  database: contractFactoryStore({ path: './pools.sqlite' }),
})
```

---

## 5. Update Solana sources

`solanaPortalStream` dropped the `query` option and `.pipeComposite()`. Use `outputs` instead.

```ts
// before
const stream = solanaPortalSource({
  portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
}).pipeComposite({
  orcaSwaps: createSolanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
  raydiumSwaps: createSolanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
})

// after
const stream = solanaPortalStream({
  portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
  outputs: {
    orcaSwaps:    solanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
    raydiumSwaps: solanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
  },
})
```

Note: `createSolanaInstructionDecoder` → `solanaInstructionDecoder` (rename, no alias).

---

## 6. Update runner configuration

The runner's `stream` field is now `handler`, and `RunConfig` is now `PipeContext`.

```ts
// before
import { RunConfig, createDevRunner } from '@subsquid/pipes/runtime/node'

async function indexTransfers({ id, params }: RunConfig<{ portal: string }>) { ... }

createDevRunner([
  { id: 'eth', params: { portal: '...' }, stream: indexTransfers },
])

// after
import { PipeContext, createDevRunner } from '@subsquid/pipes/runtime/node'

async function indexTransfers({ id, params }: PipeContext<{ portal: string }>) { ... }

createDevRunner([
  { id: 'eth', params: { portal: '...' }, handler: indexTransfers },
])
```

---

## 7. Update custom transformers that read raw portal data

If you wrote a custom transformer that accesses `data.blocks`, remove the `.blocks` accessor — `data` is now the array directly.

```ts
// before
source.pipe({
  profiler: { name: 'my transformer' },
  transform: (data, ctx) => {
    return data.blocks.map((block) => ({
      number: block.header.number,
      logs:   block.logs ?? [],
    }))
  },
})

// after
source.pipe({
  profiler: { name: 'my transformer' },
  transform: (data, ctx) => {
    return data.map((block) => ({
      number: block.header.number,
      logs:   block.logs ?? [],
    }))
  },
})
```

---

## 8. Update custom query builder usage (`.build()`)

If you use `evmQuery().build(...)` directly (e.g. in a custom decoder), separate the transform from the build call.

```ts
// before
const decoder = evmQuery()
  .addFields(myFields)
  .build({
    setupQuery: ({ query }) => query.merge(extraQuery),
    profiler: { name: 'my-decoder' },
    transform: (data, ctx) => data.blocks.map(decode),
    fork: async (cursor, ctx) => { /* rollback state */ },
  })

// after
const decoder = evmQuery()
  .addFields(myFields)
  .build({ setupQuery: ({ query }) => query.merge(extraQuery) })
  .pipe({
    profiler: { name: 'my-decoder' },
    transform: (data, ctx) => data.map(decode),
    fork: async (cursor, ctx) => { /* rollback state */ },
  })
```

---

## 9. Update progress tracker callback types

```ts
// before
import { StartState, ProgressState } from '@subsquid/pipes'

evmPortalSource({
  portal: '...',
  outputs: evmDecoder({ ... }),
  progress: {
    onStart:    (data: StartState)    => console.log(`starting from block ${data.initial}`),
    onProgress: (data: ProgressState) => console.log(`${data.state.current.number}`),
  },
})

// after
import { StartEvent, ProgressEvent } from '@subsquid/pipes'

evmPortalStream({
  portal: '...',
  outputs: evmDecoder({ ... }),
  progress: {
    onStart:    (event: StartEvent)    => console.log(`starting from block ${event.state.initial}`),
    onProgress: (event: ProgressEvent) => console.log(`${event.progress.state.current.number}`),
  },
})
```

---

## 10. Target cursors are now keyed by the pipe `id`

Previously every target persisted its cursor under the static default key `"stream"`, no matter
which pipe wrote it — two pipes sharing one offset table silently overwrote each other's progress.
Cursors are now keyed by the pipe's `id`. An explicit per-target id still wins and disables
everything described below:

```ts
clickhouseTarget({ settings: { id: 'my-key' } })   // ClickHouse
drizzleTarget({ settings: { state: { id: 'my-key' } } })  // Postgres
bigqueryTarget({ settings: { state: { id: 'my-key' } } }) // BigQuery
parquetTarget({ settings: { id: 'my-key' } })      // Parquet
```

### What happens on the first restart after upgrading

| Target | Behaviour |
|---|---|
| **ClickHouse** | Sync rows left under the legacy `"stream"` key are re-keyed to the pipe `id` automatically (one-time, logged as a warning), and indexing resumes from the migrated cursor. |
| **Postgres (Drizzle)** | Same — the legacy `"stream"` sync rows are re-keyed to the pipe `id` in a single atomic `UPDATE` and indexing resumes from the migrated cursor. |
| **BigQuery** | **No automatic migration.** A deployment with WAL rows under `"stream"` and data in tracked tables refuses to start with `ORPHAN_TRACKED_DATA` (a deliberate guard against silent re-processing). To resume the old cursor, pin the legacy key explicitly: `settings: { state: { id: 'stream' } }`. |
| **Parquet** | **No automatic migration.** The state file moved from `_sqd_parquet_state.json` to `_sqd_parquet_state.<pipe-id>.json`. Rename the file on disk to the new name before restarting — otherwise the pipe restarts from the beginning and fails on colliding parquet file names. (Deployments that already set an explicit `settings.id` were using the suffixed name before and are unaffected.) |

### Several pipes sharing one offset table under the old default

Under the shared `"stream"` key only one cursor ever survived, and it belonged to only **one** of
those pipes. After the upgrade, the first pipe to start consumes the legacy rows — including a
finalized watermark that is monotonic and cannot be lowered afterwards. For such setups:

1. Pin an explicit per-target id on the pipe that should keep the cursor **before** upgrading.
2. Let the other pipes start fresh under their own ids (or backfill them deliberately).
3. Avoid starting the upgraded pipes concurrently on the very first run — the migration itself is
   not serialized on ClickHouse.

Single-pipe deployments (the common case) need no action: the cursor migrates automatically and a
one-time warning is logged.

---

## 11. Rename types

| Before | After |
|---|---|
| `ResultOf<T>` | `OutputOf<T>` |
| `BatchCtx` | `BatchContext` |
| `RunConfig` | `PipeContext` |
| `FactoryOptions` | `ContractFactoryOptions` |

---

## 12. Rename utility functions

| Before | After |
|---|---|
| `chunk` | `batchForInsert` |

---

## 13. Rename removed imports

| Before | After | Notes |
|---|---|---|
| `createEvmPortalSource` | `evmPortalStream` | Alias removed |
| `createSolanaPortalSource` | `solanaPortalStream` | Alias removed |
| `createSolanaInstructionDecoder` | `solanaInstructionDecoder` | Renamed, no alias |
| `new EvmQueryBuilder()` | `evmQuery()` | Shorthand factory, old still works |
| `new SolanaQueryBuilder()` | `solanaQuery()` | Shorthand factory, old still works |
| `new HyperliquidFillsQueryBuilder()` | `hyperliquidFillsQuery()` | Shorthand factory, old still works |

---

## 14. ClickHouse rollbacks are engine-aware

No code changes are required — `onRollback` implementations calling `store.removeAllRows` keep
working. What changes is what happens under the hood, depending on each table's engine:

| Table engine | Behaviour after upgrading |
|---|---|
| `CollapsingMergeTree` family with a `sign` column | Cancel rows (`sign = -1`), netted with a `GROUP BY / sum(sign)` query instead of `SELECT * FINAL` — correct under insert-retry duplicates and fast on large tables. A minmax skip index `_sqd_rollback_idx` on `block_number` is created on first rollback. |
| Any other engine (`MergeTree`, `ReplacingMergeTree`, ...) | Lightweight `DELETE` with a logged warning. Previously cancel rows were inserted blindly, which failed or silently corrupted such tables. Requires ClickHouse ≥ 23.3. **Materialized views on these tables keep the rolled-back data** — switch the table to `CollapsingMergeTree(sign)` if you rely on MVs. |
| `Distributed` | Explicit error — roll back the underlying local table instead. |

Recommended follow-ups:

1. Call `store.ensureRollbackIndex({ table })` in `onStart` for existing large tables — the index is
   built by an async mutation, so creating it eagerly avoids one slow first rollback.
2. If the rolling client cannot read `system.tables` / `system.columns`, rollbacks log a warning and
   fall back to the previous `FINAL`-based cancel-row behavior; grant read access to get the new
   mechanics.

---

## 15. Parquet: rename `TIMESTAMP_MILLIS` to `TIMESTAMP`

The Parquet format spec deprecates the `TIMESTAMP_MILLIS` converted type in favor of the `TIMESTAMP` logical type. The column type is renamed accordingly; the old name still works as a deprecated alias and both write byte-identical files (int64 epoch-ms, readable by every Parquet reader as `TIMESTAMP(isAdjustedToUTC=true, unit=MILLIS)`), so existing data needs no migration.

```ts
// before
schema: { timestamp: { type: 'TIMESTAMP_MILLIS', optional: true } }

// after
schema: { timestamp: { type: 'TIMESTAMP', optional: true } }
```

New column types are also available: `DATE` (int32 days since the Unix epoch), `JSON` (stringified into an annotated BYTE_ARRAY), `STRUCT` (nested groups — insert plain nested objects) and `LIST` (canonical 3-level lists — insert plain arrays):

```ts
schema: {
  blockNumber: { type: 'INT64' },
  day: { type: 'DATE' },
  meta: { type: 'JSON', optional: true },
  user: { type: 'STRUCT', fields: { name: { type: 'UTF8' } } },
  topics: { type: 'LIST', element: { type: 'UTF8' } },
}
```

---

## Quick checklist

- [ ] `evmPortalSource` → `evmPortalStream`
- [ ] `solanaPortalSource` → `solanaPortalStream`
- [ ] `hyperliquidFillsPortalSource` → `hyperliquidFillsPortalStream`
- [ ] `.pipe(decoder)` → `outputs: decoder`
- [ ] `.pipeComposite({ ... })` → `outputs: { ... }`
- [ ] Add a globally unique, non-empty `id` to every portal stream
- [ ] Cursor re-keying: nothing to do for single-pipe ClickHouse/Postgres (auto-migrated); BigQuery: pin `state: { id: 'stream' }` to keep the old cursor; Parquet: rename `_sqd_parquet_state.json` to `_sqd_parquet_state.<pipe-id>.json`
- [ ] Pipes sharing one offset table under the old default: pin explicit per-target ids before upgrading
- [ ] `factory()` → `contractFactory()`
- [ ] `factorySqliteDatabase()` → `contractFactoryStore()`
- [ ] `parameter` → `childAddressField` in factory options
- [ ] `stream` → `handler` in runner config
- [ ] `RunConfig` → `PipeContext`
- [ ] `ResultOf` → `OutputOf`
- [ ] `chunk` → `batchForInsert`
- [ ] `createSolanaInstructionDecoder` → `solanaInstructionDecoder`
- [ ] Custom transformers: `data.blocks` → `data`
- [ ] Custom `.build({ transform })` → `.build().pipe()`
- [ ] `StartState` → `StartEvent`, `ProgressState` → `ProgressEvent`
- [ ] ClickHouse rollbacks: nothing to do for CollapsingMergeTree tables (optionally call `store.ensureRollbackIndex` in `onStart` on large tables); non-collapsing tables now roll back via `DELETE` (needs ClickHouse ≥ 23.3) and their MVs keep rolled-back data
- [ ] Parquet schemas: `TIMESTAMP_MILLIS` → `TIMESTAMP` (deprecated alias still accepted; files unchanged)
