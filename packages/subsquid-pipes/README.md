# @sqd-pipes/pipes

> ⚠️ **Warning**: This SDK is currently in the experimental stage.
> APIs may change without notice.
> Use with caution in production environments.

Core package of the **SQD Pipes** ecosystem. It provides specialized, composable streams for blockchain data ingestion, transformation, and storage.

---

## Overview

`@sqd-pipes/pipes` is a TypeScript library designed for **efficient blockchain data processing**.  
It implements a **pipeline-based architecture** that makes it easy to consume, decode, and persist blockchain data, while remaining flexible and extensible.

---

## Features

- **TypeScript-first** — full type safety with both ESM and CJS builds.
- **Blockchain integration**:
  - EVM helpers (portal sources, event decoders).
- **Storage targets**:
  - Built-in support for ClickHouse with batching and rollback handling.
- **Observability**:
  - Prometheus metrics.
  - Pino-compatible logging.
  - Benchmarking utilities.
- **Extensible architecture** — create custom sources, decoders, and targets for any chain or sink.

---

## Installation

```bash
npm install @sqd-pipes/pipes
```

---

## Quick Start

Example: consume events from an EVM chain and write them into ClickHouse.

```ts
import { commonAbis, createEvmDecoder, createEvmPortalSource } from '@sqd-pipes/pipes/evm'

async function cli() {
  const stream = createEvmPortalSource({
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
  }).pipe(
    createEvmDecoder({
      profiler: { id: 'ERC20 transfers' },
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

---

## Usage

Pipelines are fully composable:

- **Sources** provide blockchain data (e.g., blocks, logs, transactions).
- **Decoders** transform raw data into structured objects.
- **Targets** handle persistence in databases, message queues, or custom sinks.

You can easily extend the system by implementing custom components that conform to the `Transformer` / `Target` interfaces.

---

## Documentation

Full documentation is available in the [project wiki](./docs) (WIP).

---

## Contributing

Contributions are welcome! Please open an issue or submit a PR with improvements.

---

## License

MIT © SQD
