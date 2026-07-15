import { describe, expect, it, vi } from 'vitest'

import { customTemplate, getGrouping } from './template.config.js'

const ctx = {
  network: 'ethereum-mainnet',
  projectPath: '/tmp/project',
  networkType: 'evm' as const,
}

const weth = {
  contractName: 'WETH9',
  contractEvents: [
    {
      name: 'Approval',
      type: 'event',
      inputs: [
        { name: 'src', type: 'address' },
        { name: 'guy', type: 'address' },
        { name: 'wad', type: 'uint256' },
      ],
    },
  ],
  deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: 'latest' } }],
}

describe('evm customTemplate', () => {
  it('has identity metadata', () => {
    expect(customTemplate.id).toBe('custom')
    expect(customTemplate.networkType).toBe('evm')
  })

  it('render() produces artifacts with decoder ids grouped by contract', () => {
    const artifacts = customTemplate.render({ contracts: [weth] }, ctx)
    expect(artifacts.transformer).toContain('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2')
    expect(artifacts.postgresSchema).toContain('weth9ApprovalTable')
    expect(artifacts.clickhouseTable.toLowerCase()).toContain('create table')
    expect(artifacts.decoderIds.length).toBeGreaterThan(0)
  })

  it('render() imports typegen output from the reference deployment even when ranges split decoders', () => {
    const twoDeployments = {
      ...weth,
      deployments: [
        { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '4719568' } },
        { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', range: { from: '6082465' } },
      ],
    }
    const artifacts = customTemplate.render({ contracts: [twoDeployments] }, ctx)

    // Divergent ranges: one decoder per deployment, name collision gets a numeric suffix.
    expect(artifacts.decoderIds).toEqual(['customWeth9', 'customWeth92'])

    // A single deduped import at the top, pointing at the reference (first) deployment.
    const importLines = artifacts.transformer.split('\n').filter((l) => l.includes('from "./contracts/'))
    expect(importLines).toEqual([
      'import { events as weth9Events } from "./contracts/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2.js"',
    ])
  })

  it('getGrouping() is deterministic for the same params', () => {
    const params = { contracts: [weth] }
    expect(getGrouping(params)).toEqual(getGrouping(params))
  })

  it('prompt() fetches contract metadata, selects events, and collects deployments', async () => {
    const referenceAddress = weth.deployments[0]!.address
    const fetchedMeta = [
      {
        contractAddress: referenceAddress,
        contractName: 'WETH9',
        contractEvents: weth.contractEvents,
      },
    ]
    const abiService = {
      getContractData: vi.fn(async () => fetchedMeta),
    }
    const promptCtx = {
      text: vi.fn(async () => referenceAddress),
      confirm: vi.fn(async () => false),
      select: vi.fn(),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn(async () => ({ from: '10' })),
      abiService: abiService as any,
      network: 'ethereum-mainnet',
    }

    const params = await customTemplate.prompt!(promptCtx)

    expect(abiService.getContractData).toHaveBeenCalledWith('evm', 'ethereum-mainnet', [referenceAddress])
    expect(params.contracts).toHaveLength(1)
    expect(params.contracts[0].contractName).toBe('WETH9')
    expect(params.contracts[0].contractEvents).toEqual([weth.contractEvents[0]])
    expect(params.contracts[0].deployments).toEqual([{ address: referenceAddress, range: { from: '10' } }])
    // One confirm for "add another deployment", one for "add another contract".
    expect(promptCtx.confirm).toHaveBeenCalledTimes(2)
  })

  it('prompt() loops for additional deployments of the same contract', async () => {
    const referenceAddress = weth.deployments[0]!.address
    const extraAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const abiService = {
      getContractData: vi.fn(async () => [
        { contractAddress: referenceAddress, contractName: 'WETH9', contractEvents: weth.contractEvents },
      ]),
    }
    const promptCtx = {
      text: vi
        .fn()
        .mockResolvedValueOnce(referenceAddress) // contract address
        .mockResolvedValueOnce(extraAddress), // extra deployment address
      confirm: vi
        .fn()
        .mockResolvedValueOnce(true) // add another deployment? yes
        .mockResolvedValueOnce(false) // add another deployment? no
        .mockResolvedValueOnce(false), // add another contract? no
      select: vi.fn(),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn().mockResolvedValueOnce({ from: '10' }).mockResolvedValueOnce({ from: '20' }),
      abiService: abiService as any,
      network: 'ethereum-mainnet',
    }

    const params = await customTemplate.prompt!(promptCtx)

    expect(abiService.getContractData).toHaveBeenCalledTimes(1)
    expect(params.contracts).toHaveLength(1)
    expect(params.contracts[0].deployments).toEqual([
      { address: referenceAddress, range: { from: '10' } },
      { address: extraAddress, range: { from: '20' } },
    ])
  })

  it('prompt() recovers from a contract with no trackable events and lets the user pick another', async () => {
    const eventlessAddress = '0x1111111111111111111111111111111111111111'
    const goodAddress = weth.deployments[0]!.address
    const abiService = {
      getContractData: vi
        .fn()
        .mockResolvedValueOnce([{ contractAddress: eventlessAddress, contractName: 'Eventless', contractEvents: [] }])
        .mockResolvedValueOnce([
          { contractAddress: goodAddress, contractName: 'WETH9', contractEvents: weth.contractEvents },
        ]),
    }
    const promptCtx = {
      text: vi.fn().mockResolvedValueOnce(eventlessAddress).mockResolvedValueOnce(goodAddress),
      confirm: vi.fn(async () => false),
      // The eventless contract triggers the retry menu; the user chooses to retry.
      select: vi.fn(async () => 'retry'),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn(async () => ({ from: 'latest' })),
      abiService: abiService as any,
      network: 'ethereum-mainnet',
    }

    const params = await customTemplate.prompt!(promptCtx)

    expect(promptCtx.select).toHaveBeenCalledTimes(1)
    expect(abiService.getContractData).toHaveBeenCalledTimes(2)
    expect(params.contracts).toHaveLength(1)
    expect(params.contracts[0].contractName).toBe('WETH9')
  })

  it('prompt() tells the user when an entered address resolves to a proxy implementation', async () => {
    const proxyAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const implementationAddress = '0x43506849d7c04f9138d1a2050bbf3a0c054402dd'
    const abiService = {
      // getContractData resolves the proxy and returns the implementation's address + events.
      getContractData: vi.fn(async () => [
        { contractAddress: implementationAddress, contractName: 'FiatTokenV2_2', contractEvents: weth.contractEvents },
      ]),
    }
    const promptCtx = {
      text: vi.fn(async () => proxyAddress),
      confirm: vi.fn(async () => false),
      select: vi.fn(),
      checkbox: vi.fn(async (_msg: string, choices: Array<{ value: any }>) => [choices[0].value]),
      blockRange: vi.fn(async () => ({ from: 'latest' })),
      abiService: abiService as any,
      network: 'ethereum-mainnet',
    }
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})

    await customTemplate.prompt!(promptCtx)

    const proxyNotice = logSpy.mock.calls.map((c) => String(c[0])).find((line) => line.includes('is a proxy'))
    expect(proxyNotice).toBeDefined()
    expect(proxyNotice).toContain(implementationAddress)
    logSpy.mockRestore()
  })

  it('prompt() cancels the template when the user skips after a fetch error', async () => {
    const badAddress = '0x1111111111111111111111111111111111111111'
    const abiService = {
      getContractData: vi.fn(async () => {
        throw new Error('The contract code for 0x1111… is not verified on Polygon.')
      }),
    }
    const promptCtx = {
      text: vi.fn(async () => badAddress),
      confirm: vi.fn(async () => false),
      // The fetch error triggers the retry menu; the user chooses to skip.
      select: vi.fn(async () => 'skip'),
      checkbox: vi.fn(),
      blockRange: vi.fn(),
      abiService: abiService as any,
      network: 'polygon-mainnet',
    }

    await expect(customTemplate.prompt!(promptCtx)).rejects.toMatchObject({ name: 'TemplatePromptCancelled' })
    expect(promptCtx.select).toHaveBeenCalledTimes(1)
  })
})
