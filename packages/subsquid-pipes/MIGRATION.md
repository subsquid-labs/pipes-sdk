# Migration guide

Step-by-step instructions for updating from the previous release.

---

## 1. Move decoders from `.pipe()` into `outputs`

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
const stream = evmPortalSource({
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
const stream = evmPortalSource({
  portal: 'https://portal.sqd.dev/datasets/base-mainnet',
  outputs: {
    transfers: erc20Transfers({ range }),
    swaps:     uniswapV3Decoder({ range }),
  },
})
```

The `data` shape is unchanged — `data.transfers`, `data.swaps` etc. still work as before.

---

## 2. Add a pipe `id` when calling `.pipeTo()`

Every portal source now accepts an `id`. It must be **globally unique and stable** — targets use it as a cursor key to persist progress. Two pipes that share the same `id` will overwrite each other's cursor. The `id` is also used to scope log lines and Prometheus metric labels.

Calling `.pipeTo()` without an `id` throws `DefaultPipeIdError` (E0001) at startup.

```ts
// before
await evmPortalSource({ portal: '...' })
  .pipe(evmDecoder({ ... }))
  .pipeTo(clickhouseTarget({ ... }))

// after
await evmPortalSource({
  id: 'eth-transfers',     // globally unique, stable ID for cursor persistence
  portal: '...',
  outputs: evmDecoder({ ... }),
}).pipeTo(clickhouseTarget({ ... }))
```

---

## 3. Update Solana sources

`solanaPortalSource` dropped the `query` option and `.pipeComposite()`. Use `outputs` instead.

```ts
// before
const stream = solanaPortalSource({
  portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
}).pipeComposite({
  orcaSwaps: createSolanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
  raydiumSwaps: createSolanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
})

// after
const stream = solanaPortalSource({
  portal: 'https://portal.sqd.dev/datasets/solana-mainnet',
  outputs: {
    orcaSwaps:    solanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
    raydiumSwaps: solanaInstructionDecoder({ range: { from: '340,000,000' }, ... }),
  },
})
```

Note: `createSolanaInstructionDecoder` → `solanaInstructionDecoder` (rename, no alias).

---

## 4. Update custom transformers that read raw portal data

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

## 5. Update custom query builder usage (`.build()`)

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

## 6. Update `MetricsServer` implementations

If you implement or test a custom `MetricsServer`, rename one method:

```ts
// before
server.addBatchContext(ctx)

// after
server.batchProcessed(ctx)
```

---

## 7. Update progress tracker callback types

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

evmPortalSource({
  portal: '...',
  outputs: evmDecoder({ ... }),
  progress: {
    onStart:    (event: StartEvent)    => console.log(`starting from block ${event.state.initial}`),
    onProgress: (event: ProgressEvent) => console.log(`${event.progress.state.current.number}`),
  },
})
```

---

## 8. Rename removed imports

| Before | After | Notes |
|---|---|---|
| `createEvmPortalSource` | `evmPortalSource` | Alias removed |
| `createSolanaPortalSource` | `solanaPortalSource` | Alias removed |
| `createSolanaInstructionDecoder` | `solanaInstructionDecoder` | Renamed, no alias |
| `new EvmQueryBuilder()` | `evmQuery()` | Shorthand factory, old still works |
| `new SolanaQueryBuilder()` | `solanaQuery()` | Shorthand factory, old still works |
| `new HyperliquidFillsQueryBuilder()` | `hyperliquidFillsQuery()` | Shorthand factory, old still works |

---

## 9. Add OpenTelemetry tracing (optional)

If you want to send profiler spans to Jaeger or another OTEL backend, install the optional peer dependency and replace `profiler: true` with `opentelemetryProfiler()`.

```bash
pnpm add @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

```ts
import { NodeSDK } from '@opentelemetry/sdk-node'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http'
import { opentelemetryProfiler } from '@subsquid/pipes/opentelemetry'

// call before any pipe code
const sdk = new NodeSDK({
  serviceName: 'my-pipe',
  traceExporter: new OTLPTraceExporter({ url: 'http://localhost:4318/v1/traces' }),
})
sdk.start()

evmPortalSource({
  portal: '...',
  profiler: opentelemetryProfiler(), // replaces profiler: true
  outputs: evmDecoder({ ... }),
})
```

---

## Quick checklist

- [ ] `.pipe(decoder)` → `outputs: decoder` in `evmPortalSource` / `solanaPortalSource`
- [ ] `.pipeComposite({ ... })` → `outputs: { ... }`
- [ ] Add a globally unique `id` to any source that calls `.pipeTo()`
- [ ] `createSolanaInstructionDecoder` → `solanaInstructionDecoder`
- [ ] Custom transformers: `data.blocks` → `data`
- [ ] Custom `.build({ transform })` → `.build().pipe()`
- [ ] `server.addBatchContext(ctx)` → `server.batchProcessed(ctx)`
- [ ] `StartState` → `StartEvent`, `ProgressState` → `ProgressEvent`
- [ ] `createEvmPortalSource` → `evmPortalSource`
- [ ] `createSolanaPortalSource` → `solanaPortalSource`
