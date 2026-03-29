import { afterEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { MockPortal, blockDecoder, createMockPortal } from '~/testing/index.js'

import { DeltaBatch, deltaDbTarget } from './delta-db-target.js'

// Simple schema: raw table of transfers + a MV that counts transfers per address
const SCHEMA = `
CREATE TABLE transfers (
  block_number UInt64 NOT NULL,
  hash String NOT NULL,
  amount Float64 NOT NULL,
  PRIMARY KEY (block_number, hash)
);

CREATE MATERIALIZED VIEW transfer_totals AS SELECT SUM(amount) AS total FROM transfers
`

describe('DeltaDb target', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await mockPortal?.close()
  })

  describe('basic ingestion', () => {
    it('should ingest multiple batches and accumulate state', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
          ],
          head: { finalized: { number: 1, hash: '0x2' } },
        },
      ])

      const batches: DeltaBatch[] = []

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 4 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: data.map((b) => ({
              block_number: b.number,
              hash: b.hash,
              amount: b.number * 10,
            })),
          }),
          onDelta: ({ batch }) => {
            batches.push(batch)
          },
        }),
      )

      // Each portal response triggers a separate ingest — one batch per HTTP chunk.
      expect(batches).toHaveLength(2)

      const [batch1, batch2] = batches

      // Batch 1: blocks 1 (finalized) + 2 (unfinalized). Total = 10+20 = 30.
      expect(batch1.tables['transfers']).toMatchInlineSnapshot(`
        [
          {
            "key": {
              "_row_index": 0,
              "block_number": 1,
            },
            "operation": "insert",
            "prevValues": null,
            "table": "transfers",
            "values": {
              "amount": 10,
              "block_number": 1,
              "hash": "0x1",
            },
          },
          {
            "key": {
              "_row_index": 0,
              "block_number": 2,
            },
            "operation": "insert",
            "prevValues": null,
            "table": "transfers",
            "values": {
              "amount": 20,
              "block_number": 2,
              "hash": "0x2",
            },
          },
        ]
      `)
      expect(batch1.tables['transfer_totals']).toMatchInlineSnapshot(`
        [
          {
            "key": {},
            "operation": "insert",
            "prevValues": null,
            "table": "transfer_totals",
            "values": {
              "total": 30,
            },
          },
        ]
      `)

      // Batch 2: blocks 3+4 (unfinalized). MV total advances from 30 to 100.
      expect(batch2.tables['transfers']).toMatchInlineSnapshot(`
        [
          {
            "key": {
              "_row_index": 0,
              "block_number": 3,
            },
            "operation": "insert",
            "prevValues": null,
            "table": "transfers",
            "values": {
              "amount": 30,
              "block_number": 3,
              "hash": "0x3",
            },
          },
          {
            "key": {
              "_row_index": 0,
              "block_number": 4,
            },
            "operation": "insert",
            "prevValues": null,
            "table": "transfers",
            "values": {
              "amount": 40,
              "block_number": 4,
              "hash": "0x4",
            },
          },
        ]
      `)
      expect(batch2.tables['transfer_totals']).toMatchInlineSnapshot(`
        [
          {
            "key": {},
            "operation": "update",
            "prevValues": {
              "total": 30,
            },
            "table": "transfer_totals",
            "values": {
              "total": 100,
            },
          },
        ]
      `)
    })
  })

  describe('forks', () => {
    it('should handle simple fork (409)', async () => {
      mockPortal = await createMockPortal([
        {
          // Ingest 5 blocks
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // 2-block reorg: blocks 4+5 replaced
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
          ],
          head: { finalized: { number: 3, hash: '0x3' } },
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 4, parentBlockHash: '0x3' })
          },
        },
      ])

      const allBatches: any[] = []
      let rollbackBatchIndex = -1

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 6 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({
              block_number: b.number,
              hash: b.hash,
              amount: b.number,
            })),
          }),
          onDelta: ({ batch }) => {
            if (rollbackBatchIndex === -1 && batch.tables['transfers']?.some((r: any) => r.operation === 'delete')) {
              rollbackBatchIndex = allBatches.length
            }
            allBatches.push(batch)
          },
        }),
      )

      // Rollback batch must have been emitted (compensating deletes for blocks 4+5)
      expect(rollbackBatchIndex).toBeGreaterThan(-1)
      const rollbackBatch = allBatches[rollbackBatchIndex]
      const deletedBlockNumbers = rollbackBatch.tables['transfers']
        .filter((r: any) => r.operation === 'delete')
        .map((r: any) => r.key.block_number)
      expect(deletedBlockNumbers.sort()).toEqual([4, 5])

      // Post-fork batches: only look at inserts after the rollback batch
      const postForkInserts = allBatches
        .slice(rollbackBatchIndex + 1)
        .flatMap((b) => b.tables['transfers'] ?? [])
        .filter((r: any) => r.operation === 'insert')
        .map((r: any) => r.key.block_number)
      expect(postForkInserts.sort((a: number, b: number) => a - b)).toEqual([4, 5, 6])

      // Final head is block 6
      const lastBatch = allBatches.at(-1)
      expect(lastBatch.latestHead).toMatchObject({ number: 6, hash: '0x6a' })
    })

    it('should handle consecutive forks (two 409s in a row)', async () => {
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
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // First fork: roll back blocks 4+5
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 3, hash: '0x3' },
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          // Second fork: deeper rollback to block 1
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
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
          head: { finalized: { number: 4, hash: '0x4a' } },
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 2, parentBlockHash: '0x1' })
          },
        },
      ])

      let rollbackCount = 0
      const finalLatestHead = { number: 0, hash: '' }

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({
              block_number: b.number,
              hash: b.hash,
              amount: 1,
            })),
          }),
          onDelta: ({ batch }) => {
            const hasDeletes = Object.values(batch.tables).some((records: any) =>
              records.some((r: any) => r.operation === 'delete'),
            )
            if (hasDeletes) rollbackCount++
            if (batch.latestHead) {
              finalLatestHead.number = batch.latestHead.number
              finalLatestHead.hash = batch.latestHead.hash
            }
          },
        }),
      )

      // Two forks → two rollback batches
      expect(rollbackCount).toBe(2)
      expect(finalLatestHead).toMatchObject({ number: 7, hash: '0x7a' })
    })

    it('should not rollback when rollbackChain is empty (all blocks finalized)', async () => {
      // extractRollbackChain returns [] when all blocks in the batch are <= finalizedHead.
      // Issue 2: empty chain + finalizedHead not advancing above current_latest
      // must NOT trigger a spurious rollback inside ingest().
      mockPortal = await createMockPortal([
        {
          // Blocks 1-3, finalized immediately at 3
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
          ],
          head: { finalized: { number: 3, hash: '0x3' } },
        },
        {
          // Blocks 4-5 unfinalized (finalized still at 3) → rollbackChain=[4,5]
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 3, hash: '0x3' } },
        },
        {
          // Block 6 with finalized=6 — all blocks ≤ finalized → rollbackChain=[].
          // Advancing guard fires (6 > current_latest=5) so no rollback expected.
          statusCode: 200,
          data: [{ header: { number: 6, hash: '0x6', timestamp: 6000 } }],
          head: { finalized: { number: 6, hash: '0x6' } },
        },
        {
          // Block 7 with finalized still at 6 — rollbackChain=[7] (normal).
          // Then we send finalized=7 → rollbackChain=[] again (Issue 2 trigger:
          // finalizedHead=7 = current_latest=7, not advancing, empty chain).
          statusCode: 200,
          data: [{ header: { number: 7, hash: '0x7', timestamp: 7000 } }],
          head: { finalized: { number: 7, hash: '0x7' } },
        },
      ])

      const allBatches: any[] = []
      const rollbacks: any[] = []

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({
              block_number: b.number,
              hash: b.hash,
              amount: 1,
            })),
          }),
          onDelta: ({ batch }) => {
            allBatches.push(batch)
            if (Object.values(batch.tables).some((recs: any) => recs.some((r: any) => r.operation === 'delete'))) {
              rollbacks.push(batch)
            }
          },
        }),
      )

      // No spurious rollback — empty rollbackChain must never trigger fork detection
      expect(rollbacks).toHaveLength(0)

      // All 7 blocks ingested without gaps
      const allInserts = allBatches
        .flatMap((b) => b.tables['transfers'] ?? [])
        .filter((r: any) => r.operation === 'insert')
        .map((r: any) => r.key.block_number)
      expect(allInserts.sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7])

      expect(allBatches.at(-1)?.latestHead).toMatchObject({ number: 7, hash: '0x7' })
    })

    it('should handle fork at finalized boundary', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
          ],
          // Finalized at block 1 — blocks 1,2,3 all remain in rollback chain
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // Fork: rolls back to block 1 (the finalized block — lowest valid anchor)
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 2, hash: '0x2a', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3a', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
          ],
          head: { finalized: { number: 4, hash: '0x4a' } },
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 2, parentBlockHash: '0x1' })
          },
        },
      ])

      const forkCursors: any[] = []

      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 4 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({
              block_number: b.number,
              hash: b.hash,
              amount: 1,
            })),
          }),
          onDelta: ({ batch }) => {
            const hasDeletes = Object.values(batch.tables).some((records: any) =>
              records.some((r: any) => r.operation === 'delete'),
            )
            if (hasDeletes) {
              forkCursors.push(batch.latestHead ?? batch.finalizedHead)
            }
          },
        }),
      )

      // Rollback happened — fork cursor should be at block 1 (common ancestor)
      expect(forkCursors).toHaveLength(1)
    })
  })

  describe('fork edge cases (FORK_ISSUES)', () => {
    // Issue 3: resolve_fork_cursor must return HIGHEST common ancestor,
    // not fall back to the finalized anchor when a higher match exists.
    it('issue3: fork selects highest unfinalized ancestor, not finalized fallback', async () => {
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
          // finalized=2 — blocks 3,4,5 are unfinalized
          // to=7 so the stream continues past block 5 and triggers the 409
          head: { finalized: { number: 2, hash: '0x2' } },
        },
        {
          // Fork: blocks 4+5 replaced. Common ancestor is block 3 (unfinalized, above finalized=2).
          // If the resolver fell back to the finalized anchor (block 2), the next
          // request would incorrectly start from block 3 instead of block 4.
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' }, // highest common ancestor
              { number: 4, hash: '0x4a' },
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7', timestamp: 7000 } },
          ],
          head: { finalized: { number: 4, hash: '0x4a' } },
          // If fork cursor was block 2 (finalized fallback) this would be fromBlock=3
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 4, parentBlockHash: '0x3' })
          },
        },
      ])

      const allBatches: any[] = []
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({ block_number: b.number, hash: b.hash, amount: 1 })),
          }),
          onDelta: ({ batch }) => allBatches.push(batch),
        }),
      )

      const rollbackIdx = allBatches.findIndex((b) => b.tables['transfers']?.some((r: any) => r.operation === 'delete'))
      expect(rollbackIdx).toBeGreaterThan(-1)

      // Only blocks 4 and 5 must have been rolled back (not block 3)
      const deletedBlocks = allBatches[rollbackIdx].tables['transfers']
        .filter((r: any) => r.operation === 'delete')
        .map((r: any) => r.key.block_number)
        .sort((a: number, b: number) => a - b)
      expect(deletedBlocks).toEqual([4, 5])

      // Post-fork: only 4a,5a,6,7 re-inserted (block 3 preserved, not re-inserted)
      const postForkInserts = allBatches
        .slice(rollbackIdx + 1)
        .flatMap((b) => b.tables['transfers'] ?? [])
        .filter((r: any) => r.operation === 'insert')
        .map((r: any) => r.key.block_number)
        .sort((a: number, b: number) => a - b)
      expect(postForkInserts).toEqual([4, 5, 6, 7])
    })

    // Issue 4: after finalize(N), block hashes below N are pruned.
    // A 409 requesting a fork to a pre-finalized block has no common ancestor →
    // "Fork too deep". This is a protocol violation by the portal, but the engine
    // must handle it predictably (throw, not silently corrupt state).
    it('issue4: fork to pre-finalized block throws "Fork too deep"', async () => {
      mockPortal = await createMockPortal([
        {
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
          ],
          // finalized=3 — all blocks finalized, hashes below 3 are pruned.
          // to=5 so the stream continues past block 3 and reaches the 409.
          head: { finalized: { number: 3, hash: '0x3' } },
        },
        {
          // Fork to block 1 — but blocks 1,2 were pruned by finalize(3),
          // and block 3's hash doesn't match 0x3a → no common ancestor.
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2a' },
              { number: 3, hash: '0x3a' },
            ],
          },
        },
      ])

      const stream = evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 5 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({ block_number: b.number, hash: b.hash, amount: 1 })),
          }),
          onDelta: () => {},
        }),
      )

      await expect(stream).rejects.toThrow('Fork too deep')
    })

    // Issue 5: set_rollback_chain is additive — stale hashes from old batches
    // accumulate in block_hashes. After several advances with shrinking
    // rollbackChains, a fork must still resolve to the CORRECT (highest) ancestor.
    it('issue5: stale hashes from multi-batch advance do not cause wrong fork depth', async () => {
      mockPortal = await createMockPortal([
        {
          // Batch 1: blocks 1-5. rollbackChain = [2,3,4,5] (> finalized=1)
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 2, hash: '0x2', timestamp: 2000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 4, hash: '0x4', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // Batch 2: blocks 6-8. extractRollbackChain returns only [6,7,8].
          // Stale hashes for blocks 2-5 remain in block_hashes from batch 1.
          // to=10 so the stream continues past block 8 and reaches the 409.
          statusCode: 200,
          data: [
            { header: { number: 6, hash: '0x6', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7', timestamp: 7000 } },
            { header: { number: 8, hash: '0x8', timestamp: 8000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // Fork: new chain diverges at block 6. Common ancestor = block 5.
          // Stale hashes for 2,3,4 exist — resolver must pick 5 (highest match).
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 2, hash: '0x2' },
              { number: 3, hash: '0x3' },
              { number: 4, hash: '0x4' },
              { number: 5, hash: '0x5' }, // highest common ancestor
              { number: 6, hash: '0x6a' },
              { number: 7, hash: '0x7a' },
              { number: 8, hash: '0x8a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 6, hash: '0x6a', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7a', timestamp: 7000 } },
            { header: { number: 8, hash: '0x8a', timestamp: 8000 } },
            { header: { number: 9, hash: '0x9', timestamp: 9000 } },
            { header: { number: 10, hash: '0x10', timestamp: 10000 } },
          ],
          head: { finalized: { number: 5, hash: '0x5' } },
          // Correct anchor: block 5. Wrong (too deep): block 4, 3, 2, or 1.
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 6, parentBlockHash: '0x5' })
          },
        },
      ])

      const allBatches: any[] = []
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 10 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({ block_number: b.number, hash: b.hash, amount: 1 })),
          }),
          onDelta: ({ batch }) => allBatches.push(batch),
        }),
      )

      const rollbackIdx = allBatches.findIndex((b) => b.tables['transfers']?.some((r: any) => r.operation === 'delete'))
      expect(rollbackIdx).toBeGreaterThan(-1)

      // Only blocks 6,7,8 deleted (fork at 5, not deeper)
      const deletedBlocks = allBatches[rollbackIdx].tables['transfers']
        .filter((r: any) => r.operation === 'delete')
        .map((r: any) => r.key.block_number)
        .sort((a: number, b: number) => a - b)
      expect(deletedBlocks).toEqual([6, 7, 8])

      const postForkInserts = allBatches
        .slice(rollbackIdx + 1)
        .flatMap((b) => b.tables['transfers'] ?? [])
        .filter((r: any) => r.operation === 'insert')
        .map((r: any) => r.key.block_number)
        .sort((a: number, b: number) => a - b)
      expect(postForkInserts).toEqual([6, 7, 8, 9, 10])
    })

    // Issues 7+8: rollbackChain is sparse (only blocks with data, gaps between them).
    // A fork must find the nearest STORED ancestor, not over-rollback.
    it('issue7+8: sparse rollbackChain fork rolls back to nearest stored ancestor', async () => {
      mockPortal = await createMockPortal([
        {
          // Only blocks 1,3,5 have data (blocks 2,4 are empty — no transfers).
          // to=7 so the stream continues past block 5 and reaches the 409.
          statusCode: 200,
          data: [
            { header: { number: 1, hash: '0x1', timestamp: 1000 } },
            { header: { number: 3, hash: '0x3', timestamp: 3000 } },
            { header: { number: 5, hash: '0x5', timestamp: 5000 } },
          ],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          // Fork: new chain diverges after block 3.
          // Block 4 was never stored (sparse gap), but block 3 IS in block_hashes.
          // Nearest stored ancestor = block 3, NOT block 1.
          statusCode: 409,
          data: {
            previousBlocks: [
              { number: 1, hash: '0x1' },
              { number: 3, hash: '0x3' }, // stored ← common ancestor
              { number: 4, hash: '0x4a' }, // never stored (sparse gap)
              { number: 5, hash: '0x5a' },
            ],
          },
        },
        {
          statusCode: 200,
          data: [
            { header: { number: 4, hash: '0x4a', timestamp: 4000 } },
            { header: { number: 5, hash: '0x5a', timestamp: 5000 } },
            { header: { number: 6, hash: '0x6', timestamp: 6000 } },
            { header: { number: 7, hash: '0x7', timestamp: 7000 } },
          ],
          head: { finalized: { number: 3, hash: '0x3' } },
          // If fork was resolved to block 1 (over-rollback), fromBlock would be 2
          validateRequest: (req) => {
            expect(req).toMatchObject({ fromBlock: 4, parentBlockHash: '0x3' })
          },
        },
      ])

      const allBatches: any[] = []
      await evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: blockDecoder({ from: 0, to: 7 }),
      }).pipeTo(
        deltaDbTarget({
          schema: SCHEMA,
          transform: (data) => ({
            transfers: (data as any[]).map((b) => ({ block_number: b.number, hash: b.hash, amount: 1 })),
          }),
          onDelta: ({ batch }) => allBatches.push(batch),
        }),
      )

      const rollbackIdx = allBatches.findIndex((b) => b.tables['transfers']?.some((r: any) => r.operation === 'delete'))
      expect(rollbackIdx).toBeGreaterThan(-1)

      // Only block 5 deleted — blocks 1 and 3 preserved (not over-rolled-back)
      const deletedBlocks = allBatches[rollbackIdx].tables['transfers']
        .filter((r: any) => r.operation === 'delete')
        .map((r: any) => r.key.block_number)
      expect(deletedBlocks).toEqual([5])

      const postForkInserts = allBatches
        .slice(rollbackIdx + 1)
        .flatMap((b) => b.tables['transfers'] ?? [])
        .filter((r: any) => r.operation === 'insert')
        .map((r: any) => r.key.block_number)
        .sort((a: number, b: number) => a - b)
      expect(postForkInserts).toEqual([4, 5, 6, 7])
    })
  })
})
