# Subsquid Pipes SDK

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

From the docs/examples directory you can see how to wire sources, decoders, and targets. For example, piping EVM portal data into a ClickHouse target:

```ts
import { createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'

async function cli() {
  const stream = createEvmPortalSource({portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet'})
    .pipe(
      createEvmDecoder({
        profiler: {id: 'erc20_transfers'},
        range: {from: 'latest'},
        events: abiFile.events.Transfer,
      }),
    )

  for await (const { data } of stream) {
    console.log(`parsed ${data.transfers.length})`);
  }
}

void cli()
```

See also:
- [Factory example](./docs/examples/factory.example.ts)
- [Clickhouse integration](./docs/examples/clickhouse.example.ts)
- [More examples](./docs/examples)

## Licensing

- License: MIT

TODO:
- Add a LICENSE file at the repository root if not present.