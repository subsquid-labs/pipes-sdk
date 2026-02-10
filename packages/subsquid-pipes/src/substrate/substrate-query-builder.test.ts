import { describe, expect, it } from 'vitest'

import { SubstrateQueryBuilder } from './substrate-query-builder.js'

describe('SubstrateQueryBuilder', () => {
  describe('calculateRanges', () => {
    it('should add default range', async () => {
      const qb = new SubstrateQueryBuilder()
      const { bounded } = await qb.calculateRanges({
        portal: { getHead: async () => ({ number: 15, hash: '0x' }) },
      })

      expect(bounded).toEqual([{ range: { from: 0 } }])
    })
  })

  describe('from: latest', () => {
    it('should resolve to the latest', async () => {
      const builder = new SubstrateQueryBuilder()
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
      const builder = new SubstrateQueryBuilder()
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

  describe('addEvent', () => {
    it('should add event request', () => {
      const builder = new SubstrateQueryBuilder()
      builder.addEvent({
        range: { from: 0, to: 100 },
        request: { name: ['Balances.Transfer'] },
      })

      const requests = builder.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        range: { from: 0, to: 100 },
        request: { events: [{ name: ['Balances.Transfer'] }] },
      })
    })
  })

  describe('addCall', () => {
    it('should add call request', () => {
      const builder = new SubstrateQueryBuilder()
      builder.addCall({
        range: { from: 0, to: 100 },
        request: { name: ['Balances.transfer'] },
      })

      const requests = builder.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        range: { from: 0, to: 100 },
        request: { calls: [{ name: ['Balances.transfer'] }] },
      })
    })
  })

  describe('includeAllBlocks', () => {
    it('should add includeAllBlocks request', () => {
      const builder = new SubstrateQueryBuilder()
      builder.includeAllBlocks({ from: 0, to: 100 })

      const requests = builder.getRequests()
      expect(requests).toHaveLength(1)
      expect(requests[0]).toMatchObject({
        range: { from: 0, to: 100 },
        request: { includeAllBlocks: true },
      })
    })

    it('should use default range when not provided', () => {
      const builder = new SubstrateQueryBuilder()
      builder.includeAllBlocks()

      const requests = builder.getRequests()
      expect(requests[0]).toMatchObject({
        range: { from: 0 },
        request: { includeAllBlocks: true },
      })
    })
  })

  describe('mergeDataRequests', () => {
    it('should merge events from multiple requests', () => {
      const builder = new SubstrateQueryBuilder()
      const merged = builder.mergeDataRequests(
        { events: [{ name: ['Balances.Transfer'] }] },
        { events: [{ name: ['System.ExtrinsicSuccess'] }] },
      )

      expect(merged).toEqual({
        events: [{ name: ['Balances.Transfer'] }, { name: ['System.ExtrinsicSuccess'] }],
      })
    })

    it('should merge calls from multiple requests', () => {
      const builder = new SubstrateQueryBuilder()
      const merged = builder.mergeDataRequests(
        { calls: [{ name: ['Balances.transfer'] }] },
        { calls: [{ name: ['System.remark'] }] },
      )

      expect(merged).toEqual({
        calls: [{ name: ['Balances.transfer'] }, { name: ['System.remark'] }],
      })
    })

    it('should merge includeAllBlocks', () => {
      const builder = new SubstrateQueryBuilder()
      const merged = builder.mergeDataRequests({ includeAllBlocks: true }, { events: [{ name: ['Test'] }] })

      expect(merged.includeAllBlocks).toBe(true)
    })

    it('should merge all request types', () => {
      const builder = new SubstrateQueryBuilder()
      const merged = builder.mergeDataRequests(
        {
          events: [{ name: ['Balances.Transfer'] }],
          calls: [{ name: ['Balances.transfer'] }],
          includeAllBlocks: true,
        },
        {
          events: [{ name: ['System.ExtrinsicSuccess'] }],
          evmLogs: [{ address: ['0x1234'] }],
        },
      )

      expect(merged).toEqual({
        events: [{ name: ['Balances.Transfer'] }, { name: ['System.ExtrinsicSuccess'] }],
        calls: [{ name: ['Balances.transfer'] }],
        evmLogs: [{ address: ['0x1234'] }],
        includeAllBlocks: true,
      })
    })
  })

  describe('addFields', () => {
    it('should add and merge fields', () => {
      const builder = new SubstrateQueryBuilder()
      builder.addFields({ block: { number: true, hash: true } })
      builder.addFields({ event: { name: true, args: true } })

      const fields = builder.getFields()
      expect(fields).toEqual({
        block: { number: true, hash: true },
        event: { name: true, args: true },
      })
    })
  })

  describe('getType', () => {
    it('should return substrate', () => {
      const builder = new SubstrateQueryBuilder()
      expect(builder.getType()).toBe('substrate')
    })
  })
})
