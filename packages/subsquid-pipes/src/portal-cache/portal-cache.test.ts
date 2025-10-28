import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortalBatch } from '~/core/index.js'
import { createEvmPortalSource } from '~/evm/index.js'
import { blockTransformer, closeMockPortal, createMockPortal, MockPortal } from '~/tests/index.js'
import { sqliteCacheAdapter } from './adapters/sqlite/index.js'

// Transform batch to only include data and meta without any functions or complex objects
const transformBatch = ({
  data,
  ctx: {
    head,
    query: {
      // exclude another dynamic, i.e. URL
      url,
      ...query
    },
    meta: {
      bytesSize,
      // exclude other dynamic meta fields
      ...meta
    },

    state: {
      progress,
      // exclude progress as it contains timers and dynamic data
      ...state
    },

    // do not include it in the test
    metrics,
    logger,
    profiler,
  },
}: PortalBatch) => ({
  data,
  meta: {
    head,
    query,
    meta: {
      bytesSize,
    },
    state,
  },
})

export async function readAllChunks<T>(stream: AsyncIterable<T>) {
  const res: T[] = []

  for await (const batch of stream) {
    res.push(batch)
  }

  return res
}

const DB_PATH = './test.db'

describe('Portal cache', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  beforeEach(async () => {
    await fs.rm(DB_PATH).catch(() => {})
  })

  describe('Sqlite adapter', () => {
    it('should store requests and get the same result on second pass', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          finalizedHead: { number: 5, hash: '0x5' },
        },
      ])

      const adapter = await sqliteCacheAdapter({ path: DB_PATH })

      const stream = createEvmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 5 },
        cache: { adapter },
      }).pipe(blockTransformer())

      const res1 = (await readAllChunks(stream)).map(transformBatch)
      const res2 = (await readAllChunks(stream)).map(transformBatch)

      expect(res1).toEqual(res2)
      expect(res2).toMatchInlineSnapshot(`
        [
          {
            "data": [
              {
                "hash": "0x1",
                "number": 1,
                "timestamp": 1000,
              },
              {
                "hash": "0x2",
                "number": 2,
                "timestamp": 2000,
              },
              {
                "hash": "0x3",
                "number": 3,
                "timestamp": 3000,
              },
              {
                "hash": "0x4",
                "number": 4,
                "timestamp": 4000,
              },
              {
                "hash": "0x5",
                "number": 5,
                "timestamp": 5000,
              },
            ],
            "meta": {
              "head": {
                "finalized": {
                  "hash": "0x5",
                  "number": 5,
                },
                "unfinalized": undefined,
              },
              "meta": {
                "bytesSize": 265,
              },
              "query": {
                "hash": "2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a",
                "raw": {
                  "fields": {},
                  "fromBlock": 0,
                  "parentBlockHash": undefined,
                  "toBlock": 5,
                  "type": "evm",
                },
              },
              "state": {
                "current": {
                  "hash": "0x5",
                  "number": 5,
                  "timestamp": 5000,
                },
                "initial": 0,
                "last": 5,
                "rollbackChain": [
                  {
                    "hash": "0x5",
                    "number": 5,
                    "timestamp": 5000,
                  },
                ],
              },
            },
          },
        ]
      `)

      // check stored rows by query hash
      const rows = await readAllChunks(
        adapter.stream({
          queryHash: '2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a',
          fromBlock: 1,
        }),
      )

      expect(rows).toHaveLength(1)
    })

    it('should not reuse data that has from greater than request', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 6, hash: '0x6', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7', timestamp: 7000 } },
            { header: { number: 8, hash: '0x8', timestamp: 8000 } },
            { header: { number: 9, hash: '0x9', timestamp: 9000 } },
            { header: { number: 10, hash: '0x10', timestamp: 10000 } },
          ],
          finalizedHead: { number: 20, hash: '0x20' },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          finalizedHead: { number: 20, hash: '0x20' },
        },
      ])

      const adapter = await sqliteCacheAdapter({ path: DB_PATH })

      const stream = createEvmPortalSource({
        portal: mockPortal.url,
        query: { from: 6, to: 10 },
        cache: { adapter },
      }).pipe(blockTransformer())

      await readAllChunks(stream) // first pass to store data

      // now request from 0 to 5, should not reuse data from 6 to 10
      const stream2 = createEvmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 5 },
        cache: { adapter },
      }).pipe(blockTransformer())

      const res2 = (await readAllChunks(stream2)).map(transformBatch)

      expect(res2).toMatchInlineSnapshot(`
        [
          {
            "data": [
              {
                "hash": "0x1",
                "number": 1,
                "timestamp": 1000,
              },
              {
                "hash": "0x2",
                "number": 2,
                "timestamp": 2000,
              },
              {
                "hash": "0x3",
                "number": 3,
                "timestamp": 3000,
              },
              {
                "hash": "0x4",
                "number": 4,
                "timestamp": 4000,
              },
              {
                "hash": "0x5",
                "number": 5,
                "timestamp": 5000,
              },
            ],
            "meta": {
              "head": {
                "finalized": {
                  "hash": "0x20",
                  "number": 20,
                },
                "unfinalized": undefined,
              },
              "meta": {
                "bytesSize": 265,
              },
              "query": {
                "hash": "2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a",
                "raw": {
                  "fields": {},
                  "fromBlock": 0,
                  "parentBlockHash": undefined,
                  "toBlock": 5,
                  "type": "evm",
                },
              },
              "state": {
                "current": {
                  "hash": "0x5",
                  "number": 5,
                  "timestamp": 5000,
                },
                "initial": 0,
                "last": 5,
                "rollbackChain": [],
              },
            },
          },
        ]
      `)

      // check stored rows by query hash
      const rows = await readAllChunks(
        adapter.stream({
          queryHash: '2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a',
          fromBlock: 1,
        }),
      )

      expect(rows).toHaveLength(2)
    })

    it('should exclude unfinalized blocks', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          finalizedHead: { number: 2, hash: '0x2' },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          finalizedHead: { number: 5, hash: '0x5' },
        },
      ])

      const adapter = await sqliteCacheAdapter({ path: DB_PATH })

      const stream = createEvmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 5 },
        cache: { adapter },
      }).pipe(blockTransformer())

      const res1 = (await readAllChunks(stream)).map(transformBatch)
      const res2 = (await readAllChunks(stream)).map(transformBatch)

      expect(res1).toMatchInlineSnapshot(`
        [
          {
            "data": [
              {
                "hash": "0x1",
                "number": 1,
                "timestamp": 1000,
              },
              {
                "hash": "0x2",
                "number": 2,
                "timestamp": 2000,
              },
              {
                "hash": "0x3",
                "number": 3,
                "timestamp": 3000,
              },
              {
                "hash": "0x4",
                "number": 4,
                "timestamp": 4000,
              },
              {
                "hash": "0x5",
                "number": 5,
                "timestamp": 5000,
              },
            ],
            "meta": {
              "head": {
                "finalized": {
                  "hash": "0x2",
                  "number": 2,
                },
                "unfinalized": undefined,
              },
              "meta": {
                "bytesSize": 265,
              },
              "query": {
                "hash": "2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a",
                "raw": {
                  "fields": {},
                  "fromBlock": 0,
                  "parentBlockHash": undefined,
                  "toBlock": 5,
                  "type": "evm",
                },
              },
              "state": {
                "current": {
                  "hash": "0x5",
                  "number": 5,
                  "timestamp": 5000,
                },
                "initial": 0,
                "last": 5,
                "rollbackChain": [
                  {
                    "hash": "0x2",
                    "number": 2,
                    "timestamp": 2000,
                  },
                  {
                    "hash": "0x3",
                    "number": 3,
                    "timestamp": 3000,
                  },
                  {
                    "hash": "0x4",
                    "number": 4,
                    "timestamp": 4000,
                  },
                  {
                    "hash": "0x5",
                    "number": 5,
                    "timestamp": 5000,
                  },
                ],
              },
            },
          },
        ]
      `)
      expect(res2).toMatchInlineSnapshot(`
        [
          {
            "data": [
              {
                "hash": "0x1",
                "number": 1,
                "timestamp": 1000,
              },
              {
                "hash": "0x2",
                "number": 2,
                "timestamp": 2000,
              },
            ],
            "meta": {
              "head": {
                "finalized": {
                  "hash": "0x2",
                  "number": 2,
                },
                "unfinalized": undefined,
              },
              "meta": {
                "bytesSize": 265,
              },
              "query": {
                "hash": "2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a",
                "raw": {
                  "fields": {},
                  "fromBlock": 0,
                  "parentBlockHash": undefined,
                  "toBlock": 5,
                  "type": "evm",
                },
              },
              "state": {
                "current": {
                  "hash": "0x2",
                  "number": 2,
                  "timestamp": 2000,
                },
                "initial": 0,
                "last": 5,
                "rollbackChain": [
                  {
                    "hash": "0x2",
                    "number": 2,
                    "timestamp": 2000,
                  },
                ],
              },
            },
          },
          {
            "data": [
              {
                "hash": "0x3",
                "number": 3,
                "timestamp": 3000,
              },
              {
                "hash": "0x4",
                "number": 4,
                "timestamp": 4000,
              },
              {
                "hash": "0x5",
                "number": 5,
                "timestamp": 5000,
              },
            ],
            "meta": {
              "head": {
                "finalized": {
                  "hash": "0x5",
                  "number": 5,
                },
                "unfinalized": undefined,
              },
              "meta": {
                "bytesSize": 159,
              },
              "query": {
                "hash": "2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a",
                "raw": {
                  "fields": {},
                  "fromBlock": 0,
                  "parentBlockHash": undefined,
                  "toBlock": 5,
                  "type": "evm",
                },
              },
              "state": {
                "current": {
                  "hash": "0x5",
                  "number": 5,
                  "timestamp": 5000,
                },
                "initial": 0,
                "last": 5,
                "rollbackChain": [
                  {
                    "hash": "0x5",
                    "number": 5,
                    "timestamp": 5000,
                  },
                ],
              },
            },
          },
        ]
      `)

      // check stored rows by query hash
      const rows = await readAllChunks(
        adapter.stream({
          queryHash: '2c0bdec7ab51d431cd1d70c122cb49146bf48fd434f0f6b6d162abf7926c486a',
          fromBlock: 1,
        }),
      )

      expect(rows).toHaveLength(2)
    })
  })
})
