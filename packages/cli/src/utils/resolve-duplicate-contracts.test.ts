import { beforeEach, describe, expect, it, vi } from 'vitest'

const { inputMock } = vi.hoisted(() => ({
  inputMock: vi.fn((args: { default: string }) => Promise.resolve(args.default)),
}))

vi.mock('@inquirer/prompts', () => ({
  input: (...args: unknown[]) => inputMock(...args),
}))

import { resolveDuplicateContractNames } from './resolve-duplicate-contracts.js'

describe('resolveDuplicateContractNames', () => {
  beforeEach(() => {
    inputMock.mockClear()
    inputMock.mockImplementation((args: { default: string }) => Promise.resolve(args.default))
  })

  it('is a no-op when no duplicate names exist', async () => {
    const contracts = [
      { contractAddress: '0xaaa', contractName: 'WETH' },
      { contractAddress: '0xbbb', contractName: 'USDC' },
    ]
    await resolveDuplicateContractNames(contracts)
    expect(inputMock).not.toHaveBeenCalled()
    expect(contracts.map((c) => c.contractName)).toEqual(['WETH', 'USDC'])
  })

  it('uses address-derived defaults when duplicates have different addresses', async () => {
    const contracts = [
      { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', contractName: 'Token' },
      { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', contractName: 'Token' },
    ]
    await resolveDuplicateContractNames(contracts)

    const defaults = inputMock.mock.calls.map(([args]) => (args as { default: string }).default)
    expect(defaults).toEqual(['Token_0xaaaa', 'Token_0xbbbb'])
    expect(new Set(contracts.map((c) => c.contractName)).size).toBe(2)
  })

  it('auto-bumps the default when duplicates share the same address', async () => {
    const contracts = [
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
    ]
    await resolveDuplicateContractNames(contracts)

    const defaults = inputMock.mock.calls.map(([args]) => (args as { default: string }).default)
    expect(defaults).toEqual(['WETH_0xc02a', 'WETH_0xc02a_2'])
    expect(new Set(contracts.map((c) => c.contractName))).toEqual(new Set(['WETH_0xc02a', 'WETH_0xc02a_2']))
  })

  it('auto-bumps across three duplicates sharing one address', async () => {
    const contracts = [
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
      { contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', contractName: 'WETH' },
    ]
    await resolveDuplicateContractNames(contracts)

    const defaults = inputMock.mock.calls.map(([args]) => (args as { default: string }).default)
    expect(defaults).toEqual(['WETH_0xc02a', 'WETH_0xc02a_2', 'WETH_0xc02a_3'])
    expect(new Set(contracts.map((c) => c.contractName)).size).toBe(3)
  })

  it('rejects user input that collides with an already-used name', async () => {
    const contracts = [
      { contractAddress: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', contractName: 'Token' },
      { contractAddress: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', contractName: 'Token' },
    ]
    // first default accepted; second attempts to use same name as first
    inputMock.mockImplementationOnce((args: { default: string }) => Promise.resolve(args.default))
    inputMock.mockImplementationOnce((args: { validate: (v: string) => true | string }) => {
      const firstAttempt = args.validate('Token_0xaaaa')
      expect(typeof firstAttempt).toBe('string')
      expect(firstAttempt).toContain('already in use')
      return Promise.resolve('Token_Renamed')
    })

    await resolveDuplicateContractNames(contracts)

    expect(contracts.map((c) => c.contractName)).toEqual(['Token_0xaaaa', 'Token_Renamed'])
  })
})
