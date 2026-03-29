# Migration guide

Step-by-step instructions for updating from the previous release.

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

Every portal stream now requires an `id`. It must be **globally unique and stable** — targets use it as a cursor key to persist progress. Two pipes that share the same `id` will overwrite each other's cursor. The `id` is also used to scope log lines and Prometheus metric labels.

Calling `.pipeTo()` without an `id` throws `DefaultPipeIdError` (E0001) at startup.

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

## Quick checklist

- [ ] `evmPortalSource` → `evmPortalStream`
- [ ] `solanaPortalSource` → `solanaPortalStream`
- [ ] `hyperliquidFillsPortalSource` → `hyperliquidFillsPortalStream`
- [ ] `.pipe(decoder)` → `outputs: decoder`
- [ ] `.pipeComposite({ ... })` → `outputs: { ... }`
- [ ] Add a globally unique `id` to every portal stream
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
