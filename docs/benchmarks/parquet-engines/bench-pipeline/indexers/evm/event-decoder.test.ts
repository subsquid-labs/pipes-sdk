import { afterEach, describe, expect, it, vi } from 'vitest'

import * as evmSdk from '../../../../../../packages/pipes/src/evm/index.js'
import { type EvmQueryBuilder, commonAbis } from '../../../../../../packages/pipes/src/evm/index.js'
import * as cacheModule from '../../cache.js'
import { ethereumEventDecoder, mapEventDecoder, polygonEventDecoder } from './event-decoder.js'
import { ethereumRegistry } from './registry.js'

const HEADER = { number: 21_000_000, hash: '0xblock', timestamp: 1_730_000_000, baseFeePerGas: 7_000_000_000n }

const TRANSFER_LOG = {
  logIndex: 3,
  transactionIndex: 1,
  transactionHash: '0xtx',
  address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  data: '0x0000000000000000000000000000000000000000000000000000000005f5e100',
  topics: [
    commonAbis.erc20.events.Transfer.topic,
    '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    '0x000000000000000000000000b0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  ],
}

const TX = {
  transactionIndex: 1,
  from: '0xFrom',
  to: '0xTo',
  value: 0n,
  gasUsed: 21_000n,
  effectiveGasPrice: 7_000_000_000n,
  type: 2,
}

describe('evm event-decoder', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('decodes a registered event, enriches with parent tx, and stringifies args', () => {
    const [row] = mapEventDecoder([{ header: HEADER, logs: [TRANSFER_LOG], transactions: [TX] }], ethereumRegistry)

    expect(row['event_signature']).toBe('Transfer(address,address,uint256)')
    expect(row['event_hash']).toBe(commonAbis.erc20.events.Transfer.topic)
    expect(row['address']).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
    expect(row['protocol']).toBe('USDC')
    expect(typeof row['named_args']).toBe('string')
    const namedArgs = JSON.parse(row['named_args'] as string) as { value: string }
    expect(namedArgs.value).toBe('100000000')
    expect(typeof row['args']).toBe('string')
    expect(JSON.parse(row['args'] as string)).toEqual([
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '0xb0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      '100000000',
    ])
    expect(row['transaction_from']).toBe('0xfrom')
    expect(row['transaction_value']).toBe('0')
    expect(row['gas_used']).toBe('21000')
    expect(row['base_fee_per_gas']).toBe('7000000000')
    expect(row['transaction_type']).toBe(2)
    expect(row['removed']).toBe(false)
  })

  it('retains registered-address protocol metadata for an unmatched log', () => {
    const [row] = mapEventDecoder(
      [
        {
          header: HEADER,
          logs: [{ ...TRANSFER_LOG, topics: ['0x1111111111111111111111111111111111111111111111111111111111111111'] }],
          transactions: [TX],
        },
      ],
      ethereumRegistry,
    )

    expect(row['event_signature']).toBe('')
    expect(row['args']).toBeNull()
    expect(row['named_args']).toBeNull()
    expect(row['protocol']).toBe('USDC')
  })

  it('emits empty protocol metadata for an unmatched log at an unregistered address', () => {
    const [row] = mapEventDecoder(
      [
        {
          header: HEADER,
          logs: [
            {
              ...TRANSFER_LOG,
              address: '0xUnregistered',
              topics: ['0x1111111111111111111111111111111111111111111111111111111111111111'],
            },
          ],
          transactions: [TX],
        },
      ],
      ethereumRegistry,
    )

    expect(row['event_signature']).toBe('')
    expect(row['args']).toBeNull()
    expect(row['named_args']).toBeNull()
    expect(row['protocol']).toBe('')
  })

  it('uses stable empty and zero fallbacks when optional event context is absent', () => {
    const [row] = mapEventDecoder(
      [
        {
          header: { ...HEADER, baseFeePerGas: null },
          logs: [
            {
              ...TRANSFER_LOG,
              address: null,
              data: null,
              topics: null,
            },
          ],
        },
      ],
      ethereumRegistry,
    )

    expect(row['address']).toBe('')
    expect(row['event_hash']).toBeNull()
    expect(row['topics']).toEqual([])
    expect(row['transaction_from']).toBe('')
    expect(row['transaction_to']).toBe('')
    expect(row['transaction_value']).toBe('0')
    expect(row['effective_gas_price']).toBe('0')
    expect(row['gas_used']).toBe('0')
    expect(row['base_fee_per_gas']).toBe('0')
    expect(row['transaction_type']).toBe(0)
  })

  it('registers both chain variants', () => {
    expect(ethereumEventDecoder.id).toBe('ethereum-event-decoder')
    expect(polygonEventDecoder.id).toBe('polygon-event-decoder')
    expect(ethereumEventDecoder.table.table).toBe('decoded_events')
    expect(ethereumEventDecoder.range).toEqual({ from: 21_000_000, to: 21_000_499 })
    expect(polygonEventDecoder.range).toEqual({ from: 65_000_000, to: 65_000_499 })

    for (const column of ['block_timestamp', 'transaction_hash', 'transaction_index', 'log_index'] as const) {
      expect(ethereumEventDecoder.table.schema[column]).not.toHaveProperty('optional')
      expect(polygonEventDecoder.table.schema[column]?.optional).toBe(true)
    }
  })

  it('forwards overrides into an unfiltered all-log query with parent transactions', () => {
    const cacheSpy = vi.spyOn(cacheModule, 'openCache').mockReturnValue(undefined)
    const portalStreamSpy = vi.spyOn(evmSdk, 'evmPortalStream')
    const range = { from: 123, to: 456 }

    ethereumEventDecoder.createStream({
      range,
      portal: 'http://mock-portal.test',
      cachePath: '/tmp/event-decoder-cache.sqlite',
    })

    expect(cacheSpy).toHaveBeenCalledWith('/tmp/event-decoder-cache.sqlite')
    expect(portalStreamSpy).toHaveBeenCalledOnce()
    const options = portalStreamSpy.mock.calls[0]?.[0]
    expect(options).toMatchObject({ id: 'bench-ethereum-event-decoder', portal: 'http://mock-portal.test' })

    const query = options?.outputs as Pick<EvmQueryBuilder, 'getFields' | 'getRequests'>
    expect(query.getRequests()).toEqual([{ range, request: { logs: [{ transaction: true }] } }])
    expect(query.getFields()).toEqual({
      block: { number: true, hash: true, timestamp: true, baseFeePerGas: true },
      log: {
        address: true,
        topics: true,
        data: true,
        logIndex: true,
        transactionHash: true,
        transactionIndex: true,
      },
      transaction: {
        transactionIndex: true,
        from: true,
        to: true,
        value: true,
        gasUsed: true,
        effectiveGasPrice: true,
        type: true,
      },
    })
  })
})
