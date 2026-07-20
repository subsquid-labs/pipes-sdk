import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { type ParquetTable, parquetTarget } from '~/targets/parquet/index.js'
import { blockDecoder, testLogger } from '~/testing/index.js'

import { ChainLedger, buildChain } from './chain-ledger.js'
import { expectCrash, obstruct, statePath, unitPath } from './kill-points.js'
import { type LedgerPortal, ledgerPortal } from './ledger-portal.js'
import { parquetProbe } from './parquet-probe.js'
import { ReferenceModel } from './reference-model.js'
import { assertStructure } from './validators.js'

const BLOCKS_TABLE: ParquetTable = {
  table: 'blocks',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

const LOGS_TABLE: ParquetTable = {
  table: 'logs',
  schema: {
    blockNumber: { type: 'INT64' },
    hash: { type: 'UTF8' },
    timestamp: { type: 'INT64' },
  },
}

const TO_BLOCK = 5
/** Ledger batch size; with `rollover.maxBytes: 1` this makes checkpoints land on 0-1, 2-3, 4-5. */
const BATCH = 2

/**
 * CT-2 — crash-recovery kill-point matrix for class K (checkpointed-immutable, CN-12).
 *
 * Class K commits by publishing every open unit atomically and *then* persisting the cursor. The
 * matrix walks the points that protocol can be interrupted at; each one must recover to the state a
 * clean run reaches, because the cursor alone decides what is committed and a unit published above
 * it has to be re-derived rather than kept (RS-10).
 *
 * The simulator runs in ledger mode throughout: after a crash the pipe resumes from its recovered
 * cursor and re-requests, which an ordinal script has no answer for (GAP-14).
 */
describe('CT-2 · class K kill-point matrix', () => {
  let portal: LedgerPortal | undefined
  let dir: string

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'sqd-ct2-k-'))
  })

  afterEach(async () => {
    await portal?.close()
    portal = undefined
    await rm(dir, { recursive: true, force: true })
  })

  const startPortal = async () => {
    portal = await ledgerPortal(
      new ChainLedger({
        blocks: buildChain({ from: 0, to: TO_BLOCK }),
        // Class K writes only finalized rows, so the range must be final to be published at all.
        finalized: { number: TO_BLOCK, hash: `0x${TO_BLOCK}` },
        batchSize: BATCH,
      }),
    )
  }

  const runPipe = (tables: ParquetTable[], { onBatch }: { onBatch?: (n: number) => void } = {}) => {
    let batches = 0

    return evmPortalStream({
      id: 'test',
      portal: { url: portal!.url, maxBytes: 1 },
      outputs: blockDecoder({ from: 0, to: TO_BLOCK }),
      logger: testLogger(),
    }).pipeTo(
      parquetTarget({
        dir,
        tables,
        settings: { rollover: { maxBytes: 1 } },
        onData: ({ store, data }) => {
          const blocks = data as { number: number; hash: string; timestamp: number }[]
          for (const table of tables) {
            store.insert(
              table.table,
              blocks.map((b) => ({ blockNumber: b.number, hash: b.hash, timestamp: b.timestamp })),
            )
          }
          onBatch?.(++batches)
        },
      }),
    )
  }

  const probeFor = (tables: string[] = ['blocks']) => parquetProbe({ dir, tables, id: 'test' })

  /** What a clean, uninterrupted run of this scenario must commit. */
  const expectedBlocks = () => {
    const model = new ReferenceModel({
      durability: 'K',
      range: { from: 0, to: TO_BLOCK },
      transform: (b) => [{ table: 'blocks', block: b.number, value: b.hash }],
    })
    model.batch(
      buildChain({ from: 0, to: TO_BLOCK }).map((b) => b.header),
      { finalized: { number: TO_BLOCK, hash: `0x${TO_BLOCK}` } },
    )

    return model.data.map((r) => r.block)
  }

  /** Restarts the pipe, then diffs the store against the oracle at quiescence. */
  const recoverAndVerify = async (tables: ParquetTable[] = [BLOCKS_TABLE]) => {
    await runPipe(tables)

    const probe = probeFor(tables.map((t) => t.table))
    const state = await probe.readState()
    const rows = await probe.readRows('blocks')

    expect(rows.map((r) => r.block)).toEqual(expectedBlocks())
    expect(state?.current?.number).toBe(TO_BLOCK)

    assertStructure({
      rows,
      units: await probe.readUnits!('blocks'),
      state: state!,
      ranges: [{ from: 0, to: TO_BLOCK }],
      dataBound: rows.at(-1)?.block,
    })

    return { probe, state, rows }
  }

  it('recovers when the run dies while a unit is still being built (mid-unit-write)', async () => {
    await startPortal()

    // Dies inside the very first batch, with rows staged and the checkpoint not yet reached, so no
    // unit is ever published. (Checkpoints run per batch here, so a later batch would already have
    // committed one.)
    await expectCrash(() =>
      runPipe([BLOCKS_TABLE], {
        onBatch: (n) => {
          if (n === 1) {
            throw new Error('killed mid-unit-write')
          }
        },
      }),
    )

    expect(await probeFor().readUnits!('blocks')).toEqual([])
    expect(await probeFor().readState()).toBeUndefined()

    await recoverAndVerify()
  })

  it('does not clear a unit published before the first cursor ever landed (GAP-36)', async () => {
    await startPortal()

    // The state record cannot be written, so the first checkpoint publishes its unit and then dies
    // before the cursor lands — the CN-12 crash window, at the one moment no cursor exists yet.
    const blocked = await obstruct(statePath(dir, 'test'))
    await expectCrash(() => runPipe([BLOCKS_TABLE]))

    const probe = probeFor()
    const orphaned = await probe.readUnits!('blocks')
    expect(orphaned.length).toBeGreaterThan(0)

    await blocked.release()
    expect(await probe.readState()).toBeUndefined()

    // CN-12 requires recovery to delete every unit whose window end exceeds the cursor. With no
    // cursor persisted that is every unit — but getCursor() returns before #deleteFilesAboveCursor
    // can run, so the restart meets its own orphan. Downstream that surfaces either as E2309 or as
    // duplicated rows depending on batch partitioning, a declared free variable; the deterministic
    // fact underneath is that the orphan survives recovery. Swap this for recoverAndVerify() once
    // GAP-36 is decided.
    await runPipe([BLOCKS_TABLE]).catch(() => {})

    expect((await probe.readUnits!('blocks')).map((u) => u.name)).toEqual(
      expect.arrayContaining(orphaned.map((u) => u.name)),
    )
  })

  it('recovers when the publish loop dies between two tables (mid-rename)', async () => {
    await startPortal()

    // Let checkpoint 1 (blocks 0–1) commit, then block only the `logs` unit of checkpoint 2, so one
    // table publishes and the other does not. Without a committed cursor first this would merely
    // re-test GAP-36 instead of the interrupted loop.
    const blocked = await obstruct(unitPath(dir, 'logs', 2, 3))
    await expectCrash(() => runPipe([BLOCKS_TABLE, LOGS_TABLE]))

    const probe = probeFor(['blocks', 'logs'])
    const state = await probe.readState()
    expect(state?.current?.number).toBe(1)
    expect((await probe.readUnits!('blocks')).length).toBe(2)

    await blocked.release()
    await recoverAndVerify([BLOCKS_TABLE, LOGS_TABLE])
  })

  it('recovers when the run dies just after a cursor was committed (post-state)', async () => {
    await startPortal()

    // Checkpoint 1 commits fully — units published *and* cursor persisted — then checkpoint 2 dies.
    // Checkpoints run per batch, so dying inside batch 3 leaves checkpoints 1 and 2 fully
    // committed — units published *and* cursor persisted — which is the post-state point. No
    // obstruction here: blocking a data file would be undone by recovery, which deletes
    // over-cursor units when the stream restarts.
    await expectCrash(() =>
      runPipe([BLOCKS_TABLE], {
        onBatch: (n) => {
          if (n === 3) {
            throw new Error('killed after the cursor was committed')
          }
        },
      }),
    )

    // Where exactly the cursor landed is checkpoint timing — a declared free variable, so it is not
    // pinned. What must hold is that a commit point was reached and covers everything published.
    const probe = probeFor()
    const state = await probe.readState()
    expect(state?.current).toBeDefined()
    const units = await probe.readUnits!('blocks')
    expect(units.length).toBeGreaterThan(0)
    for (const unit of units) {
      expect(unit.to).toBeLessThanOrEqual(state!.current!.number)
    }

    await recoverAndVerify()
  })

  it('deletes a unit published above the committed cursor before resuming (CN-12)', async () => {
    await startPortal()

    // Checkpoint 1 commits; checkpoint 2 publishes `blocks` then dies on `logs`, leaving a `blocks`
    // unit that the cursor does not cover. Recovery must remove it rather than keep it.
    const blocked = await obstruct(unitPath(dir, 'logs', 2, 3))
    await expectCrash(() => runPipe([BLOCKS_TABLE, LOGS_TABLE]))

    const probe = probeFor(['blocks', 'logs'])
    const committed = (await probe.readState())!.current!.number
    const overCursor = (await probe.readUnits!('blocks')).filter((u) => u.to > committed)
    expect(overCursor.length).toBeGreaterThan(0)

    await blocked.release()
    await recoverAndVerify([BLOCKS_TABLE, LOGS_TABLE])

    // Every surviving unit is covered by the final cursor, and none is duplicated.
    const units = await probe.readUnits!('blocks')
    expect(new Set(units.map((u) => u.name)).size).toBe(units.length)
  })

  it('re-requests from the recovered cursor rather than from the start', async () => {
    // The GAP-14 assertion an ordinal script cannot make: what the SUT asked for after coming back.
    await startPortal()

    await expectCrash(() =>
      runPipe([BLOCKS_TABLE], {
        onBatch: (n) => {
          if (n === 3) {
            throw new Error('killed after the cursor was committed')
          }
        },
      }),
    )

    const committed = (await probeFor().readState())!.current!
    const before = portal!.ledger.requests.length

    await runPipe([BLOCKS_TABLE])

    const afterRestart = portal!.ledger.requests.slice(before)
    expect(afterRestart[0]).toMatchObject({
      fromBlock: committed.number + 1,
      parentBlockHash: committed.hash,
    })
  })

  it('leaves no temp files behind after recovery', async () => {
    await startPortal()

    await expectCrash(() =>
      runPipe([BLOCKS_TABLE], {
        onBatch: (n) => {
          if (n === 3) {
            throw new Error('killed mid-run')
          }
        },
      }),
    )
    await recoverAndVerify()

    const entries = [...(await readdir(dir)), ...(await readdir(path.join(dir, 'blocks')))]
    expect(entries.filter((f) => f.startsWith('.tmp-'))).toEqual([])
  })
})
