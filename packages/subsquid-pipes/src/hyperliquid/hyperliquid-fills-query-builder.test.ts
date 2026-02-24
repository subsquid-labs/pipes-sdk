import { describe, expect, it } from 'vitest'

import { HyperliquidFillsQueryBuilder } from './hyperliquid-fills-query-builder.js'

describe('HyperliquidFillsQueryBuilder', () => {
  describe('from: latest', () => {
    it('should resolve to the latest', async () => {
      const builder = new HyperliquidFillsQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }), resolveTimestamp: async () => 0 },
      })

      expect(bounded).toMatchInlineSnapshot(`
        [
          {
            "range": {
              "from": 15,
            },
            "request": {},
          },
        ]
      `)
    })

    it('should take bound over latest', async () => {
      const builder = new HyperliquidFillsQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }), resolveTimestamp: async () => 0 },
        bound: { from: 10 },
      })

      expect(bounded).toMatchInlineSnapshot(`
        [
          {
            "range": {
              "from": 10,
            },
            "request": {},
          },
        ]
      `)
    })
  })
})
