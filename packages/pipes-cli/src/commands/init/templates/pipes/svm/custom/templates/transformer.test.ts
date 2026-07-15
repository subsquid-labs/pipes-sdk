import { describe, expect, it } from 'vitest'

import { CustomTemplateParams } from '../template.config.js'
import { buildDecoderGroups, renderTransformer } from './transformer.js'

const swap = { name: 'Swap', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }
const claim = { name: 'Claim', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }

const jupiterAddress = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const raydiumAddress = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'

function jupiter(range: { from: string; to?: string }, events = [swap]) {
  return {
    contractName: 'Jupiter',
    contractEvents: events,
    deployments: [{ address: jupiterAddress, range }],
  }
}

function raydium(range: { from: string; to?: string }, events = [swap]) {
  return {
    contractName: 'Raydium',
    contractEvents: events,
    deployments: [{ address: raydiumAddress, range }],
  }
}

function params(contracts: CustomTemplateParams['contracts']): CustomTemplateParams {
  return { contracts }
}

describe('SVM custom transformer', () => {
  it('emits a single decoder when all programs share a range', () => {
    const groups = buildDecoderGroups(params([jupiter({ from: '200000000' }), raydium({ from: '200000000' })]))
    expect(groups).toHaveLength(1)
    expect(groups[0]!.decoderId).toBe('custom')
    expect(groups[0]!.rangeFrom).toBe('200000000')
    expect(groups[0]!.programs).toHaveLength(2)
  })

  it('emits per-program decoders when ranges diverge', () => {
    const groups = buildDecoderGroups(params([jupiter({ from: '200000000' }), raydium({ from: 'latest' })]))
    expect(groups).toHaveLength(2)
    const byId = Object.fromEntries(groups.map((g) => [g.decoderId, g]))
    expect(byId['customJupiter']!.rangeFrom).toBe('200000000')
    expect(byId['customRaydium']!.rangeFrom).toBe('latest')
  })

  it('suffixes decoder ids when deployments of one program get their own decoders', () => {
    const twoDeployments = {
      contractName: 'Jupiter',
      contractEvents: [swap],
      deployments: [
        { address: jupiterAddress, range: { from: '100' } },
        { address: raydiumAddress, range: { from: '200' } },
      ],
    }
    const groups = buildDecoderGroups(params([twoDeployments]))
    expect(groups.map((g) => g.decoderId)).toEqual(['customJupiter', 'customJupiter2'])
  })

  it('preserves `latest` verbatim (no NaN coercion)', () => {
    const code = renderTransformer(params([jupiter({ from: 'latest' }), raydium({ from: '200000000' })]))
    expect(code).toContain("range: { from: 'latest' }")
    expect(code).toContain("range: { from: '200000000' }")
  })

  it('imports each program once, from its reference deployment', () => {
    const twoDeployments = {
      contractName: 'Jupiter',
      contractEvents: [swap],
      deployments: [
        { address: jupiterAddress, range: { from: '100' } },
        { address: raydiumAddress, range: { from: '200' } },
      ],
    }
    const code = renderTransformer(params([twoDeployments]))

    const importLines = code.split('\n').filter((l) => l.includes('from "./contracts/'))
    expect(importLines).toEqual([
      `import { instructions as jupiterInstructions } from "./contracts/${jupiterAddress}/index.js"`,
    ])
  })

  it('disambiguates duplicate instruction names across programs in a shared decoder', () => {
    const groups = buildDecoderGroups(params([jupiter({ from: '200000000' }), raydium({ from: '200000000' })]))
    const keys = groups[0]!.instructions.map((i) => i.uniqueKey)
    expect(keys).toEqual(['jupiterSwap', 'raydiumSwap'])
  })

  it('keeps bare instruction names when no collision exists in the group', () => {
    const groups = buildDecoderGroups(
      params([jupiter({ from: '200000000' }, [swap]), raydium({ from: '200000000' }, [claim])]),
    )
    const keys = groups[0]!.instructions.map((i) => i.uniqueKey)
    expect(keys).toEqual(['Swap', 'Claim'])
  })
})

describe('multi-deployment programs (Copilot round-2 regression)', () => {
  it('does not duplicate instruction keys when one program has several same-range deployments', () => {
    const params = {
      contracts: [
        {
          contractName: 'jupiter',
          contractEvents: [{ name: 'swap', type: 'event', inputs: [] }],
          deployments: [
            { address: 'Addr1111111111111111111111111111', range: { from: '10' } },
            { address: 'Addr2222222222222222222222222222', range: { from: '10' } },
          ],
        },
      ],
    }

    const groups = buildDecoderGroups(params)
    expect(groups).toHaveLength(1)
    // programId keeps every deployment address...
    expect(groups[0]!.programs.map((p) => p.contractAddress)).toEqual([
      'Addr1111111111111111111111111111',
      'Addr2222222222222222222222222222',
    ])
    // ...but each instruction key appears exactly once.
    const keys = groups[0]!.instructions.map((i) => i.uniqueKey)
    expect(keys).toEqual([...new Set(keys)])
    expect(keys).toEqual(['swap'])

    const rendered = renderTransformer(params)
    expect(rendered.match(/swap: jupiterInstructions\.swap/g)).toHaveLength(1)
  })
})
