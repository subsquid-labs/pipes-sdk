import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortalClient } from '~/portal-client/client.js'
import { createMemoryTarget } from '~/targets/memory/memory-target.js'
import { encodeEvent, mockBlock, resetMockBlockCounter } from '~/testing/evm/index.js'
import { MockPortal, MockResponse, createMockPortal, createTestLogger, readAll } from '~/testing/index.js'

import { evmDecoder } from './evm-decoder.js'
import { evmPortalStream } from './evm-portal-source.js'
import { EvmQueryBuilder } from './evm-query-builder.js'
import { contractFactory, mergePreindexedRanges, preindexProgressHandlers, preindexScanRange } from './factory.js'
import { contractFactoryStore } from './factory-adapters/sqlite.js'

const POOL_CREATED_ABI = [
  {
    type: 'event' as const,
    name: 'PoolCreated',
    inputs: [
      { name: 'token0', type: 'address', indexed: true },
      { name: 'token1', type: 'address', indexed: true },
      { name: 'fee', type: 'uint24', indexed: true },
      { name: 'tickSpacing', type: 'int24', indexed: false },
      { name: 'pool', type: 'address', indexed: false },
    ],
  },
] as const

const SWAP_ABI = [
  {
    type: 'event' as const,
    name: 'Swap',
    inputs: [
      { name: 'sender', type: 'address', indexed: true },
      { name: 'recipient', type: 'address', indexed: true },
      { name: 'amount0', type: 'int256', indexed: false },
      { name: 'amount1', type: 'int256', indexed: false },
      { name: 'sqrtPriceX96', type: 'uint160', indexed: false },
      { name: 'liquidity', type: 'uint128', indexed: false },
      { name: 'tick', type: 'int24', indexed: false },
    ],
  },
] as const

const factoryAbi = {
  PoolCreated: event(
    '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
    'PoolCreated(address,address,uint24,int24,address)',
    {
      token0: indexed(p.address),
      token1: indexed(p.address),
      fee: indexed(p.uint24),
      tickSpacing: p.int24,
      pool: p.address,
    },
  ),
}

const poolAbi = {
  Swap: event(
    '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
    'Swap(address,address,int256,int256,uint160,uint128,int24)',
    {
      sender: indexed(p.address),
      recipient: indexed(p.address),
      amount0: p.int256,
      amount1: p.int256,
      sqrtPriceX96: p.uint160,
      liquidity: p.uint128,
      tick: p.int24,
    },
  ),
}

// ── Addresses ──

const UNISWAP_FACTORY = '0x1f98431c8ad98523631ae4a59f267346ea31f984' as `0x${string}`
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as `0x${string}`
const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as `0x${string}`
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as `0x${string}`
const WETH_USDC_POOL = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8' as `0x${string}`
const USDT_USDC_POOL = '0x9db9e0e53058c89e5b94e29621a205198648425b' as `0x${string}`
const UNKNOWN_POOL = '0xaaaaaac3a0ff1de082011efddc58f1908eb6e6d8' as `0x${string}`
const SENDER = '0xdef1cafe0000000000000000000000000000dead' as `0x${string}`
const RECIPIENT = '0xbeef0000000000000000000000000000deadbeef' as `0x${string}`

// ── Helpers ──

function encodePoolCreated(pool: `0x${string}`, token0 = WETH, token1 = USDC, fee = 3000, tickSpacing = 10) {
  return encodeEvent({
    abi: POOL_CREATED_ABI,
    eventName: 'PoolCreated',
    address: UNISWAP_FACTORY,
    args: { token0, token1, fee, tickSpacing, pool },
  })
}

function encodeSwap(address: `0x${string}`) {
  return encodeEvent({
    abi: SWAP_ABI,
    eventName: 'Swap',
    address,
    args: { sender: SENDER, recipient: RECIPIENT, amount0: 1n, amount1: 2n, sqrtPriceX96: 3n, liquidity: 4n, tick: 5 },
  })
}

/** Collects every /stream request body so the query shape can be asserted after the run. */
function captureQueries(queries: any[]) {
  return (query: any) => queries.push(query)
}

function streamResponse(blocks: ReturnType<typeof mockBlock>[], onRequest?: (query: any) => void): MockResponse {
  const last = blocks[blocks.length - 1]

  return {
    statusCode: 200,
    data: blocks,
    head: { finalized: { number: last.header.number, hash: last.header.hash } },
    validateRequest: onRequest,
  }
}

function createPoolFactory(db: any, preindex: boolean | { maxAddressFilterSize?: number } = true) {
  return contractFactory({
    address: UNISWAP_FACTORY,
    event: factoryAbi.PoolCreated,
    childAddressField: 'pool',
    database: db,
    preindex,
  })
}

describe('Factory preindex', () => {
  let mockPortal: MockPortal | undefined

  beforeEach(() => {
    resetMockBlockCounter()
    mockPortal = undefined
  })

  afterEach(async () => {
    await mockPortal?.close()
  })

  it('runs the pre-pass up to the finalized head, then splits the main query', async () => {
    const queries: any[] = []

    mockPortal = await createMockPortal(
      [
        // pre-pass scan [1..5]: factory events only
        streamResponse(
          [
            mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 5 }),
          ],
          captureQueries(queries),
        ),
        // main loop [1..5]: server-side child address filter
        streamResponse(
          [
            mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 4, transactions: [{ logs: [encodeSwap(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 5 }),
          ],
          captureQueries(queries),
        ),
        // main loop [6..10]: wildcard tail with client-side filtering
        streamResponse(
          [
            mockBlock({ number: 7, transactions: [{ logs: [encodeSwap(UNKNOWN_POOL)] }] }),
            mockBlock({ number: 8, transactions: [{ logs: [encodeSwap(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 5, hash: '0x5' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })
    const poolFactory = createPoolFactory(db)

    const stream = evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: evmDecoder({
        range: { from: 1, to: 10 },
        contracts: poolFactory,
        events: { swaps: poolAbi.Swap },
      }).pipe((d) => d.swaps),
    })

    const res = await readAll(stream)

    // Only swaps from the known child pool are decoded, in both ranges
    expect(res).toHaveLength(2)
    expect(res.map((s) => s.block.number)).toEqual([4, 8])
    expect(res.every((s) => s.contract === WETH_USDC_POOL)).toBe(true)
    expect(res.every((s) => s.factory?.event.pool === WETH_USDC_POOL)).toBe(true)

    expect(queries).toHaveLength(3)

    // Pre-pass: factory-creation events only, clamped to the finalized head
    expect(queries[0].fromBlock).toBe(1)
    expect(queries[0].toBlock).toBe(5)
    expect(queries[0].logs).toEqual([
      { address: [UNISWAP_FACTORY], topic0: [factoryAbi.PoolCreated.topic], transaction: true },
    ])

    // Historical range: factory request + server-side child address filter
    expect(queries[1].fromBlock).toBe(1)
    expect(queries[1].toBlock).toBe(5)
    expect(queries[1].logs).toHaveLength(2)
    expect(queries[1].logs).toContainEqual({ address: [UNISWAP_FACTORY], topic0: [factoryAbi.PoolCreated.topic] })
    expect(queries[1].logs).toContainEqual({
      address: [WETH_USDC_POOL],
      topic0: [poolAbi.Swap.topic],
      transaction: true,
    })

    // Tail: factory request + wildcard (no address) child request
    expect(queries[2].fromBlock).toBe(6)
    expect(queries[2].toBlock).toBe(10)
    expect(queries[2].logs).toHaveLength(2)
    expect(queries[2].logs).toContainEqual({ address: [UNISWAP_FACTORY], topic0: [factoryAbi.PoolCreated.topic] })
    expect(queries[2].logs).toContainEqual({ topic0: [poolAbi.Swap.topic], transaction: true })

    // Pre-indexed progress is persisted
    const key = await poolFactory.preindexKey()
    expect(await db.getPreindexedRange(key)).toEqual({ from: 1, to: 5 })
  })

  it('skips the historical child request entirely when the pre-pass finds no children', async () => {
    const queries: any[] = []

    mockPortal = await createMockPortal(
      [
        // pre-pass scan [1..5]: no factory events
        streamResponse([mockBlock({ number: 5 })], captureQueries(queries)),
        // main loop [1..5]: no children yet — factory request only
        streamResponse([mockBlock({ number: 5 })], captureQueries(queries)),
        // main loop [6..10]: inline discovery still works in the wildcard tail
        streamResponse(
          [
            mockBlock({ number: 7, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 8, transactions: [{ logs: [encodeSwap(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 5, hash: '0x5' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })

    const stream = evmPortalStream({
      id: 'test',
      portal: mockPortal.url,
      outputs: evmDecoder({
        range: { from: 1, to: 10 },
        contracts: createPoolFactory(db),
        events: { swaps: poolAbi.Swap },
      }).pipe((d) => d.swaps),
    })

    const res = await readAll(stream)

    expect(res).toHaveLength(1)
    expect(res[0].block.number).toBe(8)
    expect(res[0].factory?.blockNumber).toBe(7)

    expect(queries).toHaveLength(3)
    // No children ≤ watermark means no child events there either — only the factory request remains
    expect(queries[1].logs).toEqual([{ address: [UNISWAP_FACTORY], topic0: [factoryAbi.PoolCreated.topic] }])
    // The wildcard tail is unaffected
    expect(queries[2].logs).toContainEqual({ topic0: [poolAbi.Swap.topic], transaction: true })
  })

  it('scans only the gap above the covered range on restart', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })

    // First run: pre-pass covers [1..5]
    {
      const queries: any[] = []
      mockPortal = await createMockPortal(
        [
          streamResponse(
            [
              mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
              mockBlock({ number: 5 }),
            ],
            captureQueries(queries),
          ),
          streamResponse([mockBlock({ number: 5 })], captureQueries(queries)),
          streamResponse([mockBlock({ number: 10 })], captureQueries(queries)),
        ],
        { head: { finalized: { number: 5, hash: '0x5' } } },
      )

      await readAll(
        evmPortalStream({
          id: 'test',
          portal: mockPortal.url,
          outputs: evmDecoder({
            range: { from: 1, to: 10 },
            contracts: createPoolFactory(db),
            events: { swaps: poolAbi.Swap },
          }).pipe((d) => d.swaps),
        }),
      )

      expect(queries[0].fromBlock).toBe(1)
      expect(queries[0].toBlock).toBe(5)

      await mockPortal.close()
    }

    // Second run: finalized head advanced to 8 — the pre-pass only scans [6..8]
    {
      const queries: any[] = []
      mockPortal = await createMockPortal(
        [
          streamResponse(
            [
              mockBlock({ number: 6, transactions: [{ logs: [encodePoolCreated(USDT_USDC_POOL, USDT)] }] }),
              mockBlock({ number: 8 }),
            ],
            captureQueries(queries),
          ),
          streamResponse([mockBlock({ number: 8 })], captureQueries(queries)),
          streamResponse([mockBlock({ number: 10 })], captureQueries(queries)),
        ],
        { head: { finalized: { number: 8, hash: '0x8' } } },
      )

      const poolFactory = createPoolFactory(db)

      await readAll(
        evmPortalStream({
          id: 'test',
          portal: mockPortal.url,
          outputs: evmDecoder({
            range: { from: 1, to: 10 },
            contracts: poolFactory,
            events: { swaps: poolAbi.Swap },
          }).pipe((d) => d.swaps),
        }),
      )

      // Gap scan only
      expect(queries[0].fromBlock).toBe(6)
      expect(queries[0].toBlock).toBe(8)

      // The historical filter covers [1..8] and includes children from both runs
      expect(queries[1].fromBlock).toBe(1)
      expect(queries[1].toBlock).toBe(8)
      expect(queries[1].logs).toContainEqual({
        address: expect.arrayContaining([WETH_USDC_POOL, USDT_USDC_POOL]),
        topic0: [poolAbi.Swap.topic],
        transaction: true,
      })

      expect(queries[2].fromBlock).toBe(9)
      expect(queries[2].toBlock).toBe(10)

      const key = await poolFactory.preindexKey()
      expect(await db.getPreindexedRange(key)).toEqual({ from: 1, to: 8 })
    }
  })

  it('re-scans from scratch when factory params change (new progress key)', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })

    const getPipeline = async (token0: string, queries: any[]) => {
      mockPortal = await createMockPortal(
        [
          streamResponse(
            [
              mockBlock({
                number: 1,
                transactions: [
                  { logs: [encodePoolCreated(WETH_USDC_POOL, WETH), encodePoolCreated(USDT_USDC_POOL, USDT)] },
                ],
              }),
              mockBlock({ number: 5 }),
            ],
            captureQueries(queries),
          ),
          streamResponse([mockBlock({ number: 5 })], captureQueries(queries)),
        ],
        { head: { finalized: { number: 5, hash: '0x5' } } },
      )

      const factory = contractFactory({
        address: UNISWAP_FACTORY,
        event: { event: factoryAbi.PoolCreated, params: { token0 } },
        childAddressField: 'pool',
        database: db,
        preindex: true,
      })

      return {
        factory,
        stream: evmPortalStream({
          id: 'test',
          portal: mockPortal.url,
          outputs: evmDecoder({
            range: { from: 1, to: 5 },
            contracts: factory,
            events: { swaps: poolAbi.Swap },
          }).pipe((d) => d.swaps),
        }),
      }
    }

    const firstQueries: any[] = []
    const first = await getPipeline(WETH, firstQueries)
    await readAll(first.stream)
    expect(firstQueries[0].fromBlock).toBe(1)
    await mockPortal?.close()

    const secondQueries: any[] = []
    const second = await getPipeline(USDT, secondQueries)
    await readAll(second.stream)

    // Different params → different key → full re-scan instead of a gap scan
    expect(secondQueries[0].fromBlock).toBe(1)
    expect(secondQueries[0].toBlock).toBe(5)

    // Both progress rows coexist under their own keys
    const firstKey = await first.factory.preindexKey()
    const secondKey = await second.factory.preindexKey()
    expect(firstKey).not.toBe(secondKey)
    expect(await db.getPreindexedRange(firstKey)).toEqual({ from: 1, to: 5 })
    expect(await db.getPreindexedRange(secondKey)).toEqual({ from: 1, to: 5 })

    // And the historical filter only picks up children matching the current params
    expect(secondQueries[1].logs).toContainEqual({
      address: [USDT_USDC_POOL],
      topic0: [poolAbi.Swap.topic],
      transaction: true,
    })
  })

  it('persists progress per batch and resumes an interrupted pre-pass from it', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })
    const spy = vi.spyOn(db, 'setPreindexedRange')

    // First run stops at finalized head 3 — as if the process was interrupted before
    // the chain range was fully covered
    mockPortal = await createMockPortal(
      [
        streamResponse([
          mockBlock({ number: 2, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
          mockBlock({ number: 3 }),
        ]),
      ],
      { head: { finalized: { number: 3, hash: '0x3' } } },
    )

    const firstRun = createPoolFactory(db)
    expect(
      await firstRun.ensurePreindexed({
        portal: new PortalClient({ url: mockPortal.url }),
        logger: createTestLogger(),
        range: { from: 1, to: 10 },
      }),
    ).toBe(3)

    // Progress was persisted with the batch, not only at the end
    expect(spy.mock.calls.map(([, range]) => range)).toEqual([
      { from: 1, to: 3 },
      { from: 1, to: 3 },
    ])
    await mockPortal.close()

    // Second run: the finalized head advanced — only the gap above the covered range is scanned
    const queries: any[] = []
    mockPortal = await createMockPortal(
      [
        streamResponse(
          [
            mockBlock({ number: 7, transactions: [{ logs: [encodePoolCreated(USDT_USDC_POOL, USDT)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 10, hash: '0xa' } } },
    )

    const secondRun = createPoolFactory(db)
    expect(
      await secondRun.ensurePreindexed({
        portal: new PortalClient({ url: mockPortal.url }),
        logger: createTestLogger(),
        range: { from: 1, to: 10 },
      }),
    ).toBe(10)

    expect(queries[0].fromBlock).toBe(4)
    expect(queries[0].toBlock).toBe(10)

    const key = await secondRun.preindexKey()
    expect(await db.getPreindexedRange(key)).toEqual({ from: 1, to: 10 })
    expect(await db.all()).toHaveLength(2)
  })

  it('removes children discovered in the wildcard tail on fork, keeping the covered range', async () => {
    const FORKED_POOL = '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d7' as const

    mockPortal = await createMockPortal(
      [
        // pre-pass scan [1..1]
        streamResponse([mockBlock({ number: 1, hash: '0x1' })]),
        // main loop [1..1]: factory request only (no children)
        streamResponse([mockBlock({ number: 1, hash: '0x1' })]),
        // main loop [2..3] wildcard: block 2 will be forked
        {
          statusCode: 200,
          data: [mockBlock({ number: 2, hash: '0x2', transactions: [{ logs: [encodePoolCreated(FORKED_POOL)] }] })],
          head: { finalized: { number: 1, hash: '0x1' } },
        },
        {
          statusCode: 409,
          data: { previousBlocks: [{ number: 1, hash: '0x1' }] },
        },
        // resumed [2..3]: swap from a pool the forked-out event had registered
        {
          statusCode: 200,
          data: [
            mockBlock({ number: 2, hash: '0x2a', transactions: [{ logs: [encodeSwap(FORKED_POOL)] }] }),
            mockBlock({ number: 3, hash: '0x3a' }),
          ],
          head: { finalized: { number: 3, hash: '0x3a' } },
        },
      ],
      { head: { finalized: { number: 1, hash: '0x1' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })
    const poolFactory = createPoolFactory(db)
    const res: any[] = []

    await evmPortalStream({
      id: 'test-factory',
      portal: { url: mockPortal.url },
      outputs: evmDecoder({
        range: { from: 1, to: 3 },
        contracts: poolFactory,
        events: { swaps: poolAbi.Swap },
      }).pipe((d) => d.swaps.map((s) => ({ ...s, blockNumber: s.block.number }))),
    }).pipeTo(
      createMemoryTarget({
        onData: (data) => {
          res.push(...data)
        },
      }),
    )

    // The forked-out PoolCreated was rolled back, so its pool's swaps are not decoded
    expect(res).toHaveLength(0)
    expect(await db.all()).toHaveLength(0)

    // The pre-indexed range only ever covers finalized blocks — forks never invalidate it
    const key = await poolFactory.preindexKey()
    expect(await db.getPreindexedRange(key)).toEqual({ from: 1, to: 1 })
  })

  it('falls back to a single wildcard pass when the dataset has no finalized head', async () => {
    const queries: any[] = []

    // No `head` option: GET /finalized-head responds 404
    mockPortal = await createMockPortal([
      streamResponse(
        [
          mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
          mockBlock({ number: 2, transactions: [{ logs: [encodeSwap(WETH_USDC_POOL)] }] }),
          mockBlock({ number: 5 }),
        ],
        captureQueries(queries),
      ),
    ])

    const db = await contractFactoryStore({ path: ':memory:' })

    const res = await readAll(
      evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 1, to: 5 },
          contracts: createPoolFactory(db),
          events: { swaps: poolAbi.Swap },
        }).pipe((d) => d.swaps),
      }),
    )

    expect(res).toHaveLength(1)

    // Single pass over the whole range, wildcard child request
    expect(queries).toHaveLength(1)
    expect(queries[0].fromBlock).toBe(1)
    expect(queries[0].toBlock).toBe(5)
    expect(queries[0].logs).toContainEqual({ topic0: [poolAbi.Swap.topic], transaction: true })
  })

  it('falls back to a wildcard pass when the child set exceeds maxAddressFilterSize', async () => {
    const queries: any[] = []

    mockPortal = await createMockPortal(
      [
        // pre-pass discovers two children — above the threshold of 1
        streamResponse(
          [
            mockBlock({
              number: 1,
              transactions: [
                { logs: [encodePoolCreated(WETH_USDC_POOL, WETH), encodePoolCreated(USDT_USDC_POOL, USDT)] },
              ],
            }),
            mockBlock({ number: 5 }),
          ],
          captureQueries(queries),
        ),
        // main loop: single wildcard pass over the whole range
        streamResponse(
          [mockBlock({ number: 4, transactions: [{ logs: [encodeSwap(WETH_USDC_POOL)] }] }), mockBlock({ number: 10 })],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 5, hash: '0x5' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })

    const res = await readAll(
      evmPortalStream({
        id: 'test',
        portal: mockPortal.url,
        outputs: evmDecoder({
          range: { from: 1, to: 10 },
          contracts: createPoolFactory(db, { maxAddressFilterSize: 1 }),
          events: { swaps: poolAbi.Swap },
        }).pipe((d) => d.swaps),
      }),
    )

    expect(res).toHaveLength(1)

    expect(queries).toHaveLength(2)
    expect(queries[1].fromBlock).toBe(1)
    expect(queries[1].toBlock).toBe(10)
    expect(queries[1].logs).toContainEqual({ topic0: [poolAbi.Swap.topic], transaction: true })
  })

  it('serializes shared-factory pre-passes and re-scans when a later range extends below the covered one', async () => {
    const queries: any[] = []

    mockPortal = await createMockPortal(
      [
        // first caller's pre-pass scans its own range [5..10]
        streamResponse(
          [
            mockBlock({ number: 5, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
        // second caller's range starts below the covered one — full re-scan [1..10]
        streamResponse(
          [
            mockBlock({ number: 2, transactions: [{ logs: [encodePoolCreated(USDT_USDC_POOL, USDT)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 10, hash: '0xa' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })
    const poolFactory = createPoolFactory(db)
    const portal = new PortalClient({ url: mockPortal.url })
    const logger = createTestLogger()

    const [narrow, wide] = await Promise.all([
      poolFactory.ensurePreindexed({ portal, logger, range: { from: 5, to: 10 } }),
      poolFactory.ensurePreindexed({ portal, logger, range: { from: 1, to: 10 } }),
    ])

    expect(narrow).toBe(10)
    expect(wide).toBe(10)

    // The runs never overlap: the narrow scan completes first, then the wide one re-scans below it
    expect(queries).toHaveLength(2)
    expect(queries[0].fromBlock).toBe(5)
    expect(queries[0].toBlock).toBe(10)
    expect(queries[1].fromBlock).toBe(1)
    expect(queries[1].toBlock).toBe(10)

    // Children from both scans are persisted and the widest range is covered
    expect(await db.all()).toHaveLength(2)
    expect(await db.getPreindexedRange(await poolFactory.preindexKey())).toEqual({ from: 1, to: 10 })
  })

  it('runs the shared-factory pre-pass once when the ranges match', async () => {
    const queries: any[] = []

    mockPortal = await createMockPortal(
      [
        streamResponse(
          [
            mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
            mockBlock({ number: 10 }),
          ],
          captureQueries(queries),
        ),
      ],
      { head: { finalized: { number: 10, hash: '0xa' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })
    const poolFactory = createPoolFactory(db)
    const portal = new PortalClient({ url: mockPortal.url })
    const logger = createTestLogger()

    const results = await Promise.all([
      poolFactory.ensurePreindexed({ portal, logger, range: { from: 1, to: 10 } }),
      poolFactory.ensurePreindexed({ portal, logger, range: { from: 1, to: 10 } }),
    ])

    expect(results).toEqual([10, 10])

    // The second run found the range already covered and did not hit the stream again
    expect(queries).toHaveLength(1)
  })

  it('stops the pre-pass mid-scan once the child set crosses the cap and resumes after raising it', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })

    mockPortal = await createMockPortal(
      [
        // [1..2]: the first pool — still within the cap of 1
        streamResponse([
          mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL, WETH)] }] }),
          mockBlock({ number: 2 }),
        ]),
        // [3]: the second pool crosses the cap — the scan must stop here
        streamResponse([mockBlock({ number: 3, transactions: [{ logs: [encodePoolCreated(USDT_USDC_POOL, USDT)] }] })]),
        // [4..10]: must never be processed
        streamResponse([mockBlock({ number: 10 })]),
      ],
      { head: { finalized: { number: 10, hash: '0xa' } } },
    )

    const entries: Record<string, any>[] = []
    const capped = createPoolFactory(db, { maxAddressFilterSize: 1 })
    const result = await capped.ensurePreindexed({
      // maxBytes: 1 delivers every response as its own batch instead of coalescing them
      portal: new PortalClient({ url: mockPortal.url, maxBytes: 1 }),
      logger: createTestLogger({ capture: (entry) => entries.push(entry) }),
      range: { from: 1, to: 10 },
    })

    expect(result).toBeNull()
    expect(entries.map((entry) => entry['message']).join('\n')).toContain('more than 1')

    // Progress stays honest: covered only up to the aborting batch, discovered children kept
    expect(await db.getPreindexedRange(await capped.preindexKey())).toEqual({ from: 1, to: 3 })
    expect(await db.all()).toHaveLength(2)
    await mockPortal?.close()

    // Raising the cap resumes the scan from the abort point instead of starting over
    const queries: any[] = []
    mockPortal = await createMockPortal([streamResponse([mockBlock({ number: 10 })], captureQueries(queries))], {
      head: { finalized: { number: 10, hash: '0xa' } },
    })

    const raised = createPoolFactory(db)
    expect(
      await raised.ensurePreindexed({
        portal: new PortalClient({ url: mockPortal.url }),
        logger: createTestLogger(),
        range: { from: 1, to: 10 },
      }),
    ).toBe(10)

    expect(queries[0].fromBlock).toBe(4)
    expect(queries[0].toBlock).toBe(10)
    expect(await db.getPreindexedRange(await raised.preindexKey())).toEqual({ from: 1, to: 10 })
  })

  it('skips the gap scan entirely when the persisted children already exceed the cap', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })

    // Seed: a completed scan [1..5] discovering two pools under the default cap
    mockPortal = await createMockPortal(
      [
        streamResponse([
          mockBlock({
            number: 1,
            transactions: [
              { logs: [encodePoolCreated(WETH_USDC_POOL, WETH), encodePoolCreated(USDT_USDC_POOL, USDT)] },
            ],
          }),
          mockBlock({ number: 5 }),
        ]),
      ],
      { head: { finalized: { number: 5, hash: '0x5' } } },
    )

    await createPoolFactory(db).ensurePreindexed({
      portal: new PortalClient({ url: mockPortal.url }),
      logger: createTestLogger(),
      range: { from: 1, to: 10 },
    })
    await mockPortal?.close()

    // Restart with a cap of 1: the gap [6..10] must not be scanned at all
    const queries: any[] = []
    mockPortal = await createMockPortal([streamResponse([mockBlock({ number: 10 })], captureQueries(queries))], {
      head: { finalized: { number: 10, hash: '0xa' } },
    })

    const entries: Record<string, any>[] = []
    const capped = createPoolFactory(db, { maxAddressFilterSize: 1 })
    const result = await capped.ensurePreindexed({
      portal: new PortalClient({ url: mockPortal.url }),
      logger: createTestLogger({ capture: (entry) => entries.push(entry) }),
      range: { from: 1, to: 10 },
    })

    expect(result).toBeNull()
    expect(queries).toHaveLength(0)
    expect(entries.map((entry) => entry['message']).join('\n')).toContain('more than 1')
    expect(await db.getPreindexedRange(await capped.preindexKey())).toEqual({ from: 1, to: 5 })
  })

  it('logs the pre-pass under a factory preindex prefix, without a duplicate start line', async () => {
    mockPortal = await createMockPortal(
      [
        streamResponse([
          mockBlock({ number: 1, transactions: [{ logs: [encodePoolCreated(WETH_USDC_POOL)] }] }),
          mockBlock({ number: 10 }),
        ]),
      ],
      { head: { finalized: { number: 10, hash: '0xa' } } },
    )

    const db = await contractFactoryStore({ path: ':memory:' })
    const poolFactory = createPoolFactory(db)

    const entries: Record<string, any>[] = []
    await poolFactory.ensurePreindexed({
      portal: new PortalClient({ url: mockPortal.url }),
      logger: createTestLogger({ capture: (entry) => entries.push(entry) }),
      range: { from: 1, to: 10 },
    })

    const messages = entries.map((entry) => entry['message'])
    expect(messages).toContainEqual(expect.stringContaining('factory preindex: scanning blocks 1…10'))
    expect(messages).toContainEqual(expect.stringContaining('factory preindex: finished'))

    // The nested scan stream must not announce itself as if the main loop started
    expect(messages.filter((message) => String(message).includes('Start indexing'))).toHaveLength(0)
  })

  it('prefixes pre-pass progress ticks and keeps the start hook silent', () => {
    const entries: Record<string, any>[] = []
    const logger = createTestLogger({ capture: (entry) => entries.push(entry) })

    const progress = {
      state: { initial: 1, last: 100, current: 50, percent: 50, etaSeconds: 90 },
      interval: {
        requests: {
          total: { count: 0 },
          successful: { count: 0, percent: 0 },
          rateLimited: { count: 0, percent: 0 },
          failed: { count: 0, percent: 0 },
        },
        processedBlocks: { count: 50, perSecond: 25 },
        bytesDownloaded: { count: 1024, perSecond: 512 },
      },
    }

    const handlers = preindexProgressHandlers()
    handlers.onStart?.({ state: { initial: 1 }, logger })
    handlers.onProgress?.({ progress, logger })

    expect(entries).toHaveLength(1)
    expect(entries[0]['message']).toBe('factory preindex: 50 / 100 (50%), ETA: 1m 30s')
    expect(entries[0]['blocks']).toBe('25 blocks/second')
  })

  it('fails loudly on a retried setup after the pre-pass failed, instead of silently dropping child requests', async () => {
    const db = await contractFactoryStore({ path: ':memory:' })

    const decoder = evmDecoder({
      range: { from: 1, to: 10 },
      contracts: createPoolFactory(db),
      events: { swaps: poolAbi.Swap },
    })

    const portal = { getHead: () => Promise.reject(new Error('portal is down')) } as unknown as PortalClient

    const setup = () => decoder.setupQuery({ query: new EvmQueryBuilder(), logger: createTestLogger(), portal })

    await expect(setup()).rejects.toThrow('portal is down')

    // A retry must not silently succeed with a query that carries no child-event requests
    await expect(setup()).rejects.toThrow('portal is down')
  })
})

describe('preindex range helpers', () => {
  it('preindexScanRange covers first-run, gap, extended-history and up-to-date cases', () => {
    // First run — no covered range yet
    expect(preindexScanRange({ from: 1, to: 10 }, null)).toEqual({ from: 1, to: 10 })

    // Upper gap
    expect(preindexScanRange({ from: 1, to: 10 }, { from: 1, to: 5 })).toEqual({ from: 6, to: 10 })

    // History extended below the covered range — full re-scan from the new lower bound
    expect(preindexScanRange({ from: 1, to: 10 }, { from: 5, to: 10 })).toEqual({ from: 1, to: 10 })

    // Already covered
    expect(preindexScanRange({ from: 1, to: 10 }, { from: 1, to: 10 })).toBeNull()
    expect(preindexScanRange({ from: 2, to: 8 }, { from: 1, to: 10 })).toBeNull()
  })

  it('mergePreindexedRanges merges contiguous ranges and drops disjoint coverage', () => {
    expect(mergePreindexedRanges({ from: 1, to: 10 }, null)).toEqual({ from: 1, to: 10 })

    // Adjacent and overlapping ranges merge
    expect(mergePreindexedRanges({ from: 6, to: 10 }, { from: 1, to: 5 })).toEqual({ from: 1, to: 10 })
    expect(mergePreindexedRanges({ from: 4, to: 10 }, { from: 1, to: 5 })).toEqual({ from: 1, to: 10 })

    // A disjoint scan must not claim the skipped blocks in between
    expect(mergePreindexedRanges({ from: 8, to: 10 }, { from: 1, to: 5 })).toEqual({ from: 8, to: 10 })
  })
})
