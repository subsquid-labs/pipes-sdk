import { describe, expect, it } from 'vitest'

import { btcToSatoshiBigInt, decodeScript, timestampToMonthDate } from './shared.js'

describe('btcToSatoshiBigInt', () => {
  it('converts BTC floats to satoshi bigints via fixed-point string math', () => {
    expect(btcToSatoshiBigInt(0.001)).toBe(100_000n)
    expect(btcToSatoshiBigInt(20.66284604)).toBe(2_066_284_604n)
    expect(btcToSatoshiBigInt(0)).toBe(0n)
  })

  it('maps null/undefined to 0n and throws on non-finite', () => {
    expect(btcToSatoshiBigInt(null)).toBe(0n)
    expect(btcToSatoshiBigInt(undefined)).toBe(0n)
    expect(() => btcToSatoshiBigInt(Number.NaN)).toThrow()
  })
})

describe('timestampToMonthDate', () => {
  it('returns the first UTC day of the month', () => {
    // 2025-05-20T14:00:00Z
    expect(timestampToMonthDate(1747749600).toISOString()).toBe('2025-05-01T00:00:00.000Z')
  })
})

describe('decodeScript', () => {
  it('decodes a P2PKH output to one address with 1 required signature', () => {
    // OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG (genesis-era style hash)
    const decoded = decodeScript('76a91462e907b15cbf27d5425399ebf6f0fb50ebb88f1888ac')

    expect(decoded.type).toBe('pubkeyhash')
    expect(decoded.addresses).toHaveLength(1)
    expect(decoded.requiredSignatures).toBe(1)
  })

  it('decodes a P2WPKH output', () => {
    const decoded = decodeScript('0014751e76e8199196d454941c45d1b3a323f1433bd6')

    expect(decoded.type).toBe('witness_v0_keyhash')
    expect(decoded.addresses).toEqual(['bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4'])
  })

  it('decodes a P2TR output', () => {
    const decoded = decodeScript('5120339ce7e165e67d93adb3fef88a6d4beed33f01fa876f05a225242b82a631abc0')

    expect(decoded.type).toBe('witness_v1_taproot')
    expect(decoded.addresses).toHaveLength(1)
  })

  it('returns nonstandard/empty for null, empty, and garbage scripts', () => {
    expect(decodeScript(null)).toEqual({ type: null, addresses: [], requiredSignatures: null })
    expect(decodeScript('deadbeef').addresses).toEqual([])
  })
})
