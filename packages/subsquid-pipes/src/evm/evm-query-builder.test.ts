import { describe, expect, it } from 'vitest'
import { EvmQueryBuilder } from '~/evm/evm-query-builder.js'

describe('EvmQueryBuilder', () => {
  describe('calculateRanges', () => {
    it('should add default range', async () => {
      const qb = new EvmQueryBuilder()
      const { bounded } = await qb.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
      })

      expect(bounded).toEqual([{ range: { from: 0 } }])
    })
  })

  describe('from: latest', () => {
    it('should resolve to the latest', async () => {
      const builder = new EvmQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
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
      const builder = new EvmQueryBuilder()
      builder.addRange({ from: 'latest' })

      const { bounded } = await builder.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
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
