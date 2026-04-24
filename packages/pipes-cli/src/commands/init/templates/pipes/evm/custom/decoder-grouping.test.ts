import { describe, expect, it } from 'vitest'

import { type ContractWithRange, groupContractsForDecoders } from './decoder-grouping.js'

const transferEvent = {
  name: 'Transfer',
  type: 'event',
  inputs: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

const approvalEvent = {
  name: 'Approval',
  type: 'event',
  inputs: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
  ],
}

function weth(range: ContractWithRange['range']): ContractWithRange {
  return {
    contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
    contractName: 'WETH',
    contractEvents: [transferEvent, approvalEvent],
    range,
  }
}

function usdc(range: ContractWithRange['range']): ContractWithRange {
  return {
    contractAddress: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    contractName: 'USDC',
    contractEvents: [transferEvent, approvalEvent],
    range,
  }
}

describe('groupContractsForDecoders', () => {
  it('returns a single shared decoder when events and ranges all match', () => {
    const grouping = groupContractsForDecoders([weth({ from: '4719568' }), usdc({ from: '4719568' })])
    expect(grouping.shared).toBe(true)
    expect(grouping.groups).toHaveLength(1)
    expect(grouping.groups[0]!.decoderId).toBe('custom')
    expect(grouping.groups[0]!.contracts).toHaveLength(2)
  })

  it('splits into per-contract decoders when ranges differ by `from`', () => {
    const grouping = groupContractsForDecoders([weth({ from: '4719568' }), usdc({ from: '6082465' })])
    expect(grouping.shared).toBe(false)
    expect(grouping.groups).toHaveLength(2)
    expect(grouping.groups[0]!.range.from).toBe('4719568')
    expect(grouping.groups[1]!.range.from).toBe('6082465')
    const decoderIds = grouping.groups.map((g) => g.decoderId)
    expect(new Set(decoderIds).size).toBe(2)
  })

  it('splits into per-contract decoders when ranges differ by `to`', () => {
    const grouping = groupContractsForDecoders([
      weth({ from: '4719568', to: '10000000' }),
      usdc({ from: '4719568' }),
    ])
    expect(grouping.shared).toBe(false)
    expect(grouping.groups).toHaveLength(2)
  })

  it('splits into per-contract decoders when events differ regardless of range', () => {
    const customWeth = weth({ from: '4719568' })
    const customUsdc = usdc({ from: '4719568' })
    customUsdc.contractEvents = [transferEvent] // differs from WETH
    const grouping = groupContractsForDecoders([customWeth, customUsdc])
    expect(grouping.shared).toBe(false)
    expect(grouping.groups).toHaveLength(2)
  })

  it('single-contract input returns one decoder with that contract', () => {
    const grouping = groupContractsForDecoders([weth({ from: '4719568' })])
    expect(grouping.shared).toBe(false)
    expect(grouping.groups).toHaveLength(1)
    expect(grouping.groups[0]!.decoderId).toBe('custom')
  })

  it('returns empty when contracts have no selected events', () => {
    const bare = { ...weth({ from: 'latest' }), contractEvents: [] }
    const grouping = groupContractsForDecoders([bare])
    expect(grouping.groups).toHaveLength(0)
  })
})
