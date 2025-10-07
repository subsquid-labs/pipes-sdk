import { describe, expect, it } from 'vitest'

import { SolanaQueryBuilder } from './solana-query-builder.js'

describe('SolanaQueryBuilder', () => {
  describe('from: latest', () => {
    it('should resolve to the latest', async () => {
      const builder = new SolanaQueryBuilder()
      builder.addRange({ from: 'latest' })

      const res = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
      })

      expect(res).toMatchInlineSnapshot(`
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
      const builder = new SolanaQueryBuilder()
      builder.addRange({ from: 'latest' })

      const res = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
        bound: { from: 10 },
      })

      expect(res).toMatchInlineSnapshot(`
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
