# Subsquid Pipes SDK

> ⚠️ The SDK is experimental. Expect rapid iteration and occasional breaking changes.

Subsquid Pipes is a TypeScript-first toolkit for streaming blockchain data, transforming it in-flight, and delivering the results to your own systems. It glues together:

- **Sources** that tap into managed Subsquid Portal datasets for chains like Ethereum and Solana.
- **Transforms/decoders** that turn raw blocks and logs into strongly-typed objects.
- **Targets** that persist or forward processed data (ClickHouse today, with community hooks for more sinks).
- **Observability** utilities such as profiling, structured logging, and Prometheus metrics.

Every pipeline is described as a composition of these pieces via the `pipe()` helper.
You can run the same code in CLIs, backend services


---

## 1. Install the SDK

Add the Pipes package to any TypeScript/Node project.

```bash
pnpm add @subsquid/pipes
# or
npm install @subsquid/pipes
```

---

## 3. Create your first pipeline

The snippet below streams ERC-20 transfers from Ethereum Mainnet via the Subsquid Portal and prints them to the console.

Create `src/erc20-transfers.ts`:

```ts
import { commonAbis, evmDecoder, evmPortalSource } from '@subsquid/pipes/evm'

async function main() {
  const stream = evmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    evmDecoder({
      profiler: { name: 'erc20-transfers' },
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

## 4. Persist data (optional)

### ClickHouse target

If you have ClickHouse and want automatic offset management, read the new guide at `docs/examples/evm/04.clickhouse.example.ts`.
It uses the `createClickhouseTarget` from the core package to batch writes and handle forks gracefully.

### PostgreSQL with Drizzle

If you prefer PostgreSQL, check out `docs/examples/evm/08.drizzle.example.ts`,
which demonstrates how to use Drizzle ORM to define your schema and persist decoded data.

---

## 5. Explore more examples

- `docs/examples/evm` — combining sources, decoders, and targets for EVM chains.
- `docs/examples/solana` — Solana Portal pipelines, including the new token balance over-fetch and parallel processing demos.

From the repository root you can run any example with `pnpm tsx <path/to/example.ts>`.

---

## 6. Next steps

1. Wire your own sinks by implementing `createTarget` (see `packages/subsquid-pipes/src/targets` for references).
2. Add instrumentation with the built-in profiler and Prometheus metrics (`packages/subsquid-pipes/src/core`).
3. Try the UI tooling shipped in `@sqd-pipes/pipe-ui`, which now includes shared UI primitives like the Radix-based separator component.

Need help or found a bug? Open an issue or discussion on the repository. Happy hacking!
