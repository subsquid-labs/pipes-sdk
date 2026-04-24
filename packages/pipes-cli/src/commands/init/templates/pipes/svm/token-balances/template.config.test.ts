import { describe, expect, it } from 'vitest'

import { getTemplateDirname } from '~/utils/fs.js'
import { TemplateReader } from '~/utils/template-reader.js'

import { tokenBalancesTemplate } from './template.config.js'

describe('tokenBalancesTemplate (defineTemplate)', () => {
  const ctx = {
    network: 'solana-mainnet',
    projectPath: '/tmp/project',
    networkType: 'svm' as const,
  }

  it('has the expected identity metadata', () => {
    expect(tokenBalancesTemplate.id).toBe('tokenBalances')
    expect(tokenBalancesTemplate.name).toBe('Token balances')
    expect(tokenBalancesTemplate.networkType).toBe('svm')
  })

  it('render() returns artifacts matching the static template files', () => {
    const reader = new TemplateReader(getTemplateDirname('svm'), 'token-balances')

    const artifacts = tokenBalancesTemplate.render(undefined, ctx)

    expect(artifacts.transformer).toBe(reader.readTransformer())
    expect(artifacts.postgresSchema).toBe(reader.readPgTable())
    expect(artifacts.clickhouseTable).toBe(reader.readClickhouseTable())
    expect(artifacts.decoderIds).toEqual(['tokenBalances'])
  })
})
