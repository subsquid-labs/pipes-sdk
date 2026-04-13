import { describe, expect, it } from 'vitest'

import { mockPortalRestApi } from '~/tests/index.js'

import { SolanaQueryBuilder } from './solana-query-builder.js'

describe('SolanaQueryBuilder', () => {
  describe('from: latest', () => {
    it('should resolve to the latest', async () => {
      const builder = new SolanaQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: mockPortalRestApi({
          getHead: async () => ({ number: 15, hash: '0x' }),
        }),
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
      const builder = new SolanaQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: mockPortalRestApi({
          getHead: async () => ({ number: 15, hash: '0x' }),
        }),
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
