import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/node-postgres'
import { integer, pgTable, varchar } from 'drizzle-orm/pg-core'
import { Pool, QueryResultRow } from 'pg'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalSource } from '~/evm/index.js'
import { MockPortal, MockResponse, blockDecoder, closeMockPortal, createMockPortal } from '~/testing/index.js'

import { drizzleTarget } from './index.js'

const dsnUrl = process.env['TEST_POSTGRES_DSN'] || `postgresql://postgres:postgres@localhost:5432/postgres`
const pool = new Pool({
  connectionString: dsnUrl,
})

async function execute<T extends QueryResultRow>(query: string, params: any[] = []) {
  const client = await pool.connect()
  const res = await client.query<T>(query, params)
  client.release()

  return res
}

async function getAllFromSyncTable(schema = 'public') {
  const res = await execute(`SELECT * FROM "${schema}"."sync" ORDER BY current_number ASC`)

  return res.rows
}

describe('Drizzle target', () => {
  let mockPortal: MockPortal
  const db = drizzle(pool)

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })
  afterAll(async () => {
    await pool.end()
  })

  describe('common', () => {
    const testTable = pgTable('test', {
      id: integer().primaryKey(),
    })

    beforeEach(async () => {
      await execute(`
        DROP SCHEMA IF EXISTS "public" CASCADE;
        CREATE SCHEMA IF NOT EXISTS "public";
      `)
    })

    it('should throw an error if table is not tracked', async () => {
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
          head: { finalized: { number: 2, hash: '0x2' } },
        },
      ])

      await expect(async () => {
        await evmPortalSource({
          id: 'test',
          portal: mockPortal.url,
          outputs: blockDecoder({ from: 0, to: 5 }),
        }).pipeTo(
          drizzleTarget({
            db,
            tables: [],
            onData: async ({ tx }) => {
              await tx.insert(testTable).values({ id: 1 })
            },
          }),
        )
      }).rejects.toThrow('Table "test" is not tracked for rollbacks')
    })
  })

  describe('state manager', () => {
    beforeEach(async () => {
      await execute(`
        DROP SCHEMA IF EXISTS "test" CASCADE; 
        CREATE SCHEMA IF NOT EXISTS "test";
      `)
    })

    it('should save state to custom schema', async () => {
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
          head: { finalized: { number: 2, hash: '0x2' } },
        },
      ])

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 5 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [],
          settings: { state: { schema: 'test' } },
          onData: async () => {},
        }),
      )

      const rows = await getAllFromSyncTable('test')
      expect(rows).toMatchInlineSnapshot(`
        [
          {
            "current_hash": "0x3",
            "current_number": "3",
            "current_timestamp": 1970-01-01T00:50:00.000Z,
            "finalized": {
              "hash": "0x2",
              "number": 2,
            },
            "id": "stream",
            "rollback_chain": [
              {
                "hash": "0x3",
                "number": 3,
                "timestamp": 3000,
              },
            ],
          },
          {
            "current_hash": "0x4",
            "current_number": "4",
            "current_timestamp": 1970-01-01T01:06:40.000Z,
            "finalized": {
              "hash": "0x2",
              "number": 2,
            },
            "id": "stream",
            "rollback_chain": [
              {
                "hash": "0x4",
                "number": 4,
                "timestamp": 4000,
              },
            ],
          },
          {
            "current_hash": "0x5",
            "current_number": "5",
            "current_timestamp": 1970-01-01T01:23:20.000Z,
            "finalized": {
              "hash": "0x2",
              "number": 2,
            },
            "id": "stream",
            "rollback_chain": [
              {
                "hash": "0x5",
                "number": 5,
                "timestamp": 5000,
              },
            ],
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

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 1 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [],
          settings: {
            state: { schema: 'test' },
          },
          onData: async () => {},
        }),
      )

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 1, to: 2 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [],
          settings: { state: { schema: 'test' } },
          onData: async () => {},
        }),
      )
    })
  })

  describe('forks', () => {
    const testTable = pgTable('test', {
      block_number: integer().primaryKey(),
      block_hash: varchar().notNull(),
      data: varchar().default(''),
    })

    beforeEach(async () => {
      await execute(`
        DROP SCHEMA IF EXISTS "public" CASCADE;       
        CREATE SCHEMA IF NOT EXISTS "public";
        CREATE TABLE IF NOT EXISTS test
          (
             block_number numeric,
             block_hash   text,
             data         text DEFAULT '',
             CONSTRAINT "test_pk" PRIMARY KEY("block_number")
          );
       `)
    })

    it('should handle simple fork', async () => {
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
          head: {
            finalized: {
              number: 1,
              hash: '0x1',
            },
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
          statusCode: 200,
          data: [
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
                "fromBlock": 4,
                "parentBlockHash": "0x3",
                "toBlock": 7,
                "type": "evm",
              }
            `)
          },
        },
      ])

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [testTable],
          onBeforeRollback: () => {
            // throw new Error('STOP')
          },
          onData: async ({ tx, data }) => {
            await tx.insert(testTable).values(
              data.map((b) => ({
                block_number: b.number,
                block_hash: b.hash,
              })),
            )
          },
        }),
      )

      const res = await db.select().from(testTable).orderBy(testTable.block_number)
      expect(res).toMatchInlineSnapshot(`
        [
          {
            "block_hash": "0x1",
            "block_number": 1,
            "data": "",
          },
          {
            "block_hash": "0x2",
            "block_number": 2,
            "data": "",
          },
          {
            "block_hash": "0x3",
            "block_number": 3,
            "data": "",
          },
          {
            "block_hash": "0x4a",
            "block_number": 4,
            "data": "",
          },
          {
            "block_hash": "0x5a",
            "block_number": 5,
            "data": "",
          },
          {
            "block_hash": "0x6a",
            "block_number": 6,
            "data": "",
          },
          {
            "block_hash": "0x7a",
            "block_number": 7,
            "data": "",
          },
        ]
      `)
    })

    it('should rollback updates', async () => {
      mockPortal = await createMockPortal([
        ...new Array(4).fill(null).map((_, i): MockResponse => {
          const block = i + 1
          return {
            // 1. The First response is okay, it gets 5 blocks
            statusCode: 200,
            data: [{ header: { number: block, hash: `0x${block}`, timestamp: block * 1000 } }],
            head: {
              finalized: {
                number: 1,
                hash: '0x1',
              },
            },
          }
        }),

        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              // Unforked blocks
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              // Forked blocks
              { number: 4, hash: '0x4a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
          ],
        },
      ])

      let callCount = 0

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 5 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [testTable],
          onData: async ({ tx, data }) => {
            for (const item of data) {
              await tx
                .insert(testTable)
                .values({
                  block_number: -1,
                  block_hash: 'test',
                })
                .onConflictDoUpdate({
                  target: testTable.block_number,
                  set: {
                    data: JSON.stringify(item),
                  },
                })
            }
          },
          onBeforeRollback: () => {
            // throw new Error('STOP')
          },
          onAfterRollback: async ({ tx, cursor }) => {
            callCount++
            const [row] = await tx.select().from(testTable).where(eq(testTable.block_number, -1))

            expect(cursor.number).toEqual(3)
            expect(cursor.hash).toEqual('0x3')
            expect(JSON.parse(row?.data || '')).toMatchObject(cursor)
          },
        }),
      )

      expect(callCount).toEqual(1)

      const res = await db.select().from(testTable).orderBy(testTable.block_number)
      expect(res).toMatchInlineSnapshot(`
        [
          {
            "block_hash": "test",
            "block_number": -1,
            "data": "{"number":5,"hash":"0x5a","timestamp":5000}",
          },
        ]
      `)
    })

    it('should rollback deletes', async () => {
      mockPortal = await createMockPortal([
        ...new Array(4).fill(null).map((_, i): MockResponse => {
          const block = i + 1
          return {
            // 1. The First response is okay, it gets 5 blocks
            statusCode: 200,
            data: [{ header: { number: block, hash: `0x${block}`, timestamp: block * 1000 } }],
            head: {
              finalized: {
                number: 1,
                hash: '0x1',
              },
            },
          }
        }),

        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              // Unforked blocks
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              // Forked blocks
              { number: 4, hash: '0x4a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
          ],
        },
      ])

      let callCount = 0
      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 5 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [testTable],
          onData: async ({ tx, data }) => {
            for (const item of data) {
              // Rollback happens to block 3
              if (item.number === 3) {
                await tx.delete(testTable).where(eq(testTable.block_number, -1))
              } else {
                await tx
                  .insert(testTable)
                  .values({
                    block_number: -1,
                    block_hash: 'test',
                  })
                  .onConflictDoUpdate({
                    target: testTable.block_number,
                    set: {
                      data: JSON.stringify(item),
                    },
                  })
              }
            }
          },
          onBeforeRollback: async () => {
            // throw new Error(`STOP`)
          },
          onAfterRollback: async ({ tx, cursor }) => {
            callCount++
            const rows = await tx.select().from(testTable).where(eq(testTable.block_number, -1))

            expect(cursor.number).toEqual(3)
            expect(cursor.hash).toEqual('0x3')
            expect(rows).toHaveLength(0)
          },
        }),
      )

      expect(callCount).toEqual(1)

      const res = await db.select().from(testTable).orderBy(testTable.block_number)
      expect(res).toMatchInlineSnapshot(`
        [
          {
            "block_hash": "test",
            "block_number": -1,
            "data": "{"number":5,"hash":"0x5a","timestamp":5000}",
          },
        ]
      `)
    })
  })

  describe('forks on tables with foreign keys', () => {
    const parentTable = pgTable('parent', {
      id: integer().primaryKey(),
      text: varchar().notNull(),
    })
    const childTable = pgTable('child', {
      id: integer().primaryKey(),
      text: varchar().notNull(),
      parent_id: integer().references(() => parentTable.id),
    })

    beforeEach(async () => {
      await execute(`
        DROP SCHEMA IF EXISTS "public" CASCADE;       
        CREATE SCHEMA IF NOT EXISTS "public";
        CREATE TABLE parent (
          id SERIAL PRIMARY KEY,
          text TEXT NOT NULL
        );

        -- Child table
        CREATE TABLE child (
            id SERIAL PRIMARY KEY,
            parent_id INT NOT NULL REFERENCES parent(id),
            text TEXT NOT NULL
        );
     `)
    })

    it('should remove child entity first', async () => {
      mockPortal = await createMockPortal([
        ...new Array(4).fill(null).map((_, i): MockResponse => {
          const block = i + 1
          return {
            // 1. The First response is okay, it gets 5 blocks
            statusCode: 200,
            data: [{ header: { number: block, hash: `0x${block}`, timestamp: block * 1000 } }],
            head: {
              finalized: {
                number: 1,
                hash: '0x1',
              },
            },
          }
        }),

        {
          // 2. A reorg for 2 blocks happens
          statusCode: 409,
          data: {
            previousBlocks: [
              // Unforked blocks
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              // Forked blocks
              { number: 4, hash: '0x4a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
          ],
        },
      ])

      let callCount = 0

      await evmPortalSource({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 5 }),
      }).pipeTo(
        drizzleTarget({
          db,
          tables: [
            /*
             * We deliberately put child after parent to test FK constraints
             */
            parentTable,
            childTable,
          ],
          onData: async ({ tx, data }) => {
            for (const item of data) {
              const [parent] = await tx
                .insert(parentTable)
                .values({
                  id: item.number,
                  text: item.hash,
                })
                .returning()

              await tx.insert(childTable).values({
                id: item.number,
                text: item.hash,
                parent_id: parent.id,
              })
            }
          },
          onAfterRollback: async () => {
            callCount++
          },
        }),
      )

      expect(callCount).toEqual(1)

      const childs = await db.select().from(childTable).orderBy(childTable.id)
      expect(childs).toMatchInlineSnapshot(`
        [
          {
            "id": 1,
            "parent_id": 1,
            "text": "0x1",
          },
          {
            "id": 2,
            "parent_id": 2,
            "text": "0x2",
          },
          {
            "id": 3,
            "parent_id": 3,
            "text": "0x3",
          },
          {
            "id": 4,
            "parent_id": 4,
            "text": "0x4a",
          },
          {
            "id": 5,
            "parent_id": 5,
            "text": "0x5a",
          },
        ]
      `)

      const parents = await db.select().from(parentTable).orderBy(parentTable.id)
      expect(parents).toMatchInlineSnapshot(`
        [
          {
            "id": 1,
            "text": "0x1",
          },
          {
            "id": 2,
            "text": "0x2",
          },
          {
            "id": 3,
            "text": "0x3",
          },
          {
            "id": 4,
            "text": "0x4a",
          },
          {
            "id": 5,
            "text": "0x5a",
          },
        ]
      `)
    })
  })
})
