import { indexed } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { commonAbis } from '../../../../../../packages/pipes/src/evm/index.js'
import { EventRegistry, ethereumRegistry, polygonRegistry } from './registry.js'
import { sigEvent } from './shared.js'

const TRANSFER_TOPIC = commonAbis.erc20.events.Transfer.topic
// Real mainnet USDC Transfer log layout: topic0 + from + to, value in data.
const TOPICS = [
  TRANSFER_TOPIC,
  '0x000000000000000000000000a0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
  '0x000000000000000000000000b0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
]
const DATA = '0x0000000000000000000000000000000000000000000000000000000005f5e100' // 100_000_000

function transfer() {
  return {
    signature: 'Transfer(address,address,uint256)',
    abi: sigEvent('Transfer(address,address,uint256)', {
      from: indexed(p.address),
      to: indexed(p.address),
      value: p.uint256,
    }),
  }
}

describe('EventRegistry', () => {
  it('decodes signature-registered events for any address', () => {
    const registry = new EventRegistry()
    registry.registerBySignature([transfer()])

    const decoded = registry.decodeEvent('0xany', TOPICS, DATA)

    expect(decoded).not.toBeNull()
    expect(decoded?.signature).toBe('Transfer(address,address,uint256)')
    expect(decoded?.eventHash).toBe(TRANSFER_TOPIC)
    expect(decoded?.namedArgs['value']).toBe(100_000_000n)
    expect(decoded?.protocol).toBeNull()
  })

  it('address registrations take precedence and carry the protocol label case-insensitively', () => {
    const registry = new EventRegistry()
    registry.registerBySignature([transfer()])
    registry.register('0xae7ab96520de3a18e5e111b5eaab095312d7fe84', [transfer()], 'Lido')

    expect(registry.decodeEvent('0xAE7AB96520DE3A18E5E111B5EAAB095312D7FE84', TOPICS, DATA)?.protocol).toBe('Lido')
    expect(registry.lookupProtocol('0xAE7AB96520DE3A18E5E111B5EAAB095312D7FE84')).toBe('Lido')
    expect(registry.lookupProtocol('0xunknown')).toBeUndefined()
  })

  it('returns null for unknown topic0 and for a registered topic with an undecodable payload', () => {
    const registry = new EventRegistry()
    registry.registerBySignature([transfer()])

    expect(registry.decodeEvent('0xany', ['0xdeadbeef'], '0x')).toBeNull()
    expect(registry.decodeEvent('0xany', TOPICS, '0x')).toBeNull()
  })

  it('ships populated per-chain registries', () => {
    // Any-address canonical decode must work on both chains.
    expect(ethereumRegistry.decodeEvent('0xany', TOPICS, DATA)).not.toBeNull()
    expect(polygonRegistry.decodeEvent('0xany', TOPICS, DATA)).not.toBeNull()
    // Well-known protocol addresses resolve.
    expect(ethereumRegistry.lookupProtocol('0xae7ab96520de3a18e5e111b5eaab095312d7fe84')).toBe('Lido')
    expect(polygonRegistry.lookupProtocol('0x794a61358d6845594f94dc1db02a252b5b4814ad')).toBe('Aave V3')
  })
})
