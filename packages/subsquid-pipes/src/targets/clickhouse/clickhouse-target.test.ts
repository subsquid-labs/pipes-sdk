import { createClient } from '@clickhouse/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createEvmPortalSource } from '~/evm/index.js'
import { blockQuery, blockTransformer, closeMockPortal, createMockPortal, MockPortal } from '~/tests/index.js'

import { createClickhouseTarget } from './clickouse-target.js'

const client = createClient({
  url: process.env['TEST_CLICKHOUSE_URL'] || 'http://localhost:10123',
  username: process.env['TEST_CLICKHOUSE_USERNAME'] || 'default',
  password: process.env['TEST_CLICKHOUSE_PASSWORD'] || 'default',
  clickhouse_settings: {
    date_time_output_format: 'iso',
  },
})

async function getAllFromSyncTable() {
  const res = await client.query({
    query: 'SELECT * EXCEPT timestamp FROM sync FINAL ORDER BY timestamp ASC',
    format: 'JSONEachRow',
  })
  return await res.json()
}

describe('Clickhouse state', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
    await client.close()
  })

  beforeEach(async () => {
    // Ensure DB is empty before each test
    await client.query({ query: 'DROP DATABASE IF EXISTS default SYNC' })
    await client.query({ query: 'CREATE DATABASE default' })
  })

  describe('progress table', () => {
    it('should store unfinalized blocks to the lastest offset', async () => {
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

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 0, to: 5 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            settings: {
              table: 'sync',
            },
            onData: () => {},
          }),
        )

      const data = await getAllFromSyncTable()
      expect(data).toMatchInlineSnapshot(`
        [
          {
            "current": "{"number":5,"hash":"0x5","timestamp":5000}",
            "finalized": "{"hash":"0x2","number":2}",
            "id": "stream",
            "rollback_chain": "[{"number":2,"hash":"0x2","timestamp":2000},{"number":3,"hash":"0x3","timestamp":3000},{"number":4,"hash":"0x4","timestamp":4000},{"number":5,"hash":"0x5","timestamp":5000}]",
            "sign": 1,
          },
        ]
      `)
    })

    it('should keep 10,000 rows in status table by default', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
          finalizedHead: { number: 1000, hash: '0x1000' },
        },
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x2', timestamp: 2000 } }],
          finalizedHead: { number: 1000, hash: '0x1000' },
        },
        {
          statusCode: 200,
          data: [{ header: { number: 3, hash: '0x3', timestamp: 3000 } }],
          finalizedHead: { number: 1000, hash: '0x1000' },
        },
      ])

      await createEvmPortalSource({
        portal: {
          url: mockPortal.url,
          // we need to save each response separately
          // to create multiple rows in the status table,
          // so, we set minBytes to 1 to avoid batching
          minBytes: 1,
        },
        query: blockQuery({ from: 0, to: 3 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            settings: {
              table: 'sync',
            },
            onData: () => {},
          }),
        )

      const data = await getAllFromSyncTable()
      expect(data).toMatchInlineSnapshot(`
        [
          {
            "current": "{"number":1,"hash":"0x1","timestamp":1000}",
            "finalized": "{"hash":"0x1000","number":1000}",
            "id": "stream",
            "rollback_chain": "[]",
            "sign": 1,
          },
          {
            "current": "{"number":2,"hash":"0x2","timestamp":2000}",
            "finalized": "{"hash":"0x1000","number":1000}",
            "id": "stream",
            "rollback_chain": "[]",
            "sign": 1,
          },
          {
            "current": "{"number":3,"hash":"0x3","timestamp":3000}",
            "finalized": "{"hash":"0x1000","number":1000}",
            "id": "stream",
            "rollback_chain": "[]",
            "sign": 1,
          },
        ]
      `)
    })

    it('should keep only 1 row in status table', async () => {
      mockPortal = await createMockPortal([
        { statusCode: 200, data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }] },
        { statusCode: 200, data: [{ header: { number: 2, hash: '0x2', timestamp: 2000 } }] },
        { statusCode: 200, data: [{ header: { number: 3, hash: '0x3', timestamp: 3000 } }] },
      ])

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 0, to: 3 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            settings: {
              table: 'sync',
              maxRows: 1,
            },
            onData: () => {},
          }),
        )

      const data = await getAllFromSyncTable()
      expect(data).toMatchInlineSnapshot(`
        [
          {
            "current": "{"number":3,"hash":"0x3","timestamp":3000}",
            "finalized": "",
            "id": "stream",
            "rollback_chain": "[]",
            "sign": 1,
          },
        ]
      `)
    })

    it('should not store chain continuity if finalized head doesnt exist', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        },
      ])

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 0, to: 1 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            settings: { table: 'sync' },
            onData: () => {},
          }),
        )

      const data = await getAllFromSyncTable()
      expect(data).toMatchInlineSnapshot(`
        [
          {
            "current": "{"number":1,"hash":"0x1","timestamp":1000}",
            "finalized": "",
            "id": "stream",
            "rollback_chain": "[]",
            "sign": 1,
          },
        ]
      `)
    })

    it('should continue from the last block after stop', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [{ header: { number: 1, hash: '0x1', timestamp: 1000 } }],
        },
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x2', timestamp: 1000 } }],
          validateRequest: (req) => {
            expect(req).toMatchObject({
              type: 'evm',
              fromBlock: 2,
              fields: {},
              parentBlockHash: '0x1',
            })
          },
        },
      ])

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 0, to: 1 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            onData: () => {},
          }),
        )

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 1, to: 2 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            onData: () => {},
          }),
        )
    })
  })

  describe('forks', () => {
    beforeEach(async () => {
      await client.query({ query: 'DROP TABLE IF EXISTS test' })
      await client.query({
        query: `
            CREATE TABLE IF NOT EXISTS test
            (
                block_number     Int32,
                block_hash       String,
                sign             Int8
            ) ENGINE = CollapsingMergeTree(sign)
            ORDER BY (block_number, block_hash)
        `,
      })
    })

    it('should handle simple fork', async () => {
      mockPortal = await createMockPortal([
        {
          // 1. The First response is okay, it gets 5 blocks
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1' } },
            { header: { number: 2, hash: '0x2' } },
            { header: { number: 3, hash: '0x3' } },
            { header: { number: 4, hash: '0x4' } },
            { header: { number: 5, hash: '0x5' } },
          ],
          finalizedHead: {
            number: 1,
            hash: '0x1',
          },
        },

        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              // Unforked blocks
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              // Forked blocks
              { number: 4, hash: '0x4-1' },
              { number: 5, hash: '0x5-1' },
            ],
          },
          validateRequest: (req) => {
            // Request should include block 6 and hash for the previous block
            expect(req).toMatchInlineSnapshot(`
              {
                "fields": {
                  "block": {
                    "hash": true,
                    "number": true,
                  },
                },
                "fromBlock": 6,
                "parentBlockHash": "0x5",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a' } },
            { header: { number: 5, hash: '0x5a' } },
            { header: { number: 6, hash: '0x6a' } },
            { header: { number: 7, hash: '0x7a' } },
          ],
          validateRequest: (req) => {
            /**
             * Request should include block 4 and hash for the last unforked block
             * which is 3 in that test
             */
            expect(req).toMatchInlineSnapshot(`
              {
                "fields": {
                  "block": {
                    "hash": true,
                    "number": true,
                  },
                },
                "fromBlock": 4,
                "parentBlockHash": "0x3",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
      ])

      let rollbackCalls = 0
      await createEvmPortalSource({
        portal: mockPortal.url,
        query: { from: 0, to: 7 },
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            onData: async ({ store, data }) => {
              await store.insert({
                table: 'test',
                values: data.map((b) => ({
                  block_number: b.number,
                  block_hash: b.hash,
                  sign: 1,
                })),
                format: 'JSONEachRow',
              })
            },
            onRollback: async ({ type, store, cursor }) => {
              rollbackCalls++
              expect(cursor).toMatchObject({ number: 3, hash: '0x3' })
              await store.removeAllRows({
                tables: 'test',
                where: `block_number > {latest:UInt32}`,
                params: { latest: cursor.number },
              })
            },
          }),
        )

      expect(rollbackCalls).toEqual(1)

      const res = await client.query({
        query: 'SELECT * FROM test FINAL ORDER BY block_number ASC',
        format: 'JSONEachRow',
      })
      const data = await res.json()

      expect(data).toMatchInlineSnapshot(`
          [
            {
              "block_hash": "0x1",
              "block_number": 1,
              "sign": 1,
            },
            {
              "block_hash": "0x2",
              "block_number": 2,
              "sign": 1,
            },
            {
              "block_hash": "0x3",
              "block_number": 3,
              "sign": 1,
            },
            {
              "block_hash": "0x4a",
              "block_number": 4,
              "sign": 1,
            },
            {
              "block_hash": "0x5a",
              "block_number": 5,
              "sign": 1,
            },
            {
              "block_hash": "0x6a",
              "block_number": 6,
              "sign": 1,
            },
            {
              "block_hash": "0x7a",
              "block_number": 7,
              "sign": 1,
            },
          ]
        `)
    })

    it('should handle fork up to last finalized block', async () => {
      mockPortal = await createMockPortal([
        {
          // 1. The First response is okay, it gets 5 blocks
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1' } },
            { header: { number: 2, hash: '0x2' } },
            { header: { number: 3, hash: '0x3' } },
            { header: { number: 4, hash: '0x4' } },
            { header: { number: 5, hash: '0x5' } },
          ],
          finalizedHead: { number: 1, hash: '0x1' },
        },
        {
          // 2. A deep reorg happens
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              // Forked blocks
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [{ header: { number: 2, hash: '0x2a' } }, { header: { number: 3, hash: '0x3a' } }],
          finalizedHead: { number: 2, hash: '0x2a' },
        },
        // we mock 2 responses here as the first will fail
        ...new Array(2).fill({
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a' } },
            { header: { number: 5, hash: '0x5a' } },
            { header: { number: 6, hash: '0x6a' } },
            { header: { number: 7, hash: '0x7a' } },
          ],
          finalizedHead: { number: 4, hash: '0x4a' },
          validateRequest: (req: any) => {
            expect(req).toMatchObject({
              type: 'evm',
              fromBlock: 4,
              parentBlockHash: '0x3a',
            })
          },
        }),
      ])

      let finished = false
      let crashes = 0

      while (!finished) {
        try {
          await createEvmPortalSource({
            portal: mockPortal.url,
            query: { from: 0, to: 7 },
          })
            .pipe(blockTransformer())
            .pipeTo(
              createClickhouseTarget({
                client,
                onData: async ({ data }) => {
                  if (data[0].hash === '0x4-1' && crashes === 0) {
                    throw new Error('process failed')
                  }
                  finished = true
                },
                onRollback: async ({ store, cursor }) => {
                  await store.removeAllRows({
                    tables: 'test',
                    where: `block_number > {latest:UInt32}`,
                    params: { latest: cursor.number },
                  })
                },
              }),
            )
        } catch (error) {
          if (error instanceof Error && error.message === 'process failed') {
            crashes++
          } else {
            throw error
          }
        }
      }

      const data = await getAllFromSyncTable()
      expect(data).toMatchInlineSnapshot(`
        [
          {
            "current": "{"number":5,"hash":"0x5"}",
            "finalized": "{"hash":"0x1","number":1}",
            "id": "stream",
            "rollback_chain": "[{"number":1,"hash":"0x1"},{"number":2,"hash":"0x2"},{"number":3,"hash":"0x3"},{"number":4,"hash":"0x4"},{"number":5,"hash":"0x5"}]",
            "sign": 1,
          },
          {
            "current": "{"number":7,"hash":"0x7a"}",
            "finalized": "{"hash":"0x4a","number":4}",
            "id": "stream",
            "rollback_chain": "[{"number":4,"hash":"0x4a"},{"number":5,"hash":"0x5a"},{"number":6,"hash":"0x6a"},{"number":7,"hash":"0x7a"}]",
            "sign": 1,
          },
        ]
      `)
    })

    it('should handle deep fork', async () => {
      mockPortal = await createMockPortal([
        {
          // 1. The First response is okay, it gets 5 blocks
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          finalizedHead: {
            number: 1,
            hash: '0x1',
          },
        },

        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
          validateRequest: (req) => {
            // Request should include block 6 and hash for the previous block
            expect(req).toMatchInlineSnapshot(`
              {
                "fields": {
                  "block": {
                    "hash": true,
                    "number": true,
                    "timestamp": true,
                  },
                },
                "fromBlock": 6,
                "parentBlockHash": "0x5",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
          },
          validateRequest: (req) => {
            // Request should include block 6 and hash for the previous block
            expect(req).toMatchInlineSnapshot(`
              {
                "fields": {
                  "block": {
                    "hash": true,
                    "number": true,
                    "timestamp": true,
                  },
                },
                "fromBlock": 4,
                "parentBlockHash": "0x3",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2a', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3a', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
          ],
          validateRequest: (req) => {
            /**
             * Request should include block 4 and hash for the last unforked block
             * which is 3 in that test
             */
            expect(req).toMatchInlineSnapshot(`
              {
                "fields": {
                  "block": {
                    "hash": true,
                    "number": true,
                    "timestamp": true,
                  },
                },
                "fromBlock": 2,
                "parentBlockHash": "0x1",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
      ])

      let rollbackCalls = 0

      await createEvmPortalSource({
        portal: mockPortal.url,
        query: blockQuery({ from: 0, to: 7 }),
      })
        .pipe(blockTransformer())
        .pipeTo(
          createClickhouseTarget({
            client,
            onData: async ({ store, data }) => {
              await store.insert({
                table: 'test',
                values: data.map((b) => ({
                  block_number: b.number,
                  timestamp: b.timestamp,
                  block_hash: b.hash,
                  sign: 1,
                })),
                format: 'JSONEachRow',
              })
            },
            onRollback: async ({ type, store, cursor }) => {
              if (rollbackCalls === 0) {
                expect(cursor).toMatchObject({ number: 3, hash: '0x3' })
              } else {
                expect(cursor).toMatchObject({ number: 1, hash: '0x1' })
              }

              rollbackCalls++
              await store.removeAllRows({
                tables: 'test',
                where: `block_number > {latest:UInt32}`,
                params: { latest: cursor.number },
              })
            },
          }),
        )

      const res = await client.query({
        query: 'SELECT * FROM test FINAL ORDER BY block_number ASC',
        format: 'JSONEachRow',
      })
      const data = await res.json()

      expect(data).toMatchInlineSnapshot(`
        [
          {
            "block_hash": "0x1",
            "block_number": 1,
            "sign": 1,
          },
          {
            "block_hash": "0x2a",
            "block_number": 2,
            "sign": 1,
          },
          {
            "block_hash": "0x3a",
            "block_number": 3,
            "sign": 1,
          },
          {
            "block_hash": "0x4a",
            "block_number": 4,
            "sign": 1,
          },
          {
            "block_hash": "0x5a",
            "block_number": 5,
            "sign": 1,
          },
          {
            "block_hash": "0x6a",
            "block_number": 6,
            "sign": 1,
          },
          {
            "block_hash": "0x7a",
            "block_number": 7,
            "sign": 1,
          },
        ]
      `)
    })
  })
})
