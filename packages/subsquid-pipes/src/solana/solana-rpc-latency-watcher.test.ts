import { afterEach, describe, expect, it } from 'vitest'

import { PortalClient } from '~/portal-client/client.js'
import { createTestLogger } from '~/testing/test-logger.js'

import { SolanaQueryBuilder } from './solana-query-builder.js'
import { solanaRpcLatencyWatcher } from './solana-rpc-latency-watcher.js'

describe('solanaRpcLatencyWatcher factory', () => {
  let transformer: ReturnType<typeof solanaRpcLatencyWatcher> | undefined

  afterEach(async () => {
    await transformer?.stop({ logger: createTestLogger() })
    transformer = undefined
  })

  it('seeds the query with block.number and block.timestamp', async () => {
    transformer = solanaRpcLatencyWatcher({ rpcUrl: ['ws://127.0.0.1:1'] })

    const builder = new SolanaQueryBuilder<{ block: { number: true; timestamp: true } }>()
    await transformer.setupQuery({ query: builder, logger: createTestLogger(), portal: {} as PortalClient })

    expect(builder.getFields()).toEqual({
      block: { number: true, timestamp: true },
    })
  })

  it('sets the range to start from latest', async () => {
    transformer = solanaRpcLatencyWatcher({ rpcUrl: ['ws://127.0.0.1:1'] })

    const builder = new SolanaQueryBuilder<{ block: { number: true; timestamp: true } }>()
    await transformer.setupQuery({ query: builder, logger: createTestLogger(), portal: {} as PortalClient })

    const requests = builder.getRequests()
    expect(requests).toContainEqual(expect.objectContaining({ range: { from: 'latest' } }))
  })
})
