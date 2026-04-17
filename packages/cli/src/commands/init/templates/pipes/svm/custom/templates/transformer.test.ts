import { describe, expect, it } from 'vitest'

import { CustomTemplateParams } from '../template.config.js'
import { buildDecoderGroups, renderTransformer } from './transformer.js'

const swap = { name: 'Swap', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }
const claim = { name: 'Claim', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }

const jupiter = {
  contractAddress: 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',
  contractName: 'Jupiter',
  contractEvents: [swap],
}
const raydium = {
  contractAddress: 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
  contractName: 'Raydium',
  contractEvents: [swap],
}

function params(contracts: CustomTemplateParams['contracts']): CustomTemplateParams {
  return { contracts }
}

describe('SVM custom transformer', () => {
  it('emits a single decoder when all programs share a range', () => {
    const groups = buildDecoderGroups(
      params([
        { ...jupiter, range: { from: '200000000' } },
        { ...raydium, range: { from: '200000000' } },
      ]),
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.decoderId).toBe('custom')
    expect(groups[0]!.rangeFrom).toBe('200000000')
    expect(groups[0]!.programs).toHaveLength(2)
  })

  it('emits per-program decoders when ranges diverge', () => {
    const groups = buildDecoderGroups(
      params([
        { ...jupiter, range: { from: '200000000' } },
        { ...raydium, range: { from: 'latest' } },
      ]),
    )
    expect(groups).toHaveLength(2)
    const byId = Object.fromEntries(groups.map((g) => [g.decoderId, g]))
    expect(byId['customJupiter']!.rangeFrom).toBe('200000000')
    expect(byId['customRaydium']!.rangeFrom).toBe('latest')
  })

  it('preserves `latest` verbatim (no NaN coercion)', () => {
    const code = renderTransformer(
      params([
        { ...jupiter, range: { from: 'latest' } },
        { ...raydium, range: { from: '200000000' } },
      ]),
    )
    expect(code).toContain("range: { from: 'latest' }")
    expect(code).toContain("range: { from: '200000000' }")
  })

  it('disambiguates duplicate instruction names across programs in a shared decoder', () => {
    const groups = buildDecoderGroups(
      params([
        { ...jupiter, range: { from: '200000000' } },
        { ...raydium, range: { from: '200000000' } },
      ]),
    )
    const keys = groups[0]!.instructions.map((i) => i.uniqueKey)
    expect(keys).toEqual(['jupiterSwap', 'raydiumSwap'])
  })

  it('keeps bare instruction names when no collision exists in the group', () => {
    const groups = buildDecoderGroups(
      params([
        { ...jupiter, contractEvents: [swap], range: { from: '200000000' } },
        { ...raydium, contractEvents: [claim], range: { from: '200000000' } },
      ]),
    )
    const keys = groups[0]!.instructions.map((i) => i.uniqueKey)
    expect(keys).toEqual(['Swap', 'Claim'])
  })
})
