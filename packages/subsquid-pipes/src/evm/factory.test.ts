import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { afterEach, describe, expect, it } from 'vitest'
import { evmDecoder } from '~/evm/evm-decoder.js'
import { factory } from '~/evm/factory.js'
import { factorySqliteDatabase } from '~/evm/factory-adapters/sqlite.js'
import { createMemoryTarget } from '~/targets/memory/memory-target.js'
import { closeMockPortal, createMockPortal, MockPortal, readAll } from '../tests/index.js'
import { evmPortalSource } from './evm-portal-source.js'

const factoryAbi = {
  PoolCreated: event(
    '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118'.toLowerCase(),
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

describe('Factory', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should decode child event', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          {
            header: { number: 1, hash: '0x1', timestamp: 1000 },
            logs: [
              {
                address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
                topics: [
                  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
                  '0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                  '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                  '0x0000000000000000000000000000000000000000000000000000000000000bb8',
                ],
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000008ad599c3a0ff1de082011efddc58f1908eb6e6d8',
              },
            ],
          },
          {
            header: { number: 2, hash: '0x2', timestamp: 2000 },
            logs: [
              {
                address: '0xaaaaaac3a0ff1de082011efddc58f1908eb6e6d8', // should be skipped
                topics: [
                  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                  '0x000000000000000000000000def1cafe0000000000000000000000000000dead',
                  '0x000000000000000000000000beef0000000000000000000000000000deadbeef',
                ],
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005',
              },
              {
                address: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8', // should be decoded
                topics: [
                  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                  '0x000000000000000000000000def1cafe0000000000000000000000000000dead',
                  '0x000000000000000000000000beef0000000000000000000000000000deadbeef',
                ],
                logIndex: 1,
                transactionIndex: 1,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005',
              },
            ],
          },
        ],
      },
    ])

    const db = await factorySqliteDatabase({ path: ':memory:' })
    const stream = evmPortalSource({
      portal: mockPortal.url,
    }).pipe(
      evmDecoder({
        range: { from: 1, to: 2 },
        contracts: factory({
          address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
          event: factoryAbi.PoolCreated,
          parameter: 'pool',
          database: db,
        }),
        events: {
          swaps: poolAbi.Swap,
        },
      }).pipe((d) => d.swaps),
    )

    const res = await readAll(stream)
    expect(res).toMatchInlineSnapshot(`
      [
        {
          "block": {
            "hash": "0x2",
            "number": 2,
          },
          "contract": "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
          "event": {
            "amount0": 1n,
            "amount1": 2n,
            "liquidity": 4n,
            "recipient": "0xbeef0000000000000000000000000000deadbeef",
            "sender": "0xdef1cafe0000000000000000000000000000dead",
            "sqrtPriceX96": 3n,
            "tick": 0,
          },
          "factory": {
            "blockNumber": 1,
            "contract": "0x1f98431c8ad98523631ae4a59f267346ea31f984",
            "event": {
              "fee": 3000,
              "pool": "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
              "tickSpacing": 10,
              "token0": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
              "token1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
            },
          },
          "rawEvent": {
            "address": "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
            "data": "0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005",
            "logIndex": 1,
            "topics": [
              "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67",
              "0x000000000000000000000000def1cafe0000000000000000000000000000dead",
              "0x000000000000000000000000beef0000000000000000000000000000deadbeef",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 1,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
      ]
    `)

    const contracts = await db.all()
    expect(contracts).toMatchInlineSnapshot(`
      [
        {
          "blockNumber": 1,
          "childAddress": "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
          "event": {
            "fee": 3000,
            "pool": "0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8",
            "tickSpacing": 10,
            "token0": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "token1": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          },
          "factoryAddress": "0x1f98431c8ad98523631ae4a59f267346ea31f984",
          "logIndex": 0,
          "transactionIndex": 0,
        },
      ]
    `)
  })

  it('should set event with same topic to correct factory', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          {
            header: { number: 1, hash: '0x1', timestamp: 1000 },
            logs: [
              {
                address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
                topics: [
                  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
                  '0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                  '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                  '0x0000000000000000000000000000000000000000000000000000000000000bb8',
                ],
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000008ad599c3a0ff1de082011efddc58f1908eb6e6d8',
              },
            ],
          },
          {
            header: { number: 2, hash: '0x2', timestamp: 2000 },
            logs: [
              {
                address: '0xaaaaaac3a0ff1de082011efddc58f1908eb6e6d8', // should be skipped
                topics: [
                  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                  '0x000000000000000000000000def1cafe0000000000000000000000000000dead',
                  '0x000000000000000000000000beef0000000000000000000000000000deadbeef',
                ],
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005',
              },
              {
                address: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8', // should be decoded
                topics: [
                  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                  '0x000000000000000000000000def1cafe0000000000000000000000000000dead',
                  '0x000000000000000000000000beef0000000000000000000000000000deadbeef',
                ],
                logIndex: 1,
                transactionIndex: 1,
                transactionHash: '0xdeadbeef',
                data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005',
              },
            ],
          },
        ],
      },
    ])

    const db = await factorySqliteDatabase({ path: ':memory:' })
    const stream = evmPortalSource({
      portal: mockPortal.url,
    }).pipeComposite({
      v1: evmDecoder({
        range: { from: 1, to: 2 },
        contracts: factory({
          address: '0x00000000000000000000000000000000000000000',
          event: factoryAbi.PoolCreated,
          parameter: 'pool',
          database: db,
        }),
        events: {
          swaps: poolAbi.Swap,
        },
      }),
      v2: evmDecoder({
        range: { from: 1, to: 2 },
        contracts: factory({
          address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
          event: factoryAbi.PoolCreated,
          parameter: 'pool',
          database: db,
        }),
        events: {
          swaps: poolAbi.Swap,
        },
      }),
    })

    let v1: any[] = []
    let v2: any[] = []
    for await (const chunk of stream) {
      v1 = [...v1, ...chunk.data.v1.swaps]
      v2 = [...v2, ...chunk.data.v2.swaps]
    }

    expect(v1).toHaveLength(0)
    expect(v2).toHaveLength(1)
  })

  it('should handle fork', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          {
            header: { number: 1, hash: '0x1', timestamp: 1000 },
            logs: [],
          },
          // this block will be forked
          {
            header: { number: 2, hash: '0x2', timestamp: 2000 },
            logs: [
              {
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
                topics: [
                  '0x783cca1c0412dd0d695e784568c96da2e9c22ff989357a2e8b1d9b2b4e6b7118',
                  '0x000000000000000000000000c02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
                  '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
                  '0x0000000000000000000000000000000000000000000000000000000000000bb8',
                ],
                data: '0x000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000008ad599c3a0ff1de082011efddc58f1908eb6e6d7',
              },
            ],
          },
        ],
        finalizedHead: { number: 1, hash: '0x1' },
      },
      {
        statusCode: 409,
        data: {
          previousBlocks: [{ number: 1, hash: '0x1' }],
        },
      },

      {
        statusCode: 200,
        data: [
          {
            header: { number: 2, hash: '0x2a', timestamp: 3000 },
            logs: [
              // this event should not be decoded as the pool address became invalid after the fork
              {
                logIndex: 0,
                transactionIndex: 0,
                transactionHash: '0xdeadbeef',
                address: '0x8ad599c3a0ff1de082011efddc58f1908eb6e6d8',
                topics: [
                  '0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67',
                  '0x000000000000000000000000def1cafe0000000000000000000000000000dead',
                  '0x000000000000000000000000beef0000000000000000000000000000deadbeef',
                ],
                data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000400000000000000000000000000000000000000000000000000000000000000005',
              },
            ],
          },
          {
            header: { number: 3, hash: '0x3a', timestamp: 3000 },
            logs: [],
          },
        ],
        finalizedHead: { number: 3, hash: '0x3a' },
      },
    ])

    const res: any[] = []

    const db = await factorySqliteDatabase({ path: ':memory:' })

    await evmPortalSource({
      portal: {
        url: mockPortal.url,
      },
    })
      .pipe(
        evmDecoder({
          range: { from: 1, to: 3 },
          contracts: factory({
            address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
            event: factoryAbi.PoolCreated,
            parameter: 'pool',
            database: db,
          }),
          events: {
            swaps: poolAbi.Swap,
          },
        }).pipe((d) =>
          d.swaps.map((s) => {
            return {
              ...s,
              blockNumber: s.block.number,
            }
          }),
        ),
      )
      .pipeTo(
        createMemoryTarget({
          onData: (data) => {
            res.push(data)
          },
        }),
      )

    expect(res).toMatchInlineSnapshot(`[]`)

    const contracts = await db.all()
    expect(contracts).toMatchInlineSnapshot(`[]`)
  })
})
