import fs from 'node:fs/promises'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { PortalBatch } from '../core/portal-source'
import { createEvmPortalSource } from '../evm'
import { blockTransformer, closeMockPortal, createMockPortal, MockPortal } from '../tests'
import { sqliteCacheAdapter } from './adapters/sqlite'

// Transform batch to only include data and meta without any functions or complex objects
const transformBatch = ({
  data,
  ctx: {
    head,
    query,
    bytes,
    state,
    // do not include it in the test
    metrics,
    logger,
    profiler,
  },
}: PortalBatch) => ({ data, meta: { head, query, bytes, state } })

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
          finalizedHead: { number: 2, hash: '0x2' },
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
              "bytes": 265,
              "head": {
                "finalized": {
                  "hash": "0x2",
                  "number": 2,
                },
                "unfinalized": undefined,
              },
              "query": {
                "hash": "87052be918a68207740211f7eb8c2725",
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

      // check stored rows by query hash
      const rows = await readAllChunks(
        adapter.stream({
          queryHash: '87052be918a68207740211f7eb8c2725',
          cursor: { number: 0 },
        }),
      )

      expect(rows).toHaveLength(1)
    })
  })
})
