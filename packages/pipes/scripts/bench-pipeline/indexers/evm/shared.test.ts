import { indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { commonAbis, evmQuery } from '../../../../src/evm/index.js'
import { ethereum, polygon } from './chains.js'
import { bigintToHex, dec, dualRep, dualRepColumn, includeAllBlocks, jsonStringify, sigEvent } from './shared.js'

describe('evm chain configs', () => {
  it('defines the Ethereum benchmark dataset and schema features', () => {
    expect(ethereum).toEqual({
      id: 'ethereum',
      portalUrl: 'https://portal.sqd.dev/datasets/ethereum-mainnet',
      schemaShape: 'ethereum',
      features: { withdrawals: true, uncles: false },
    })
  })

  it('defines the Polygon benchmark dataset and schema features', () => {
    expect(polygon).toEqual({
      id: 'polygon',
      portalUrl: 'https://portal.sqd.dev/datasets/polygon-mainnet',
      schemaShape: 'standard',
      features: { withdrawals: false, uncles: true },
    })
  })
})

describe('evm shared helpers', () => {
  it('dec renders bigints/numbers as decimal strings and passes null through', () => {
    expect(dec(42n)).toBe('42')
    expect(dec(7)).toBe('7')
    expect(dec(null)).toBeNull()
    expect(dec(undefined)).toBeNull()
  })

  it('dualRep mirrors one scalar into both record fields', () => {
    expect(dualRep(10n ** 20n)).toEqual({
      string_value: '100000000000000000000',
      bignumeric_value: '100000000000000000000',
    })
    expect(dualRep(null)).toBeNull()
  })

  it('dualRepColumn declares the optional dual-representation struct', () => {
    expect(dualRepColumn()).toEqual({
      type: 'STRUCT',
      optional: true,
      fields: {
        string_value: { type: 'UTF8', optional: true },
        bignumeric_value: { type: 'UTF8', optional: true },
      },
    })
  })

  it('bigintToHex renders 0x-hex', () => {
    expect(bigintToHex(27n)).toBe('0x1b')
    expect(bigintToHex(null)).toBeNull()
  })

  it('jsonStringify renders bigints as decimal strings', () => {
    expect(jsonStringify({ value: 10n ** 19n })).toBe('{"value":"10000000000000000000"}')
  })

  it('jsonStringify rejects unsupported top-level values instead of returning undefined', () => {
    expect(() => jsonStringify(undefined)).toThrow(TypeError)
  })

  it('sigEvent computes the same topic0 as the SDK canonical ABI', () => {
    const transfer = sigEvent('Transfer(address,address,uint256)', {
      from: indexed(p.address),
      to: indexed(p.address),
      value: p.uint256,
    })

    expect(transfer.topic).toBe(commonAbis.erc20.events.Transfer.topic)
  })

  it('includeAllBlocks pushes a raw include-all data request', () => {
    const query = evmQuery().addFields({ block: { number: true } })
    includeAllBlocks(query, { from: 1, to: 5 })

    expect(query.getRequests()).toContainEqual({ range: { from: 1, to: 5 }, request: { includeAllBlocks: true } })
  })
})
