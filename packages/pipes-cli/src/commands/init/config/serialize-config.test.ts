import { describe, expect, it } from 'vitest'

import type { Config } from '~/types/init.js'

import { getTemplate } from '../templates/registry.js'
import { configJsonSchema } from './params.js'
import { PIPE_CONFIG_FILENAME, serializePipeConfig } from './serialize-config.js'

describe('serializePipeConfig', () => {
  const erc20 = getTemplate('evm', 'erc20Transfers')!

  const config: Config<'evm'> = {
    projectFolder: 'usdc-indexer',
    networkType: 'evm',
    defaultNetwork: 'ethereum-mainnet',
    packageManager: 'pnpm',
    target: 'postgresql',
    templates: [
      {
        template: erc20,
        params: { deployments: [{ address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', range: { from: 'latest' } }] },
      },
    ],
  }

  it('emits the --config input shape (templates as {templateId, params})', () => {
    const raw = JSON.parse(serializePipeConfig(config))

    expect(raw).toMatchObject({
      projectFolder: 'usdc-indexer',
      networkType: 'evm',
      defaultNetwork: 'ethereum-mainnet',
      packageManager: 'pnpm',
      target: 'postgresql',
      templates: [{ templateId: 'erc20Transfers' }],
    })
    expect(raw.templates[0].params.deployments[0].address).toBe('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
  })

  it('round-trips: the serialized config parses back through the --config schema', () => {
    const parsed = configJsonSchema.parse(JSON.parse(serializePipeConfig(config)))

    expect(parsed.networkType).toBe('evm')
    expect(parsed.defaultNetwork).toBe('ethereum-mainnet')
    expect(parsed.target).toBe('postgresql')
    expect(parsed.templates).toHaveLength(1)
    expect(parsed.templates[0]!.template.id).toBe('erc20Transfers')
  })

  it('uses a stable config filename', () => {
    expect(PIPE_CONFIG_FILENAME).toBe('pipes.config.json')
  })
})
