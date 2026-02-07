import { afterEach, describe, expect, it } from 'vitest'

import { MockPortal, closeMockPortal, createMockPortal } from '../tests/index.js'
import { evmPortalSource } from './evm-portal-source.js'
import { evmQuery } from './evm-query-builder.js'

describe('evmPortalSource', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should add default fields', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x123', timestamp: 1000 } },
          { header: { number: 2, hash: '0x456', timestamp: 2000 } },
        ],
      },
    ])

    const fields = {
      log: { address: true, data: true, topics: true },
      block: { number: true, hash: true, timestamp: true },
      transaction: { from: true, to: true, hash: true },
      stateDiff: { address: true, key: true },
      trace: { error: true },
    }

    const stream = evmPortalSource({
      portal: mockPortal.url,
      outputs: evmQuery().addFields(fields).addRange({ from: 0, to: 2 }),
    })

    for await (const { data } of stream) {
      const [block] = data

      expect(block.logs).toBeInstanceOf(Array)
      expect(block.traces).toBeInstanceOf(Array)
      expect(block.transactions).toBeInstanceOf(Array)
      expect(block.stateDiffs).toBeInstanceOf(Array)
    }
  })
})
