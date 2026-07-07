import { contractFactory, contractFactoryStore, evmDecoder, evmPortalStream } from '@subsquid/pipes/evm'

import { events as factoryAbi } from './abi/uniswap.v3/factory'
import { events as swapsAbi } from './abi/uniswap.v3/swaps'

/**
 * This example demonstrates factory pre-indexing — an explicit discovery phase
 * that runs before the main loop starts.
 *
 * Without `preindex`, a factory pipe streams child events with a wildcard
 * (topic-only) query and filters them client-side, because the child addresses
 * are only discovered along the way. That means downloading every `Swap` event
 * on the network, including those from unrelated contracts.
 *
 * With `preindex: true` the pipe runs in two phases:
 *
 * 1. Check run (every startup): scans only the factory-creation events up to the
 *    finalized head and persists the discovered child addresses to the factory
 *    database. Progress is stored alongside, so a restart only scans the gap
 *    since the previous run — an interrupted scan resumes where it left off.
 *
 * 2. Main loop: for the pre-indexed range the query sends the full child address
 *    list to the portal (server-side filter — much faster backfill, less traffic).
 *    Above the finalized head it falls back to the usual wildcard query, where
 *    speed doesn't matter since blocks arrive one at a time.
 *
 * Forks are safe by construction: the pre-indexed range never goes above the
 * finalized head, and children discovered inline in the wildcard tail are rolled
 * back by the regular factory fork handling.
 */

async function cli() {
  const stream = evmPortalStream({
    id: 'uniswap-v3-swaps-preindexed',
    portal: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
    outputs: evmDecoder({
      range: { from: '12,369,621' },
      contracts: contractFactory({
        address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
        event: factoryAbi.PoolCreated,
        childAddressField: 'pool',
        // Pre-indexing requires a persistent store — discovered pools and the
        // scan progress live in the same SQLite file
        database: contractFactoryStore({
          path: './uniswap3-eth-pools.sqlite',
        }),
        preindex: true,
        // Optionally cap the server-side filter size; above the threshold the pipe
        // logs a warning and falls back to the wildcard query
        // preindex: { maxAddressFilterSize: 50_000 },
      }),
      events: {
        swaps: swapsAbi.Swap,
      },
    }),
  })

  for await (const { data } of stream) {
    console.log(`parsed ${data.swaps.length} swaps`)
  }
}

void cli()
