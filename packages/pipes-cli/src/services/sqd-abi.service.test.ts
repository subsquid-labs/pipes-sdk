import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SqdAbiService } from './sqd-abi.js'

describe('SQD Typegen Service', () => {
  const PROJECT_NAME = 'my-project'
  let tmpRoot: string
  let projectDir: string

  beforeEach(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), 'my-cli-'))
    projectDir = path.join(tmpRoot, PROJECT_NAME)
  })

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true })
  })

  it('should fetch the contract data', async () => {
    const contracts = ['0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2']
    const s = new SqdAbiService()
    const wethData = await s.getContractData('evm', 'ethereum-mainnet', contracts)

    expect(wethData).toEqual([
      {
        contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        contractEvents: [
          {
            anonymous: false,
            inputs: [
              {
                indexed: true,
                name: 'src',
                type: 'address',
              },
              {
                indexed: true,
                name: 'guy',
                type: 'address',
              },
              {
                indexed: false,
                name: 'wad',
                type: 'uint256',
              },
            ],
            name: 'Approval',
            type: 'event',
          },
          {
            anonymous: false,
            inputs: [
              {
                indexed: true,
                name: 'src',
                type: 'address',
              },
              {
                indexed: true,
                name: 'dst',
                type: 'address',
              },
              {
                indexed: false,
                name: 'wad',
                type: 'uint256',
              },
            ],
            name: 'Transfer',
            type: 'event',
          },
          {
            anonymous: false,
            inputs: [
              {
                indexed: true,
                name: 'dst',
                type: 'address',
              },
              {
                indexed: false,
                name: 'wad',
                type: 'uint256',
              },
            ],
            name: 'Deposit',
            type: 'event',
          },
          {
            anonymous: false,
            inputs: [
              {
                indexed: true,
                name: 'src',
                type: 'address',
              },
              {
                indexed: false,
                name: 'wad',
                type: 'uint256',
              },
            ],
            name: 'Withdrawal',
            type: 'event',
          },
        ],
        contractName: 'WETH9',
      },
    ])
  })

  it('should resolve implementation ABI for an EIP-1967 proxy contract', async () => {
    // Aave V3 Pool proxy on ethereum-mainnet. Proxy resolution should recurse
    // into the PoolInstance implementation and return its DeFi-specific events,
    // not the proxy's bare ABI (which only exposes `Upgraded`).
    const aaveV3Proxy = '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2'
    const s = new SqdAbiService()
    const [aaveV3ProxyData] = await s.getContractData('evm', 'ethereum-mainnet', [aaveV3Proxy])

    expect(aaveV3ProxyData).toBeDefined()
    // The service recurses into the implementation (`sqd-abi.ts:140`), so the
    // returned `contractAddress` is the implementation — not the proxy address
    // we passed in. Asserting they differ proves the recursion ran.
    expect(aaveV3ProxyData!.contractAddress.toLowerCase()).not.toBe(aaveV3Proxy.toLowerCase())
    expect(aaveV3ProxyData!.contractAddress).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(aaveV3ProxyData!.contractName).not.toMatch(/proxy/i)

    const eventNames = aaveV3ProxyData!.contractEvents.map((e) => e.name)
    // These are PoolInstance events — they do not exist on the proxy ABI
    // (which only has `Upgraded`), so their presence proves the proxy-resolution
    // path in SqdAbiService.fetchEvmContractData ran.
    for (const required of ['Supply', 'Borrow', 'Repay', 'LiquidationCall']) {
      expect(eventNames).toContain(required)
    }
  }, 30_000)

  it('keeps the deepest hop with events through a multi-level proxy chain', async () => {
    // USDC's chain is FiatTokenProxy (Proxy=1, only AdminChanged/Upgraded) →
    // FiatTokenV2_2 (Proxy=1, the real ERC-20 events) → SignatureChecker (a linked
    // library with no events). Both earlier hops report Proxy=1, so the walk must
    // land on FiatTokenV2_2's events rather than the proxy shell or the library.
    const usdc = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48'
    const s = new SqdAbiService()
    const [usdcData] = await s.getContractData('evm', 'ethereum-mainnet', [usdc])

    expect(usdcData).toBeDefined()
    const eventNames = usdcData!.contractEvents.map((e) => e.name)
    for (const required of ['Transfer', 'Approval', 'Mint', 'Burn']) {
      expect(eventNames).toContain(required)
    }
    // Not the bare proxy shell (AdminChanged/Upgraded only) and not the empty library.
    expect(usdcData!.contractName).not.toMatch(/proxy/i)
    expect(eventNames.length).toBeGreaterThan(2)
  }, 30_000)
})
