import { afterEach, describe, expect, expectTypeOf, it } from 'vitest'

import { createTarget } from '~/core/target.js'
import { Target } from '~/core/target.js'
import { TransformerArgs } from '~/core/transformer.js'
import { evmPortalStream } from '~/evm/index.js'
import {
  MockPortal,
  blockDecoder,
  createFinalizedMockPortal,
  createMockPortal,
  readAll,
} from '~/testing/index.js'

describe('Portal abstract stream', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await mockPortal?.close()
  })

  describe('common', () => {
    it('should expose finalization headers', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x456', timestamp: 2000 } }],
          head: {
            finalized: { number: 10, hash: '0xfinalized' },
            latest: { number: 12 },
          },
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

      let firstCtx
      for await (const { ctx } of stream) {
        firstCtx = {
          head: ctx.stream.head,
          progress_state: ctx.stream.progress?.state,
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
          data: [{ header: { number: 14, hash: '0x456', timestamp: 14000 } }], // latest block is 14 in data
          head: {
            finalized: { number: 10, hash: '0xfinalized' },
            latest: { number: 12 }, // but 12 in header
          },
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

      let firstCtx
      for await (const { ctx } of stream) {
        firstCtx = {
          head: ctx.stream.head,
          progress_state: ctx.stream.progress?.state,
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

    it('should keep requesting data on head', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 204,
        },
        {
          statusCode: 204,
        },
        {
          statusCode: 204,
        },
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      })

      expect(await readAll(stream)).toMatchInlineSnapshot(`
        [
          {
            "hash": "0x123",
            "number": 1,
            "timestamp": 1000,
          },
        ]
      `)
    })
  })

  describe('unfinalized', () => {
    it('should receive all stream data and stop', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }, { header: { number: 2, hash: '0x456', timestamp: 2000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
        [
          {
            "hash": "0x123",
            "number": 1,
            "timestamp": 1000,
          },
          {
            "hash": "0x456",
            "number": 2,
            "timestamp": 2000,
          },
        ]
      `)
    })

    it('should retries 10 by default', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }],
        },
        ...new Array(10).fill({ statusCode: 503 }),
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x456', timestamp: 2000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: {
          url: mockPortal.url,
          http: { retrySchedule: [0] },
        },
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
        [
          {
            "hash": "0x123",
            "number": 1,
            "timestamp": 1000,
          },
          {
            "hash": "0x456",
            "number": 2,
            "timestamp": 2000,
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

      const stream = evmPortalStream({
        id: 'test',
        portal: {
          url: mockPortal.url,
          http: {
            retryAttempts: 1,
            retrySchedule: [0],
          },
        },
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

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
                timestamp: 100_000_000_000,
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

      const stream = evmPortalStream({
        id: 'test',
        portal: {
          url: mockPortal.url,
          http: { retryAttempts: 0, retrySchedule: [0] },
        },
        outputs: blockDecoder({ from: 0, to: 100_000_001 }),
      })

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

  describe('pipe/pipeTo', () => {
    it('should not throw when a transform function is passed to .pipe()', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      })

      expect(() => stream.pipe((data: any) => data)).not.toThrow()
    })

    it('should not throw when a target is passed to .pipeTo()', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      })

      const target = createTarget({
        write: async () => {},
      })

      expect(() => stream.pipeTo(target as any)).not.toThrow()
    })
  })

  describe('finalized', () => {
    it('should receive all finalized data and stop', async () => {
      mockPortal = await createFinalizedMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x123', timestamp: 1000 } }, { header: { number: 2, hash: '0x456', timestamp: 2000 } }],
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: {
          url: mockPortal.url,
          finalized: true,
        },
        outputs: blockDecoder({ from: 0, to: 2 }),
      })

      const res = await readAll(stream)

      expect(res).toMatchInlineSnapshot(`
        [
          {
            "hash": "0x123",
            "number": 1,
            "timestamp": 1000,
          },
          {
            "hash": "0x456",
            "number": 2,
            "timestamp": 2000,
          },
        ]
      `)
    })
  })

  describe('finalized watermark (centralized clamp)', () => {
    it('clamps a transient missing finalized head up to the persisted floor', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 6, hash: '0x6', timestamp: 6000 } }],
          // finalized header dropped on this batch
        },
      ])

      const stream = evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 6 }) })

      const seen: unknown[] = []
      const target = createTarget({
        write: async ({ read }) => {
          for await (const { ctx } of read({ latest: { number: 5, hash: '0x5' }, finalized: { number: 5, hash: '0x5f' } })) {
            seen.push(ctx.stream.head.finalized)
          }
        },
      })
      await stream.pipeTo(target as any)

      // The dropped header must not leak as `undefined` (which would collapse the buffer threshold
      // to Infinity and release unfinalized rows); it clamps back up to the persisted floor (5).
      expect(seen).toEqual([{ number: 5, hash: '0x5f' }])
    })

    it('seeds the floor from the target resume state and clamps a regression below it (restart-mid-fork)', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 6, hash: '0x6', timestamp: 6000 } }],
          // first batch after restart reports a finalized head (3) below the persisted floor (5)
          head: { finalized: { number: 3, hash: '0x3f' }, latest: { number: 10 } },
        },
      ])

      const stream = evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 6 }) })

      const seen: unknown[] = []
      const target = createTarget({
        write: async ({ read }) => {
          for await (const { ctx } of read({ latest: { number: 5, hash: '0x5' }, finalized: { number: 5, hash: '0x5f' } })) {
            seen.push(ctx.stream.head.finalized)
          }
        },
      })
      await stream.pipeTo(target as any)

      // The persisted floor (5) survives the restart and clamps the lower reported head (3).
      expect(seen).toEqual([{ number: 5, hash: '0x5f' }])
    })

    it('leaves finalized undefined for a no-finality dataset (passthrough)', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
          ],
          // no head at all → no finality
        },
      ])

      const stream = evmPortalStream({ id: 'test', portal: mockPortal.url, outputs: blockDecoder({ from: 0, to: 2 }) })

      const finalizedPerBatch = []
      for await (const { ctx } of stream) {
        finalizedPerBatch.push(ctx.stream.head.finalized)
      }

      // Floor is never seeded (only from a real finalized head), so it stays undefined.
      expect(finalizedPerBatch).toEqual([undefined])
    })
  })
})

describe('pipe/pipeTo type guards', () => {
  it('pipe() should not accept objects with a write() method (Target)', () => {
    type SinkLike = { write: () => void }
    expectTypeOf<SinkLike>().not.toMatchTypeOf<TransformerArgs<any, any>>()
  })

  it('pipeTo() should not accept plain functions', () => {
    type Fn = (data: any) => any
    expectTypeOf<Fn>().not.toMatchTypeOf<Target<any>>()
  })
})
