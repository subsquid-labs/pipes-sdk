import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { type ParquetTable, parquetTarget } from '~/targets/parquet/index.js'
import { blockDecoder, testLogger } from '~/testing/index.js'

import { ChainLedger, buildChain } from './chain-ledger.js'
import { type LedgerPortal, ledgerPortal } from './ledger-portal.js'
import { parquetProbe } from './parquet-probe.js'
import { ReferenceModel } from './reference-model.js'
import { type DeliveredBatch, assertStructure, validateLinked, validateOrdered } from './validators.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

/** S1 — steady backfill over deep history against a healthy portal. */
const S1 = { from: 0, to: 49, batchSize: 5 }

/**
 * CT-1 — pipeline property tests: simulator ↔ oracle lockstep, structural validators, and a
 * quiescence diff of the sink store against the reference model.
 *
 * The comparison is taken at quiescence and never pins a free variable. Batch partitioning in
 * particular is the SUT's to choose, so the oracle is asked what the run must *commit*, not how it
 * must get there; that the partitioning itself is well-formed is a separate, structural check.
 */
describe('CT-1 · pipeline properties (S1 steady backfill)', () => {
  let portal: LedgerPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-ct1-'))
  })

  afterEach(async () => {
    await portal?.close()
    portal = undefined
    await rm(dir, { recursive: true, force: true })
  })

  const startPortal = async (finalized: number = S1.to) => {
    portal = await ledgerPortal(
      new ChainLedger({
        blocks: buildChain({ from: S1.from, to: S1.to }),
        finalized: { number: finalized, hash: `0x${finalized}` },
        latest: S1.to,
        batchSize: S1.batchSize,
      }),
    )

    return portal
  }

  /** Runs the pipe, recording the batch partitioning the SUT chose. */
  const runPipe = async (target = dir) => {
    const batches: DeliveredBatch[] = []
    let cursor: number | undefined

    await evmPortalStream({
      id: 'test',
      portal: { url: portal!.url, maxBytes: 1 },
      outputs: blockDecoder({ from: S1.from, to: S1.to }),
      logger: testLogger(),
    }).pipeTo(
      parquetTarget({
        dir: target,
        tables: [BLOCKS_TABLE],
        settings: { rollover: { maxBytes: 1 } },
        onData: ({ store, data }) => {
          const blocks = data as { number: number; hash: string; timestamp: number }[]
          batches.push({ cursorBefore: cursor, blocks: blocks.map((b) => ({ number: b.number })) })
          cursor = blocks.at(-1)?.number

          store.insert(
            'blocks',
            blocks.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
          )
        },
      }),
    )

    return batches
  }

  /** What the oracle says this scenario must commit. */
  const oracleFor = (finalized: number) => {
    const model = new ReferenceModel({
      durability: 'K',
      range: { from: S1.from, to: S1.to },
      transform: (b) => [{ table: 'blocks', block: b.number, value: b.hash }],
    })
    model.batch(
      buildChain({ from: S1.from, to: S1.to }).map((b) => b.header),
      { finalized: { number: finalized, hash: `0x${finalized}` } },
    )

    return model
  }

  it('commits exactly what the reference model commits', async () => {
    await startPortal()
    await runPipe()

    const probe = parquetProbe({ dir, tables: ['blocks'], id: 'test' })
    const rows = await probe.readRows('blocks')

    expect(rows.map((r) => r.block)).toEqual(oracleFor(S1.to).data.map((r) => r.block))
  })

  it('holds back every row above the finalized floor (INV-3, CN-12)', async () => {
    const floor = 30
    await startPortal(floor)
    await runPipe()

    const probe = parquetProbe({ dir, tables: ['blocks'], id: 'test' })
    const rows = await probe.readRows('blocks')
    const model = oracleFor(floor)

    expect(rows.map((r) => r.block)).toEqual(model.data.map((r) => r.block))
    expect(rows.at(-1)!.block).toBeLessThanOrEqual(floor)
    expect(model.buffered.length).toBeGreaterThan(0)
  })

  it('keeps every structural validator green at quiescence', async () => {
    await startPortal()
    await runPipe()

    const probe = parquetProbe({ dir, tables: ['blocks'], id: 'test' })
    const rows = await probe.readRows('blocks')

    assertStructure({
      rows,
      units: await probe.readUnits!('blocks'),
      state: (await probe.readState())!,
      ranges: [{ from: S1.from, to: S1.to }],
      dataBound: rows.at(-1)?.block,
    })
  })

  it('partitions the stream into well-formed batches (INV-20)', async () => {
    await startPortal()
    const batches = await runPipe()

    expect(batches.length).toBeGreaterThan(1)
    expect(validateLinked(batches)).toEqual([])
    for (const batch of batches) {
      expect(validateOrdered(batch.blocks.map((b) => ({ block: b.number })))).toEqual([])
    }
  })

  it('drives the anchor forward exactly one block past each delivery (IB-3)', async () => {
    await startPortal()
    await runPipe()

    const anchored = portal!.ledger.requests.filter((r) => r.parentBlockHash !== undefined)
    expect(anchored.length).toBeGreaterThan(0)
    for (const request of anchored) {
      expect(request.parentBlockHash).toBe(`0x${request.fromBlock - 1}`)
    }
  })

  it('never asks for a block outside the configured range (INV-24)', async () => {
    await startPortal()
    await runPipe()

    for (const request of portal!.ledger.requests) {
      expect(request.fromBlock).toBeGreaterThanOrEqual(S1.from)
      expect(request.toBlock).toBe(S1.to)
    }
  })

  it('commits the same store on an independent second run (INV-22)', async () => {
    await startPortal()
    await runPipe()

    const second = await mkdtemp(path.join(tmpdir(), 'sqd-ct1-b-'))
    try {
      await runPipe(second)

      const a = await parquetProbe({ dir, tables: ['blocks'], id: 'test' }).readRows('blocks')
      const b = await parquetProbe({ dir: second, tables: ['blocks'], id: 'test' }).readRows('blocks')

      expect(b).toEqual(a)
    } finally {
      await rm(second, { recursive: true, force: true })
    }
  })

  it('changes nothing once idle at quiescence (INV-10)', async () => {
    await startPortal()
    await runPipe()

    const probe = parquetProbe({ dir, tables: ['blocks'], id: 'test' })
    const before = { state: await probe.readState(), units: await probe.readUnits!('blocks') }
    const after = { state: await probe.readState(), units: await probe.readUnits!('blocks') }

    expect(after).toEqual(before)
  })
})
