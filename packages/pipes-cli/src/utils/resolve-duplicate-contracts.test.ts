import { beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveDuplicateContractNames } from './resolve-duplicate-contracts.js'

type InputArgs = { message: string; default: string; validate: (v: string) => true | string }

describe('resolveDuplicateContractNames', () => {
  let promptFn: ReturnType<typeof vi.fn>

  beforeEach(() => {
    promptFn = vi.fn<(args: InputArgs) => Promise<string>>(async (args: InputArgs) => args.default)
  })

  it('is a no-op when no duplicate names exist', async () => {
    const contracts = [
      { contractAddress: '0xaaa', contractName: 'WETH' },
      { contractAddress: '0xbbb', contractName: 'USDC' },
    ]
    await resolveDuplicateContractNames(contracts, promptFn as never)
    expect(promptFn).not.toHaveBeenCalled()
    expect(contracts.map((c) => c.contractName)).toEqual(['WETH', 'USDC'])
  })

  it('uses address-derived defaults when duplicates have different addresses', async () => {
    const contracts = [
      { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', contractName: 'Token' },
      { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', contractName: 'Token' },
    ]
    await resolveDuplicateContractNames(contracts, promptFn as never)

    const defaults = promptFn.mock.calls.map(([args]) => (args as InputArgs).default)
    expect(defaults).toEqual(['Token_0xaaaa', 'Token_0xbbbb'])
    expect(new Set(contracts.map((c) => c.contractName)).size).toBe(2)
  })

  it('auto-bumps the default when duplicates share the same address', async () => {
    const contracts = [
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
    ]
    await resolveDuplicateContractNames(contracts, promptFn as never)

    const defaults = promptFn.mock.calls.map(([args]) => (args as InputArgs).default)
    expect(defaults).toEqual(['WETH_0xc02a', 'WETH_0xc02a_2'])
    expect(new Set(contracts.map((c) => c.contractName))).toEqual(new Set(['WETH_0xc02a', 'WETH_0xc02a_2']))
  })

  it('auto-bumps across three duplicates sharing one address', async () => {
    const contracts = [
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
    ]
    await resolveDuplicateContractNames(contracts, promptFn as never)

    const defaults = promptFn.mock.calls.map(([args]) => (args as InputArgs).default)
    expect(defaults).toEqual(['WETH_0xc02a', 'WETH_0xc02a_2', 'WETH_0xc02a_3'])
    expect(new Set(contracts.map((c) => c.contractName)).size).toBe(3)
  })

  it('validator rejects user input that collides with an already-used name', async () => {
    const contracts = [
      { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', contractName: 'Token' },
      { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', contractName: 'Token' },
    ]
    promptFn
      .mockImplementationOnce(async (args: InputArgs) => args.default)
      .mockImplementationOnce(async (args: InputArgs) => {
        const rejection = args.validate('Token_0xaaaa')
        expect(typeof rejection).toBe('string')
        expect(rejection as string).toContain('already in use')
        return 'Token_Renamed'
      })

    await resolveDuplicateContractNames(contracts, promptFn as never)
    expect(contracts.map((c) => c.contractName)).toEqual(['Token_0xaaaa', 'Token_Renamed'])
  })
})
