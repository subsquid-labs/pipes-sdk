# SQD Pipes SDK

[![npm](https://img.shields.io/npm/v/@subsquid/pipes.svg)](https://www.npmjs.com/package/@subsquid/pipes)
[![license](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](./LICENSE)
[![docs](https://img.shields.io/badge/docs-docs.sqd.dev-3b82f6)](https://docs.sqd.dev)

Documentation: https://docs.sqd.dev  ·  Website: https://sqd.dev

SQD Pipes is a TypeScript-first toolkit for streaming blockchain data, transforming it in-flight, and delivering the results to your own systems. It glues together:

- **Sources** that tap into managed SQD Portal datasets for chains like Ethereum and Solana.
- **Transforms/decoders** that turn raw blocks and logs into strongly-typed objects.
- **Targets** that persist or forward processed data (ClickHouse today, with community hooks for more sinks).
- **Observability** utilities such as profiling, structured logging, and Prometheus metrics.

Every pipeline is described as a composition of these pieces via the `pipe()` helper.
You can run the same code in CLIs, backend services, or long-running workers.


---

## 1. Install the SDK

Add the Pipes package to any TypeScript/Node project.

```bash
pnpm add @subsquid/pipes
# or
npm install @subsquid/pipes
```

---

## 2. Create your first pipeline

The snippet below streams ERC-20 transfers from Ethereum Mainnet via the SQD Portal and prints them to the console.

Create `src/erc20-transfers.ts`:

```ts
import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'

async function main() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    evmDecoder({
      profiler: { id: 'erc20-transfers' },
      range: { from: '12,000,000' },
      events: {
        transfers: commonAbis.erc20.events.Transfer,
      },
    }),
  )

  for await (const { data } of stream) {
    console.log(`parsed ${data.transfers.length} transfers`)
  }
}

void main()
```

Run it with [`tsx`](https://github.com/privatenumber/tsx) (fast TypeScript executor):

```bash
pnpm dlx tsx src/erc20-transfers.ts
```

You should see logs as transfers are decoded.

---

## 3. Persist data (optional)

### ClickHouse target

If you have ClickHouse and want automatic offset management, read the [ClickHouse example](https://github.com/subsquid-labs/pipes-sdk/blob/main/docs/examples/evm/04.clickhouse.example.ts).
It uses the `createClickhouseTarget` from the core package to batch writes and handle forks gracefully.

### PostgreSQL with Drizzle

If you prefer PostgreSQL, check out the [Drizzle example](https://github.com/subsquid-labs/pipes-sdk/blob/main/docs/examples/evm/08.drizzle.example.ts),
which demonstrates how to use Drizzle ORM to define your schema and persist decoded data.

---

## 4. Explore more examples

- [`docs/examples/evm`](https://github.com/subsquid-labs/pipes-sdk/tree/main/docs/examples/evm): combining sources, decoders, and targets for EVM chains.
- [`docs/examples/solana`](https://github.com/subsquid-labs/pipes-sdk/tree/main/docs/examples/solana): Solana Portal pipelines, including token balance over-fetch and parallel processing demos.

From the repository root you can run any example with `pnpm tsx <path/to/example.ts>`.

---

## 5. Next steps

1. Wire your own sinks by implementing `createTarget` (see `packages/subsquid-pipes/src/targets` for references).
2. Add instrumentation with the built-in profiler and Prometheus metrics (`packages/subsquid-pipes/src/core`).
3. Try the UI tooling in `@sqd-pipes/pipe-ui`.

Need help or found a bug? Open an issue or discussion on the repository. Happy hacking!
