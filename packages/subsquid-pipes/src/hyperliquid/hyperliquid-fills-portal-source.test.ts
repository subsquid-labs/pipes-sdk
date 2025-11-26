import { afterEach, describe, expect, it } from 'vitest'
import { hyperliquidFills } from '~/portal-client/index.js'
import { closeMockPortal, createMockPortal, MockPortal } from '../tests/index.js'
import { hyperliquidFillsPortalSource } from './hyperliquid-fills-portal-source.js'
import { HyperliquidFillsQueryBuilder } from './hyperliquid-fills-query-builder.js'

describe('Portal abstract stream', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should add default fields', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0xabcd1', timestamp: 1000 } },
          { header: { number: 2, hash: '0xabcd2', timestamp: 2000 } },
        ],
      },
    ])

    const fields: hyperliquidFills.FieldSelection = {
      block: { number: true, hash: true, timestamp: true },
      fill: { user: true, coin: true, px: true, sz: true, side: true },
    } as const

    const stream = hyperliquidFillsPortalSource({
      portal: mockPortal.url,
      query: new HyperliquidFillsQueryBuilder().addFields(fields).addRange({ from: 0, to: 2 }),
    })

    for await (const { data } of stream) {
      const [block] = data.blocks

      expect(block.fills).toBeInstanceOf(Array)
    }
  })
})
