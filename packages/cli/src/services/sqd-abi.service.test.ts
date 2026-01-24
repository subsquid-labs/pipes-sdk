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
})
