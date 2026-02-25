# Pipes SDK 1.0 — Release Notes

## Breaking changes

### 1. New chainable `outputs` option (required)

Portal sources no longer expose `.pipe()` / `.pipeComposite()` on the source level.
Instead, every portal source now requires a chainable `outputs` option that defines what data to fetch 
and how to initially transform it.

An output is built with the `query().build().pipe()` chain:

```ts
evmPortalSource({
  portal: '...',
  outputs: evmQuery()
    .addLog({ topic0: [erc20.events.Transfer.topic] })
    .build()                          // finalizes the query (no further query changes allowed)
    .pipe((blocks) => decode(blocks)) // chain transformers via .pipe()
    .pipe((decoded) => filter(decoded)),
})
```

After `.build()` the query is frozen — you can only chain `.pipe()` transformers from that point.

**Decoders** like `evmDecoder()` and `solanaInstructionDecoder()` are
convenience shorthands that wrap `query().build().pipe()` internally. 

They are also chainable:

```ts
// decoder is a shorthand for query().build().pipe()
evmPortalSource({
  portal: '...',
  outputs: evmDecoder({
    range: { from: 'latest' },
    events: { transfers: erc20.events.Transfer },
  }).pipe((e) => e.transfers), // chain .pipe() on top of a decoder
})
```

Multiple outputs (previously `.pipeComposite()`) are now a named record:

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

The same change applies to every portal source (`solanaPortalSource`, `hyperliquidFillsPortalSource`, etc.).

### 2. Raw outputs are now plain block arrays

When using a portal source without a decoder, `data` is now the block array directly — no more `.blocks` wrapper.

```ts
// before
const stream = evmPortalSource({
  portal: '...',
  query: new EvmQueryBuilder().addLog({ topic0: [erc20.events.Transfer.topic] }),
})

for await (const { data } of stream) {
  data.blocks // Block[]
}

// after
const stream = evmPortalSource({
  portal: '...',
  // evmQuery() is a shorthand for new EvmQueryBuilder()
  outputs: evmQuery().addLog({ topic0: [erc20.events.Transfer.topic] }).build(),
})

for await (const { data } of stream) {
  data // Block[]
}
```

Query builder constructors now have shorthand factory functions:

| Before | After |
|---|---|
| `new EvmQueryBuilder()` | `evmQuery()` |
| `new SolanaQueryBuilder()` | `solanaQuery()` |
| `new HyperliquidFillsQueryBuilder()` | `hyperliquidFillsQuery()` |

### 3. Pipe `id` on all portal sources

Every portal source now accepts an `id`. It must be **globally unique and stable** — targets use it as a cursor key to persist progress. Two pipes that share the same `id` will overwrite each other's cursor. The `id` is also used to scope log lines and Prometheus metric labels.

Required when calling `.pipeTo()` (throws `DefaultPipeIdError` / E0001 otherwise).

```ts
// before — id was optional
evmPortalSource({ portal: '...' })
  .pipe(evmDecoder({ ... }))
  .pipeTo(myTarget)

// after — id is required for .pipeTo()
evmPortalSource({ id: 'eth-transfers', portal: '...', outputs: evmDecoder({ ... }) })
  .pipeTo(myTarget) // cursor stored under key "eth-transfers"

solanaPortalSource({ id: 'sol-swaps', portal: '...', outputs: solanaInstructionDecoder({ ... }) })
  .pipeTo(myTarget) // cursor stored under key "sol-swaps"
```

### 4. `create` prefix dropped from factory functions

The `create` prefix has been dropped from all factory functions. The old exports are removed with no deprecation aliases.

| Before | After |
|---|---|
| `createEvmPortalSource` | `evmPortalSource` |
| `createSolanaPortalSource` | `solanaPortalSource` |
| `createSolanaInstructionDecoder` | `solanaInstructionDecoder` |

### 5. Progress tracker event types renamed and restructured

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

## New features


### 1. Time-based ranges

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

### 2. EVM testing utilities — `@subsquid/pipes/testing/evm`

A new public entry point with helpers for writing tests against EVM portal streams. Encode events with full type inference from viem ABIs, build mock blocks with auto-generated metadata, and spin up a mock portal server — all in a few lines.

```ts
import { encodeEvent, mockBlock, evmPortalMockStream } from '@subsquid/pipes/testing/evm'

const transfer = encodeEvent({
  abi: erc20Abi,
  eventName: 'Transfer',
  address: '0xA0b8...3606eB48',
  args: { from: '0x...', to: '0x...', value: 100n }, // fully typed from ABI
})

const portal = await evmPortalMockStream({
  blocks: [
    mockBlock({ transactions: [{ logs: [transfer] }] }),
    mockBlock({ transactions: [{ logs: [transfer] }] }),
  ],
})

// Use portal.url with evmPortalSource in your test
```

Works end-to-end with `evmDecoder` and `factory()` for testing Uniswap-style factory/child event patterns. Requires `viem` as an optional peer dependency.

### 3. OpenTelemetry integration — `@subsquid/pipes/opentelemetry`

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

### 4. Runner — multi-pipe management (local development only)

Define your pipe logic once, then run it against multiple datasets concurrently with shared metrics and automatic retries:

```ts
import { createDevRunner } from '@subsquid/pipes/runtime/node'

// one pipe function, reused across chains
async function indexTransfers({ id, params, logger, metrics }: RunConfig<{ portal: string }>) {
  const stream = evmPortalSource({
    id,
    portal: params.portal,
    logger,
    metrics,
    outputs: evmDecoder({
      range: { from: '2024-01-01' },
      events: { transfers: erc20.events.Transfer },
    }),
  })

  for await (const { data } of stream) {
    logger.info(`Got ${data.transfers.length} transfers`)
  }
}

const runner = createDevRunner(
  [
    { id: 'eth-transfers',  params: { portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet' },  stream: indexTransfers },
    { id: 'base-transfers', params: { portal: 'https://portal.sqd.dev/datasets/base-mainnet' },      stream: indexTransfers },
  ],
  { retry: 5, metrics: { port: 9090 } },
)

await runner.start()
```

All pipes run concurrently in a single process, share a Prometheus metrics server, 
and each gets its own scoped logger and cursor persistence keyed by `id`.


### 5. Typed error system with documentation links

All framework errors extend `PipeError` and carry a unique code linking to the docs (`https://docs.sqd.dev/errors/<code>`).

| Error | Code | Thrown when |
|---|---|---|
| `DefaultPipeIdError` | E0001 | `.pipeTo()` called without a pipe `id` |
| `TargetForkNotSupportedError` | E1001 | Fork detected but target has no `fork()` method |
| `ForkNoPreviousBlocksError` | E1002 | Fork exception carried no previous blocks |
| `ForkCursorMissingError` | E1003 | Target `fork()` returned `null` |


### 6. New Prometheus metrics

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

---

## Removals

- `CompositeTransformer` / `compositeTransformer` / `composite-transformer.ts` removed — use named `outputs`
- `.pipeComposite()` removed from `PortalSource` — use named `outputs`
- `query` option removed from `evmPortalSource` and `solanaPortalSource`
- `createEvmPortalSource` alias removed — use `evmPortalSource`
- `createSolanaPortalSource` alias removed — use `solanaPortalSource`
- `createSolanaInstructionDecoder` removed — use `solanaInstructionDecoder`
- `Subset<T, U>` removed from `query-builder.ts` exports — now a recursive type in `types.ts`
