import { event, indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import { PortalRange, Transformer } from '~/core/index.js'
import { createTestLogger } from '~/tests/test-logger.js'
import { closeMockPortal, createMockPortal, MockPortal, MockResponse, readAll } from '~/tests/test-server.js'
import { commonAbis } from './abi/common.js'
import {
  DecodedEventPipeArgs,
  EventsMap,
  EventWithArgs,
  evmDecoder,
  IndexedKeys,
  IndexedParams,
} from './evm-decoder.js'
import { evmPortalSource } from './evm-portal-source.js'
import { EvmQueryBuilder } from './evm-query-builder.js'

async function captureQueryBuilder(decoder: Transformer<any, any, EvmQueryBuilder>) {
  const mockQueryBuilder = new EvmQueryBuilder()
  await decoder.query({
    queryBuilder: mockQueryBuilder,
    logger: createTestLogger(),
    portal: {} as any,
  })
  return mockQueryBuilder
}

describe('evmDecoder types', () => {
  it('type IndexedKeys picks indexed params from ERC20 Transfer', async () => {
    type Result = IndexedKeys<(typeof commonAbis.erc20.events.Transfer)['params']>
    expectTypeOf<Result>().toEqualTypeOf<'from' | 'to'>()
  })

  it('type IndexedParams picks indexed params from ERC20 Transfer', () => {
    type Result = IndexedParams<typeof commonAbis.erc20.events.Transfer>
    expectTypeOf<Result>().toEqualTypeOf<{
      from: string | string[]
      to: string | string[]
    }>()
  })

  it("type IndexedParams doesn't pick not indexed params from ERC20 Transfer", () => {
    type Result = IndexedParams<typeof commonAbis.erc20.events.Transfer>
    expectTypeOf<Result>().not.toEqualTypeOf<{
      from: string
      to: string
      value: number
    }>()
  })

  it('type EventWithArgs only allows for indexed params', () => {
    type Result = EventWithArgs<typeof commonAbis.erc20.events.Transfer>

    expectTypeOf<Result>().toEqualTypeOf<{
      event: typeof commonAbis.erc20.events.Transfer
      params: {
        from?: string | string[]
        to?: string | string[]
      }
    }>()

    expectTypeOf<Result>().not.toEqualTypeOf<{
      event: typeof commonAbis.erc20.events.Transfer
      params: {
        from?: string
        to?: string
        value?: bigint
      }
    }>()
  })

  it('type EventMap accepts only event ABI', () => {
    type Result = EventsMap<{
      Approval: typeof commonAbis.erc20.events.Approval
      Transfer: typeof commonAbis.erc20.events.Transfer
    }>

    expectTypeOf<Result>().toEqualTypeOf<{
      readonly Approval: typeof commonAbis.erc20.events.Approval
      readonly Transfer: typeof commonAbis.erc20.events.Transfer
    }>()
  })

  it('type EventMapWithArgs accepts both forms of events', () => {
    type Result = EventsMap<typeof commonAbis.erc20.events>
    expectTypeOf<Result>().toExtend<{
      Transfer:
        | typeof commonAbis.erc20.events.Transfer
        | {
            event: typeof commonAbis.erc20.events.Transfer
            params: {
              to?: string | string[]
              from?: string | string[]
            }
          }
      Approval:
        | typeof commonAbis.erc20.events.Approval
        | {
            event: typeof commonAbis.erc20.events.Approval
            params: {
              owner?: string | string[]
              spender?: string | string[]
            }
          }
    }>()
  })

  it('type EventsMap can receive mixed keys of EventMap and EventsMap', () => {
    type Result = EventsMap<typeof commonAbis.erc20.events>
    expectTypeOf<Result>().toExtend<{
      Transfer:
        | typeof commonAbis.erc20.events.Transfer
        | {
            event: typeof commonAbis.erc20.events.Transfer
            params: {
              from?: string | string[]
              to?: string | string[]
            }
          }
      Approval:
        | typeof commonAbis.erc20.events.Approval
        | {
            event: typeof commonAbis.erc20.events.Approval
            params: {
              owner?: string | string[]
              spender?: string | string[]
            }
          }
    }>()
  })

  it('type EventsMap should not receive not defined indexed params', () => {
    type Result = EventsMap<{
      Approval: {
        event: typeof commonAbis.erc20.events.Approval
        params: { spender: string; owner: string }
      }
    }>

    expectTypeOf<Result['Approval']>().not.toEqualTypeOf<{
      event: typeof commonAbis.erc20.events.Approval
      params: {
        owner?: string | string[]
        spender?: string | string
        // Values isn't indexed
        value?: bigint | bigint[]
      }
    }>()
  })

  it('type DecodedEventPipeArgs should receive both types of event definition', () => {
    type Result = DecodedEventPipeArgs<typeof commonAbis.erc20.events, string[]>
    expectTypeOf<Result>().toExtend<{
      range: PortalRange
      events: {
        Transfer:
          | typeof commonAbis.erc20.events.Transfer
          | {
              event: typeof commonAbis.erc20.events.Transfer
              params: {
                from?: string | string[]
                to?: string | string[]
              }
            }
        Approval:
          | typeof commonAbis.erc20.events.Approval
          | {
              event: typeof commonAbis.erc20.events.Approval
              params: {
                owner?: string | string[]
                spender?: string | string[]
              }
            }
      }
    }>()
  })
})

describe('evmDecoder queries', () => {
  it('should build query for events without params', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: commonAbis.erc20.events.Transfer,
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()
    const fields = capturedQueryBuilder.getFields()

    expect(requests).toHaveLength(1)
    expect(requests[0].request?.logs).toBeDefined()
    expect(requests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(requests[0].request?.logs?.[0]?.topic1).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic2).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.address).toEqual(contracts)
    expect(requests[0].request?.logs?.[0]?.transaction).toBe(true)
    expect(fields).toMatchObject({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
      transaction: {
        from: true,
        to: true,
        hash: true,
        sighash: true,
      },
      log: {
        address: true,
        topics: true,
        data: true,
        transactionHash: true,
        logIndex: true,
        transactionIndex: true,
      },
    })
  })

  it('should build query batching events without params together', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: commonAbis.erc20.events.Transfer,
        Approval: commonAbis.erc20.events.Approval,
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()
    const fields = capturedQueryBuilder.getFields()

    expect(requests).toHaveLength(1)
    expect(requests[0].request?.logs).toBeDefined()
    expect(requests[0].request?.logs?.[0]?.topic0).toEqual([
      commonAbis.erc20.events.Transfer.topic,
      commonAbis.erc20.events.Approval.topic,
    ])
    expect(requests[0].request?.logs?.[0]?.topic1).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic2).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.address).toEqual(contracts)
    expect(requests[0].request?.logs?.[0]?.transaction).toBe(true)
    expect(fields).toMatchObject({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
      transaction: {
        from: true,
        to: true,
        hash: true,
        sighash: true,
      },
      log: {
        address: true,
        topics: true,
        data: true,
        transactionHash: true,
        logIndex: true,
        transactionIndex: true,
      },
    })
  })

  it('should build query with corresponding topics for each param', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    // `from` is topic1 on ERC20 Transfer event
    const fromParamDecoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            from: '0x1',
          },
        },
      },
    })
    const fromDecoder = await captureQueryBuilder(fromParamDecoder)
    const fromRequests = fromDecoder.getRequests()
    expect(fromRequests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(fromRequests[0].request?.logs?.[0]?.topic1).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ])
    expect(fromRequests[0].request?.logs?.[0]?.topic2).toEqual(undefined)
    expect(fromRequests[0].request?.logs?.[0]?.topic3).toEqual(undefined)

    // `from` is topic2 on ERC20 Transfer event
    const toParamDecoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            to: '0x2',
          },
        },
      },
    })
    const toDecoder = await captureQueryBuilder(toParamDecoder)
    const toRequests = toDecoder.getRequests()
    expect(toRequests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(toRequests[0].request?.logs?.[0]?.topic1).toEqual(undefined)
    expect(toRequests[0].request?.logs?.[0]?.topic2).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    ])
    expect(fromRequests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
  })

  it('should build query for events with params', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            from: '0x1',
            to: '0x2',
          },
        },
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()
    const fields = capturedQueryBuilder.getFields()

    expect(requests).toHaveLength(1)
    expect(requests[0].request?.logs).toBeDefined()
    expect(requests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(requests[0].request?.logs?.[0]?.topic1).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ])
    expect(requests[0].request?.logs?.[0]?.topic2).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    ])
    expect(requests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.address).toEqual(contracts)
    expect(requests[0].request?.logs?.[0]?.transaction).toBe(true)
    expect(fields).toMatchObject({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
      transaction: {
        from: true,
        to: true,
        hash: true,
        sighash: true,
      },
      log: {
        address: true,
        topics: true,
        data: true,
        transactionHash: true,
        logIndex: true,
        transactionIndex: true,
      },
    })
  })

  it('event params should accept value or array of values', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            from: ['0x1', '0x2'],
            to: '0x3',
          },
        },
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()

    expect(requests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(requests[0].request?.logs?.[0]?.topic1).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000001',
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    ])
    expect(requests[0].request?.logs?.[0]?.topic2).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000003',
    ])
    expect(requests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
  })

  it('should build query with mixed events (with and without params)', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: commonAbis.erc20.events.Transfer,
        Approval: {
          event: commonAbis.erc20.events.Approval,
          params: {
            owner: '0x1',
            spender: '0x2',
          },
        },
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()
    const fields = capturedQueryBuilder.getFields()

    expect(requests).toHaveLength(2)

    expect(requests[0].request?.logs).toBeDefined()
    expect(requests[0].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Transfer.topic])
    expect(requests[0].request?.logs?.[0]?.topic1).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic2).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.topic3).toEqual(undefined)
    expect(requests[0].request?.logs?.[0]?.address).toEqual(contracts)
    expect(requests[0].request?.logs?.[0]?.transaction).toBe(true)

    expect(requests[1].request?.logs).toBeDefined()
    expect(requests[1].request?.logs?.[0]?.topic0).toEqual([commonAbis.erc20.events.Approval.topic])
    expect(requests[1].request?.logs?.[0]?.topic1).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000001',
    ])
    expect(requests[1].request?.logs?.[0]?.topic2).toEqual([
      '0x0000000000000000000000000000000000000000000000000000000000000002',
    ])
    expect(requests[1].request?.logs?.[0]?.topic3).toEqual(undefined)
    expect(requests[1].request?.logs?.[0]?.address).toEqual(contracts)
    expect(requests[1].request?.logs?.[0]?.transaction).toBe(true)

    expect(fields).toMatchObject({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
      transaction: {
        from: true,
        to: true,
        hash: true,
        sighash: true,
      },
      log: {
        address: true,
        topics: true,
        data: true,
        transactionHash: true,
        logIndex: true,
        transactionIndex: true,
      },
    })
  })

  it('should build multiple requests when more than one event with params are provided', async () => {
    const range = { from: 0, to: 100 }
    const contracts = ['0x123']

    const decoder = evmDecoder({
      range,
      contracts,
      events: {
        Transfer: {
          event: commonAbis.erc20.events.Transfer,
          params: {
            from: '0x1',
            to: '0x2',
          },
        },
        Approval: {
          event: commonAbis.erc20.events.Approval,
          params: {
            owner: '0x3',
            spender: '0x4',
          },
        },
      },
    })

    const capturedQueryBuilder = await captureQueryBuilder(decoder)

    const requests = capturedQueryBuilder.getRequests()
    const fields = capturedQueryBuilder.getFields()

    expect(requests).toHaveLength(2)
    expect(requests[0].request).toEqual({
      logs: [
        {
          topic0: [commonAbis.erc20.events.Transfer.topic],
          topic1: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
          topic2: ['0x0000000000000000000000000000000000000000000000000000000000000002'],
          topic3: undefined,
          address: contracts,
          transaction: true,
        },
      ],
    })
    expect(requests[1].request).toEqual({
      logs: [
        {
          topic0: [commonAbis.erc20.events.Approval.topic],
          topic1: ['0x0000000000000000000000000000000000000000000000000000000000000003'],
          topic2: ['0x0000000000000000000000000000000000000000000000000000000000000004'],
          topic3: undefined,
          address: contracts,
          transaction: true,
        },
      ],
    })

    expect(fields).toMatchObject({
      block: {
        number: true,
        hash: true,
        timestamp: true,
      },
      transaction: {
        from: true,
        to: true,
        hash: true,
        sighash: true,
      },
      log: {
        address: true,
        topics: true,
        data: true,
        transactionHash: true,
        logIndex: true,
        transactionIndex: true,
      },
    })
  })

  it('should build query for an event with indexed parameters around a non-indexed value', async () => {
    const abi = {
      CustomTransfer: event(
        '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
        'Transfer(address,uint256,address)',
        { from: indexed(p.address), value: p.uint256, to: indexed(p.address) },
      ),
    }

    const decoder = evmDecoder({
      range: { from: 0, to: 100 },
      contracts: ['0x123'],
      events: {
        Transfer: {
          event: abi.CustomTransfer,
          params: {
            from: '0x1',
            to: '0x2',
          },
        },
      },
    })
    const capturedQueryBuilder = await captureQueryBuilder(decoder)
    const requests = capturedQueryBuilder.getRequests()

    expect(requests).toHaveLength(1)
    expect(requests[0].request).toEqual({
      logs: [
        {
          topic0: [abi.CustomTransfer.topic],
          topic1: ['0x0000000000000000000000000000000000000000000000000000000000000001'],
          topic2: ['0x0000000000000000000000000000000000000000000000000000000000000002'],
          topic3: undefined,
          address: ['0x123'],
          transaction: true,
        },
      ],
    })
  })

  describe('evmDecoder duplicate events', () => {
    it('should log error when duplicate event topics are detected', async () => {
      const logger = createTestLogger()
      const errorSpy = vi.spyOn(logger, 'error')
      const duplicateEvent = commonAbis.erc20.events.Transfer
      const decoder = evmDecoder({
        range: { from: 0, to: 100 },
        contracts: ['0x123'],
        events: {
          transfers1: duplicateEvent,
          transfers2: duplicateEvent,
        },
      })

      await decoder.query({
        queryBuilder: new EvmQueryBuilder(),
        logger,
        portal: {} as any,
      })

      expect(errorSpy).toHaveBeenCalledTimes(1)

      const errorCall = errorSpy.mock.calls[0][0]
      expect(errorCall).toContain('Duplicate event topics detected')
      expect(errorCall).toContain('transfers1')
      expect(errorCall).toContain('transfers2')
      expect(errorCall).toContain(duplicateEvent.topic)

      errorSpy.mockRestore()
    })

    it('should log error when duplicate event topics are detected across AbiEvent and EventWithArgs', async () => {
      const logger = createTestLogger()
      const errorSpy = vi.spyOn(logger, 'error')
      const duplicateEvent = commonAbis.erc20.events.Transfer
      const decoder = evmDecoder({
        range: { from: 0, to: 100 },
        contracts: ['0x123'],
        events: {
          transfers1: duplicateEvent,
          transfers2: {
            event: duplicateEvent,
            params: {
              from: '0x1',
              to: '0x2',
            },
          },
        },
      })

      await decoder.query({
        queryBuilder: new EvmQueryBuilder(),
        logger,
        portal: {} as any,
      })

      expect(errorSpy).toHaveBeenCalledTimes(1)

      const errorCall = errorSpy.mock.calls[0][0]
      expect(errorCall).toContain('Duplicate event topics detected')
      expect(errorCall).toContain('transfers1')
      expect(errorCall).toContain('transfers2')
      expect(errorCall).toContain(duplicateEvent.topic)

      errorSpy.mockRestore()
    })

    it('should not log error when all events have unique topics', async () => {
      const logger = createTestLogger()
      const errorSpy = vi.spyOn(logger, 'error')

      const decoder = evmDecoder({
        range: { from: 0, to: 100 },
        contracts: ['0x123'],
        events: {
          transfers: commonAbis.erc20.events.Transfer,
          approvals: commonAbis.erc20.events.Approval,
        },
      })

      await decoder.query({
        queryBuilder: new EvmQueryBuilder(),
        logger,
        portal: {} as any,
      })

      expect(errorSpy).not.toHaveBeenCalled()

      errorSpy.mockRestore()
    })
  })
})

describe('evmDecoder transform', () => {
  let mockPortal: MockPortal

  beforeEach(async () => {
    if (mockPortal) closeMockPortal(mockPortal)
    mockPortal = await createMockPortal(PORTAL_MOCK_RESPONSE)
  })

  const PORTAL_MOCK_RESPONSE: MockResponse[] = [
    {
      statusCode: 200,
      data: [
        {
          header: { number: 1, hash: '0x1', timestamp: 2000 },
          logs: [
            {
              address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d',
                '0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f',
              ],
              logIndex: 0,
              transactionIndex: 0,
              transactionHash: '0xdeadbeef',
              data: '0x000000000000000000000000000000000000000000000000013737bc62530000',
            },
            {
              address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
              topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d',
                '0x0000000000000000000000003611b82c7b13e72b26eb0e9be0613bee7a45ac7c',
              ],
              logIndex: 1,
              transactionIndex: 1,
              transactionHash: '0xdeadbeef',
              data: '0x0000000000000000000000000000000000000000000000000100000000000000',
            },
            {
              address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
              topics: [
                '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
                '0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee',
                '0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff',
              ],
              logIndex: 2,
              transactionIndex: 2,
              transactionHash: '0xdeadbeef',
              data: '0x0000000000000000000000000000000000000000000000000100000000000000',
            },
          ],
        },
      ],
    },
  ]

  it('should decode the events when passed AbiEvent', async () => {
    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: commonAbis.erc20.events.Transfer,
          },
        }),
      )
      .pipe((e) => e.transfers)

    const res = await readAll(stream)

    expect(res).toMatchInlineSnapshot(`
      [
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0xc82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            "value": 87600000000000000n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x000000000000000000000000000000000000000000000000013737bc62530000",
            "logIndex": 0,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 0,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0x3611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            "value": 72057594037927936n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x0000000000000000000000000000000000000000000000000100000000000000",
            "logIndex": 1,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x0000000000000000000000003611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 1,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
      ]
    `)
  })

  it('should decode the events when passed an EventWithArgs', async () => {
    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            transfers: {
              event: commonAbis.erc20.events.Transfer,
              params: {
                from: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
              },
            },
          },
        }),
      )
      .pipe((e) => e.transfers)

    const res = await readAll(stream)
    expect(res).toMatchInlineSnapshot(`
      [
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0xc82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            "value": 87600000000000000n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x000000000000000000000000000000000000000000000000013737bc62530000",
            "logIndex": 0,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 0,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0x3611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            "value": 72057594037927936n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x0000000000000000000000000000000000000000000000000100000000000000",
            "logIndex": 1,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x0000000000000000000000003611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 1,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
      ]
    `)
  })

  it('should decode the events when mixed EventWithArgs and AbiEvent', async () => {
    const stream = evmPortalSource({
      portal: mockPortal.url,
    })
      .pipe(
        evmDecoder({
          range: { from: 0, to: 1 },
          events: {
            approvals: commonAbis.erc20.events.Approval,
            transfers: {
              event: commonAbis.erc20.events.Transfer,
              params: {
                from: '0x7a250d5630b4cf539739df2c5dacb4c659f2488d',
              },
            },
          },
        }),
      )
      .pipe((e) => [...e.transfers, ...e.approvals])

    const res = await readAll(stream)

    expect(res).toMatchInlineSnapshot(`
      [
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0xc82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            "value": 87600000000000000n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x000000000000000000000000000000000000000000000000013737bc62530000",
            "logIndex": 0,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x000000000000000000000000c82e11e709deb68f3631fc165ebd8b4e3fc3d18f",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 0,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "from": "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
            "to": "0x3611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            "value": 72057594037927936n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x0000000000000000000000000000000000000000000000000100000000000000",
            "logIndex": 1,
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x0000000000000000000000007a250d5630b4cf539739df2c5dacb4c659f2488d",
              "0x0000000000000000000000003611b82c7b13e72b26eb0e9be0613bee7a45ac7c",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 1,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
        {
          "block": {
            "hash": "0x1",
            "number": 1,
          },
          "contract": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
          "event": {
            "owner": "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "spender": "0xffffffffffffffffffffffffffffffffffffffff",
            "value": 72057594037927936n,
          },
          "factory": null,
          "rawEvent": {
            "address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
            "data": "0x0000000000000000000000000000000000000000000000000100000000000000",
            "logIndex": 2,
            "topics": [
              "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925",
              "0x000000000000000000000000eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
              "0x000000000000000000000000ffffffffffffffffffffffffffffffffffffffff",
            ],
            "transactionHash": "0xdeadbeef",
            "transactionIndex": 2,
          },
          "timestamp": 1970-01-01T00:33:20.000Z,
        },
      ]
    `)
  })
})
