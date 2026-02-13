import { describe, expect, it } from 'vitest'

import { Config } from '~/types/init.js'

import { evmTemplates } from '../templates/pipes/evm/index.js'
import { configJsonSchema, configJsonSchemaRaw } from './params.js'

describe('--config params schema', () => {
  const wethMetadata = [
    {
      contractAddress: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      contractName: 'WETH9',
      contractEvents: [
        {
          inputs: [
            {
              name: 'src',
              type: 'address',
            },
            {
              name: 'guy',
              type: 'address',
            },
            {
              name: 'wad',
              type: 'uint256',
            },
          ],
          name: 'Approval',
          type: 'event',
        },
        {
          inputs: [
            {
              name: 'src',
              type: 'address',
            },
            {
              name: 'dst',
              type: 'address',
            },
            {
              name: 'wad',
              type: 'uint256',
            },
          ],
        name: 'Transfer',
        type: 'event',
      },
    ],
    range: { from: 'latest' },
  },
]

  const strictConfigSchema = {
    projectFolder: './morpho-blue-markets',
    networkType: 'evm',
    network: 'ethereum-mainnet',
    packageManager: 'bun',
    sink: 'clickhouse',
    templates: [
      {
        templateId: 'custom',
        params: {
          contracts: [
            {
              contractAddress: '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb',
              contractName: 'MorphoBlue',
              contractEvents: [
                {
                  name: 'Supply',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'caller', type: 'address' },
                    { name: 'onBehalf', type: 'address' },
                    { name: 'assets', type: 'uint256' },
                    { name: 'shares', type: 'uint256' },
                  ],
                },
                {
                  name: 'Withdraw',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'caller', type: 'address' },
                    { name: 'onBehalf', type: 'address' },
                    { name: 'receiver', type: 'address' },
                    { name: 'assets', type: 'uint256' },
                    { name: 'shares', type: 'uint256' },
                  ],
                },
                {
                  name: 'Borrow',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'caller', type: 'address' },
                    { name: 'onBehalf', type: 'address' },
                    { name: 'receiver', type: 'address' },
                    { name: 'assets', type: 'uint256' },
                    { name: 'shares', type: 'uint256' },
                  ],
                },
                {
                  name: 'Repay',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'caller', type: 'address' },
                    { name: 'onBehalf', type: 'address' },
                    { name: 'assets', type: 'uint256' },
                    { name: 'shares', type: 'uint256' },
                  ],
                },
                {
                  name: 'AccrueInterest',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'prevBorrowRate', type: 'uint256' },
                    { name: 'interest', type: 'uint256' },
                    { name: 'feeShares', type: 'uint256' },
                  ],
                },
                {
                  name: 'Liquidate',
                  type: 'event',
                  inputs: [
                    { name: 'id', type: 'bytes32' },
                    { name: 'caller', type: 'address' },
                    { name: 'borrower', type: 'address' },
                    { name: 'repaidAssets', type: 'uint256' },
                    { name: 'repaidShares', type: 'uint256' },
                    { name: 'seizedAssets', type: 'uint256' },
                    { name: 'badDebtAssets', type: 'uint256' },
                    { name: 'badDebtShares', type: 'uint256' },
                  ],
                },
              ],
              range: { from: 'latest' },
            },
          ],
        },
      },
    ],
  }

  it('should validate the config matching the strict schema', () => {
    expect(() => configJsonSchemaRaw.parse(strictConfigSchema)).to.not.throw()
  })

  it('should transform the raw config into Config<NetworkType> interface', () => {
    const config = configJsonSchema.parse(strictConfigSchema)
    const expectedConfig: Config<'evm'> = {
      projectFolder: './morpho-blue-markets',
      networkType: 'evm',
      network: 'ethereum-mainnet',
      packageManager: 'bun',
      sink: 'clickhouse',
      templates: [evmTemplates.custom.setParams({ contracts: wethMetadata })],
    }
    expect(config).to.deep.equal(expectedConfig)
  })

  it('should be able to parse the config, ignoring unknown fields', () => {
    const configJson = {
      projectFolder: 'test',
      networkType: 'evm',
      packageManager: 'pnpm',
      network: 'ethereum-mainnet',
      templates: [
        {
          templateId: 'custom',
          params: {
            contracts: [
              {
                contractAddress: '0xbbbbbbbbbb9cc5e90e3b3af64bdaf62c37eeffcb',
                contractName: 'Morpho',
                contractEvents: [
                  {
                    anonymous: false,
                    inputs: [
                      {
                        indexed: true,
                        internalType: 'Id',
                        name: 'id',
                        type: 'bytes32',
                      },
                      {
                        indexed: false,
                        internalType: 'address',
                        name: 'caller',
                        type: 'address',
                      },
                      {
                        indexed: true,
                        internalType: 'address',
                        name: 'onBehalf',
                        type: 'address',
                      },
                      {
                        indexed: true,
                        internalType: 'address',
                        name: 'receiver',
                        type: 'address',
                      },
                      {
                        indexed: false,
                        internalType: 'uint256',
                        name: 'assets',
                        type: 'uint256',
                      },
                      {
                        indexed: false,
                        internalType: 'uint256',
                        name: 'shares',
                        type: 'uint256',
                      },
                    ],
                    name: 'Borrow',
                    type: 'event',
                  },
                  {
                    anonymous: false,
                    inputs: [
                      {
                        indexed: true,
                        internalType: 'Id',
                        name: 'id',
                        type: 'bytes32',
                      },
                      {
                        components: [
                          {
                            internalType: 'address',
                            name: 'loanToken',
                            type: 'address',
                          },
                          {
                            internalType: 'address',
                            name: 'collateralToken',
                            type: 'address',
                          },
                          {
                            internalType: 'address',
                            name: 'oracle',
                            type: 'address',
                          },
                          {
                            internalType: 'address',
                            name: 'irm',
                            type: 'address',
                          },
                          {
                            internalType: 'uint256',
                            name: 'lltv',
                            type: 'uint256',
                          },
                        ],
                        indexed: false,
                        internalType: 'struct MarketParams',
                        name: 'marketParams',
                        type: 'tuple',
                      },
                    ],
                    name: 'CreateMarket',
                    type: 'event',
                  },
                  {
                    anonymous: false,
                    inputs: [
                      {
                        indexed: false,
                        internalType: 'uint256',
                        name: 'lltv',
                        type: 'uint256',
                      },
                    ],
                    name: 'EnableLltv',
                    type: 'event',
                  },
                ],
                range: { from: 'latest' },
              },
            ],
          },
        },
      ],
      sink: 'clickhouse',
    }

    expect(() => configJsonSchemaRaw.parse(configJson)).to.not.throw()
  })
})
