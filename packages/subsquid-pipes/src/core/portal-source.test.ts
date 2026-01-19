import { afterEach, describe, expect, it } from 'vitest'

import { evmPortalSource } from '~/evm/index.js'
import {
  MockPortal,
  blockTransformer,
  closeMockPortal,
  createFinalizedMockPortal,
  createMockPortal,
  readAll,
} from '~/tests/index.js'

describe('Portal abstract stream', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  describe('common', () => {
    it('should expose finalization headers', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x456' } }],
          head: {
            finalized: { number: 10, hash: '0xfinalized' },
            latest: { number: 12 },
          },
        },
      ])

      const stream = evmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      let firstCtx
      for await (const { ctx } of stream) {
        firstCtx = {
          head: ctx.head,
          progress_state: ctx.state.progress?.state,
        }
      }

      expect(firstCtx).toMatchInlineSnapshot(`
        {
          "head": {
            "finalized": {
              "hash": "0xfinalized",
              "number": 10,
            },
            "latest": {
              "number": 12,
            },
          },
          "progress_state": {
            "current": 2,
            "etaSeconds": 0,
            "initial": 0,
            "last": 2,
            "percent": 100,
          },
        }
      `)
    })

    it('should adjust latest block number from data over header', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 14, hash: '0x456' } }], // latest block is 14 in data
          head: {
            finalized: { number: 10, hash: '0xfinalized' },
            latest: { number: 12 }, // but 12 in header
          },
        },
      ])

      const stream = evmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      let firstCtx
      for await (const { ctx } of stream) {
        firstCtx = {
          head: ctx.head,
          progress_state: ctx.state.progress?.state,
        }
      }

      expect(firstCtx).toMatchInlineSnapshot(`
        {
          "head": {
            "finalized": {
              "hash": "0xfinalized",
              "number": 10,
            },
            "latest": {
              "number": 12,
            },
          },
          "progress_state": {
            "current": 14,
            "etaSeconds": 0,
            "initial": 0,
            "last": 14,
            "percent": 100,
          },
        }
      `)
    })
  })

  describe('unfinalized', () => {
    it('should receive all stream data and stop', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123' } }, { header: { number: 2, hash: '0x456' } }],
        },
      ])

      const stream = evmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
      [
        {
          "hash": "0x123",
          "number": 1,
        },
        {
          "hash": "0x456",
          "number": 2,
        },
      ]
    `)
    })

    it('should retries 10 by default', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123' } }],
        },
        ...new Array(10).fill({ statusCode: 503 }),
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x456' } }],
        },
      ])

      const stream = evmPortalSource({
        portal: {
          url: mockPortal.url,
          http: { retrySchedule: [0] },
        },
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
      [
        {
          "hash": "0x123",
          "number": 1,
        },
        {
          "hash": "0x456",
          "number": 2,
        },
      ]
    `)
    })

    it('should throw an error after max retries', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }],
        },
        ...new Array(2).fill({ statusCode: 503 }),
      ])

      const stream = evmPortalSource({
        portal: {
          url: mockPortal.url,
          http: {
            retryAttempts: 1,
            retrySchedule: [0],
          },
        },
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      await expect(readAll(stream)).rejects.toThrow(`Got 503 from ${mockPortal.url}`)
      await stream.stop()
    })

    it('should throw fork exception', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            {
              header: {
                number: 100_000_000,
                hash: '0x100000000',
              },
            },
          ],
        },
        {
          statusCode: 409,
          data: {
            previousBlocks: [
              {
                number: 99_999_999,
                hash: '0x99999999__1',
              },
              {
                number: 100_000_000,
                hash: '0x100000000__1',
              },
            ],
          },
          validateRequest: (req) => {
            expect(req).toMatchObject({
              type: 'evm',
              fromBlock: 100_000_001,
              parentBlockHash: '0x100000000',
            })
          },
        },
      ])

      const stream = evmPortalSource({
        portal: {
          url: mockPortal.url,
          http: { retryAttempts: 0, retrySchedule: [0] },
        },
        query: { from: 0, to: 100_000_001 },
      }).pipe(blockTransformer())

      await expect(readAll(stream)).rejects.toThrow(
        [
          `A blockchain fork was detected at 100,000,001 block.`,
          `-----------------------------------------`,
          `The correct hash:        "0x100000000__1".`,
          `But the client provided: "0x100000000".`,
          `-----------------------------------------`,
          // TODO add a link to the docs
          `Please refer to the documentation on how to handle forks.`,
        ].join('\n'),
      )
    })
  })

  describe('finalized', () => {
    it('should receive all finalized data and stop', async () => {
      mockPortal = await createFinalizedMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123' } }, { header: { number: 2, hash: '0x456' } }],
        },
      ])

      const stream = evmPortalSource({
        portal: {
          url: mockPortal.url,
          finalized: true,
        },
        query: { from: 0, to: 2 },
      }).pipe(blockTransformer())

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
      [
        {
          "hash": "0x123",
          "number": 1,
        },
        {
          "hash": "0x456",
          "number": 2,
        },
      ]
    `)
    })
  })
})
