import { afterEach, describe, expect, it } from 'vitest'

import { createTestLogger } from '~/testing/test-logger.js'

import { EvmQueryBuilder } from './evm-query-builder.js'
import { evmRpcLatencyWatcher } from './evm-rpc-latency-watcher.js'

describe('evmRpcLatencyWatcher factory', () => {
  let transformer: ReturnType<typeof evmRpcLatencyWatcher> | undefined

  afterEach(async () => {
    await transformer?.stop({ logger: createTestLogger() })
    transformer = undefined
  })

  it('seeds the query with block.number and block.timestamp', async () => {
    transformer = evmRpcLatencyWatcher({ rpcUrl: ['ws://127.0.0.1:1'] })

    const builder = new EvmQueryBuilder<{ block: { number: true; timestamp: true } }>()
    await transformer.setupQuery({ query: builder, logger: createTestLogger() })

    expect(builder.getFields()).toEqual({
      block: { number: true, timestamp: true },
    })
  })

  it('sets the range to start from latest', async () => {
    transformer = evmRpcLatencyWatcher({ rpcUrl: ['ws://127.0.0.1:1'] })

    const builder = new EvmQueryBuilder<{ block: { number: true; timestamp: true } }>()
    await transformer.setupQuery({ query: builder, logger: createTestLogger() })

    const requests = builder.getRequests()
    expect(requests).toContainEqual(
      expect.objectContaining({ range: { from: 'latest' } }),
    )
  })
})
