# Subsquid Pipes SDK

> ⚠️ **Warning**: This SDK is currently in the experimental stage.
> APIs may change without notice.
> Use with caution in production environments.

Core SDK for building data pipelines with Subsquid Pipes. This repository is a pnpm/Turborepo monorepo containing the core TypeScript package and documentation/examples.

## Overview

The SDK provides a pipeline-based architecture for consuming, transforming, and storing blockchain data. 

The main package, `@sqd-pipes/pipes`, exposes composable sources, decoders, and targets for common chains and sinks.

Highlights:
- TypeScript-first library with ESM and CJS builds.
- EVM helpers (portal source, event decoding).
- Targets (e.g., ClickHouse) with batching and rollback handling.
- Built-in metrics (Prometheus) and logging (pino-compatible) and benchmarking tools.
- Extensible architecture for custom sources, decoders, and targets.


## Repository layout

```
- packages/
  - subsquid-pipes/ — core library published as `@sqd-pipes/pipes`.
- docs/
  - examples/ — runnable TypeScript examples demonstrating usage.
```

## Using the library (basic examples)

From the docs/examples directory you can see how to wire sources, decoders, and targets.
For example, decoding ERC-20 Transfer events from Ethereum:

```ts
import { commonAbis, createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'

async function cli() {
  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    createEvmDecoder({
      profiler: { id: 'erc20_transfers' },
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

void cli()
```

See also:
- [Combining pipes example](./docs/examples/02.combining-pipes.example.ts)
- [Factory example](./docs/examples/03.factory.example.ts)
- [Clickhouse integration](./docs/examples/04.clickhouse.example.ts)
- [And many others](./docs/examples)

## Licensing

- License: MIT

TODO:
- Add a LICENSE file at the repository root if not present.