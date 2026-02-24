# Changelog

## Pipes SDK 1.0

### Breaking changes

#### Decoders are now passed via `outputs`, not chained with `.pipe()`

`evmPortalSource` and `solanaPortalSource` no longer expose `.pipe()` / `.pipeComposite()` on the source level. Pass your decoder(s) directly through the new `outputs` option.

```ts
// before
evmPortalSource({ portal: '...' })
  .pipe(evmDecoder({ range: { from: 'latest' }, events: { transfers: erc20.Transfer } }))

// after
evmPortalSource({
  portal: '...',
  outputs: evmDecoder({ range: { from: 'latest' }, events: { transfers: erc20.Transfer } }),
})
```

Multiple decoders (previously `.pipeComposite()`) are now a named record on `outputs`:

```ts
// before
evmPortalSource({ portal: '...' })
  .pipeComposite({
    transfers: erc20Transfers({ range }),
    swaps:     uniswapV3Decoder({ range }),
  })

// after
evmPortalSource({
  portal: '...',
  outputs: {
    transfers: erc20Transfers({ range }),
    swaps:     uniswapV3Decoder({ range }),
  },
})
```

The same change applies to `solanaPortalSource`.

#### `EvmPortalData` / `SolanaPortalData` are now plain arrays

The `.blocks` wrapper has been removed. This only affects custom transformers or code that reads raw portal data directly without a decoder.

```ts
// before — data had a .blocks wrapper
const transformer = query.build({
  transform: (data) => data.blocks.map(decode),
})

for await (const { data } of rawStream) {
  data.blocks // evm.Block<F>[]
}

// after — data is the array
const transformer = query.build().pipe((data) => data.map(decode))

for await (const { data } of rawStream) {
  data // evm.Block<F>[]
}
```

#### Pipe `id` is required when calling `.pipeTo()`

Targets persist cursor state keyed by pipe ID. Calling `.pipeTo()` without setting an `id` throws `DefaultPipeIdError` (E0001) at startup.

```ts
// before — id was optional
evmPortalSource({ portal: '...' })
  .pipe(evmDecoder({ ... }))
  .pipeTo(myTarget)

// after — id is required
evmPortalSource({ id: 'my-pipe', portal: '...', outputs: evmDecoder({ ... }) })
  .pipeTo(myTarget)
```

#### `solanaPortalSource` `query` option removed, `outputs` required

```ts
// before
solanaPortalSource({ portal: '...', query: { from: '340,000,000' } })
  .pipeComposite({
    swaps: createSolanaInstructionDecoder({ ... }),
  })

// after
solanaPortalSource({
  portal: '...',
  outputs: {
    swaps: solanaInstructionDecoder({ ... }),
  },
})
```

#### `createSolanaInstructionDecoder` renamed to `solanaInstructionDecoder`

The `create` prefix has been dropped. The old export is removed with no deprecation alias.

```ts
// before
import { createSolanaInstructionDecoder } from '@subsquid/pipes/solana'

// after
import { solanaInstructionDecoder } from '@subsquid/pipes/solana'
```

#### `MetricsServer` interface changes

`addBatchContext` was renamed to `batchProcessed`.

```ts
// before
server.addBatchContext(ctx)

// after
server.batchProcessed(ctx)
```

#### Progress tracker event types renamed and restructured

| Before | After |
|---|---|
| `StartState` | `StartEvent` |
| `ProgressState` | `ProgressEvent` |

`ProgressEvent` data is nested under a `.progress` key. Both types now include a `logger` field.

```ts
// before
evmPortalSource({
  progress: {
    onStart:    (s: StartState)    => console.log(s.initial),
    onProgress: (s: ProgressState) => console.log(s.state.current),
  },
})

// after
evmPortalSource({
  progress: {
    onStart:    (e: StartEvent)    => console.log(e.state.initial),
    onProgress: (e: ProgressEvent) => console.log(e.progress.state.current),
  },
})
```

---

### New features

#### Time-based ranges

Ranges now accept ISO date strings and `Date` objects in addition to block numbers. Dates are automatically resolved to the corresponding block numbers via the portal API.

```ts
evmPortalSource({
  portal: '...',
  outputs: evmDecoder({
    range: { from: '2024-01-01' },              // date string
    events: { transfers: erc20.events.Transfer },
  }),
})

// Date objects work too
evmDecoder({
  range: {
    from: new Date('2024-01-01T00:00:00Z'),
    to:   new Date('2024-02-01T00:00:00Z'),
  },
  events: { ... },
})
```

Supported `from` / `to` formats:

| Format | Example |
|---|---|
| Block number | `18908900` |
| Formatted block number | `'1,000,000'` or `'1_000_000'` |
| ISO date string | `'2024-01-01'` or `'2024-01-01T00:00:00Z'` |
| `Date` object | `new Date('2024-01-01')` |
| Latest block | `'latest'` (only `from`) |

Date-only strings (e.g. `'2024-01-01'`) are treated as UTC midnight. Identical timestamps across multiple ranges are deduplicated into a single portal API call.

#### Multiple named outputs in a single source

```ts
const stream = evmPortalSource({
  portal: '...',
  outputs: {
    transfers: evmDecoder({ events: { Transfer: erc20.events.Transfer } }),
    approvals:  evmDecoder({ events: { Approval: erc20.events.Approval } }),
  },
})

for await (const { data } of stream) {
  data.transfers // Transfer[]
  data.approvals // Approval[]
}
```

#### Typed error system with documentation links

All framework errors extend `PipeError` and carry a unique code linking to the docs (`https://docs.sqd.dev/errors/<code>`).

| Error | Code | Thrown when |
|---|---|---|
| `DefaultPipeIdError` | E0001 | `.pipeTo()` called without a pipe `id` |
| `TargetForkNotSupportedError` | E1001 | Fork detected but target has no `fork()` method |
| `ForkNoPreviousBlocksError` | E1002 | Fork exception carried no previous blocks |
| `ForkCursorMissingError` | E1003 | Target `fork()` returned `null` |

#### OpenTelemetry integration — `@subsquid/pipes/opentelemetry`

Export profiler spans to Jaeger, Tempo, or any OTEL-compatible backend:

```ts
import { opentelemetryProfiler } from '@subsquid/pipes/opentelemetry'

evmPortalSource({
  portal: '...',
  profiler: opentelemetryProfiler(), // drop-in for profiler: true
  outputs: evmDecoder({ ... }),
})
```

Requires `@opentelemetry/api` (optional peer dependency) plus an OTEL SDK in the app.

#### `SpanHooks` — pluggable profiler backend

Implement `SpanHooks` to bridge the internal profiler to any tracing system:

```ts
import type { SpanHooks } from '@subsquid/pipes'

const myHooks: SpanHooks = {
  onStart(name) { /* start span, return child hooks */ return myHooks },
  onEnd()       { /* end span */ },
}

evmPortalSource({ profiler: myHooks, ... })
```

#### `profiler` option on all portal sources

`evmPortalSource`, `solanaPortalSource`, and `hyperliquidFillsPortalSource` now all accept `profiler?: boolean | SpanHooks`.

#### Pipe `id` on all portal sources

```ts
evmPortalSource({ id: 'transfers', portal: '...', outputs: evmDecoder({ ... }) })
```

#### Query builder factory shorthands

Every query builder now has a matching factory function:

```ts
// before
import { EvmQueryBuilder } from '@subsquid/pipes/evm'
import { SolanaQueryBuilder } from '@subsquid/pipes/solana'
import { HyperliquidFillsQueryBuilder } from '@subsquid/pipes/hyperliquid'

new EvmQueryBuilder()
new SolanaQueryBuilder()
new HyperliquidFillsQueryBuilder()

// after
import { evmQuery } from '@subsquid/pipes/evm'
import { solanaQuery } from '@subsquid/pipes/solana'
import { hyperliquidFillsQuery } from '@subsquid/pipes/hyperliquid'

evmQuery()
solanaQuery()
hyperliquidFillsQuery()
```

#### Runner — multi-pipe management (local development only)

```ts
import { createDevRunner } from '@subsquid/pipes/runtime/node'

const runner = createDevRunner(
  [
    {
      id: 'transfers',
      params: { portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet' },
      stream: async ({ id, params, logger, metrics }) => {
        const stream = evmPortalSource({ id, portal: params.portal, outputs: evmDecoder({ ... }) })
        for await (const { data } of stream) { /* ... */ }
      },
    },
  ],
  { retry: 5, metrics: { port: 9090 } },
)

await runner.start()
```

#### New Prometheus metrics

The following metrics are now collected automatically for every source:

| Metric | Type | Description |
|---|---|---|
| `sqd_current_block{id}` | gauge | Current block number being processed |
| `sqd_last_block{id}` | gauge | Last known block number in the chain |
| `sqd_progress_ratio{id}` | gauge | Indexing progress as a ratio from 0 to 1 |
| `sqd_eta_seconds{id}` | gauge | Estimated time to full sync in seconds |
| `sqd_blocks_per_second{id}` | gauge | Block processing speed |
| `sqd_bytes_downloaded_total{id}` | counter | Total bytes downloaded from portal |
| `sqd_forks_total{id}` | counter | Chain reorganizations detected |
| `sqd_portal_requests_total{id, classification, status}` | counter | HTTP requests to the portal by status code |
| `sqd_batch_size_blocks{id}` | histogram | Number of blocks per batch |
| `sqd_batch_size_bytes{id}` | histogram | Size of each batch in bytes |

All metrics are labelled with the pipe `id`.

#### Logger now shows pipe ID

`createDefaultLogger` accepts an `id` that is rendered as a dim prefix in every log line when `LOG_PRETTY` is enabled.

---

### Removals

- `CompositeTransformer` / `compositeTransformer` / `composite-transformer.ts` removed — use named `outputs`
- `.pipeComposite()` removed from `PortalSource` — use named `outputs`
- `query` option removed from `evmPortalSource` and `solanaPortalSource`
- `createEvmPortalSource` alias removed — use `evmPortalSource`
- `createSolanaPortalSource` alias removed — use `solanaPortalSource`
- `createSolanaInstructionDecoder` removed — use `solanaInstructionDecoder`
- `Subset<T, U>` removed from `query-builder.ts` exports — now a recursive type in `types.ts`
