import { afterEach, describe, expect, it } from 'vitest'

import { evmPortalStream } from '~/evm/index.js'
import { blockDecoder, readAll } from '~/testing/index.js'

import { ChainLedger, buildChain } from './chain-ledger.js'
import { type LedgerPortal, ledgerPortal } from './ledger-portal.js'

describe('ledgerPortal', () => {
  let portal: LedgerPortal | undefined

  afterEach(async () => {
    await portal?.close()
    portal = undefined
  })

  it('streams a bounded backfill to a real pipe', async () => {
    portal = await ledgerPortal(new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }), batchSize: 2 }))

    const blocks = await readAll(
      evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }),
    )

    expect(blocks.map((b: any) => b.number)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('drives the anchor forward one block at a time (IB-3)', async () => {
    portal = await ledgerPortal(new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }), batchSize: 2 }))

    await readAll(evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 5 }) }))

    // Every request after the first anchors on the hash of the block that preceded its fromBlock.
    const anchored = portal.ledger.requests.filter((r) => r.parentBlockHash !== undefined)
    expect(anchored.length).toBeGreaterThan(0)
    for (const request of anchored) {
      expect(request.parentBlockHash).toBe(`0x${request.fromBlock - 1}`)
    }
  })

  it('signals a fork when the pipe anchors on an orphaned block', async () => {
    const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 3 }), batchSize: 4 })
    portal = await ledgerPortal(ledger)

    const stream = evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 6 }) })
    const iterator = stream[Symbol.asyncIterator]()

    // Drain blocks 0–3, then reorg away from the block the pipe is now anchored on.
    await iterator.next()
    ledger.fork(1, buildChain({ from: 2, to: 6, hash: (n) => `0x${n}__b` }))

    await expect(iterator.next()).rejects.toMatchObject({ name: 'ForkError' })
    expect(ledger.requests.at(-1)?.statusCode).toBe(409)
  })

  it('answers a fresh pipe and a resumed pipe from the same held chain', async () => {
    // The re-request an ordinal script cannot answer: a second run starting mid-chain gets the
    // blocks its anchor actually implies, not whatever response sits at the next index.
    const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 5 }), batchSize: 10 })
    portal = await ledgerPortal(ledger)

    const first = await readAll(
      evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 2 }) }),
    )
    const resumed = await readAll(
      evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 3, to: 5 }) }),
    )

    expect(first.map((b: any) => b.number)).toEqual([0, 1, 2])
    expect(resumed.map((b: any) => b.number)).toEqual([3, 4, 5])
  })

  it('retries through an injected transport fault (IB-7)', async () => {
    const ledger = new ChainLedger({ blocks: buildChain({ from: 0, to: 3 }), batchSize: 10 })
    ledger.injectFaults({ statusCode: 503 })
    portal = await ledgerPortal(ledger)

    const blocks = await readAll(
      evmPortalStream({ id: 'test', portal: portal.url, outputs: blockDecoder({ from: 0, to: 3 }) }),
    )

    expect(blocks.map((b: any) => b.number)).toEqual([0, 1, 2, 3])
    expect(ledger.requests[0].statusCode).toBe(503)
  })
})
