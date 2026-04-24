import { describe, expect, it } from 'vitest'

import { tokenBalancesTemplate } from './pipes/svm/token-balances/template.config.js'
import { getTemplate, getTemplates } from './registry.js'

describe('template registry', () => {
  it('returns the registered template by network + id', () => {
    expect(getTemplate('svm', 'tokenBalances')).toBe(tokenBalancesTemplate)
  })

  it('returns undefined for an unknown template id', () => {
    expect(getTemplate('svm', 'doesNotExist')).toBeUndefined()
  })

  it('lists all svm templates including adapted legacy ones', () => {
    const ids = getTemplates('svm').map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['tokenBalances', 'custom']))
  })

  it('lists all evm templates as adapted legacy Templates', () => {
    const ids = getTemplates('evm').map((t) => t.id)
    expect(ids).toEqual(expect.arrayContaining(['custom', 'erc20Transfers', 'uniswapV3Swaps']))
  })

  it('every registered template exposes render() and can be invoked with its defaultParams (if any)', () => {
    for (const template of getTemplates('evm')) {
      expect(typeof template.render).toBe('function')
      if (template.defaultParams === undefined && template.paramsSchema === undefined) {
        const artifacts = template.render(undefined, {
          network: 'ethereum-mainnet',
          projectPath: '/tmp',
          networkType: 'evm',
        })
        expect(artifacts).toHaveProperty('transformer')
      } else if (template.defaultParams !== undefined) {
        const artifacts = template.render(template.defaultParams, {
          network: 'ethereum-mainnet',
          projectPath: '/tmp',
          networkType: 'evm',
        })
        expect(artifacts).toHaveProperty('transformer')
      }
    }
    for (const template of getTemplates('svm')) {
      expect(typeof template.render).toBe('function')
      if (template.defaultParams === undefined && template.paramsSchema === undefined) {
        const artifacts = template.render(undefined, {
          network: 'solana-mainnet',
          projectPath: '/tmp',
          networkType: 'svm',
        })
        expect(artifacts).toHaveProperty('transformer')
      }
    }
  })
})
