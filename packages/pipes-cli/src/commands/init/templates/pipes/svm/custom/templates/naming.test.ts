import { describe, expect, it } from 'vitest'

import { tableToSchemaName } from '../../../../../builders/schema-builder/index.js'
import { extractCreateTableNames, extractExportConstNames } from '../../../../../builders/target-builder/shared.js'
import { CustomTemplateParams, customTemplate } from '../template.config.js'

const swap = { name: 'Swap', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }
const claim = { name: 'Claim', type: 'event', inputs: [{ name: 'user', type: 'publicKey' }] }

const jupiterAddress = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4'
const raydiumAddress = 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'

function render(contracts: CustomTemplateParams['contracts']) {
  return customTemplate.render({ contracts }, {} as any)
}

/**
 * The insert targets, the Drizzle schema and the ClickHouse DDL are three renderings of
 * one set of names. They were derived independently and drifted: a program named
 * "Raydium AMM v4" inserted into `raydium_ammv_4_swap` while the DDL created
 * `raydium_amm_v4_swap`, so the generated project neither compiled nor wrote anywhere.
 */
describe('SVM custom table naming', () => {
  it('agrees across insert targets, Drizzle schema and ClickHouse DDL', () => {
    const artifacts = render([
      {
        contractName: 'Raydium AMM v4',
        contractEvents: [swap],
        deployments: [{ address: raydiumAddress, range: { from: '1' } }],
      },
    ])

    expect(artifacts.tables.map((t) => t.table)).toEqual(['raydium_amm_v4_swap'])
    expect(extractCreateTableNames(artifacts.clickhouseTable)).toEqual(['raydium_amm_v4_swap'])
    expect(extractExportConstNames(artifacts.postgresSchema)).toEqual(
      artifacts.tables.map((t) => tableToSchemaName(t.table)),
    )
  })

  it('keeps programs whose names normalize alike on separate tables', () => {
    const artifacts = render([
      {
        contractName: 'Foo Bar',
        contractEvents: [swap],
        deployments: [{ address: jupiterAddress, range: { from: '10' } }],
      },
      {
        contractName: 'foo_bar',
        contractEvents: [swap],
        deployments: [{ address: raydiumAddress, range: { from: '10' } }],
      },
    ])

    expect(artifacts.tables.map((t) => t.table)).toEqual(['foo_bar_swap', 'foo_bar_swap_2'])
    expect(extractCreateTableNames(artifacts.clickhouseTable)).toEqual(['foo_bar_swap', 'foo_bar_swap_2'])
    expect(extractExportConstNames(artifacts.postgresSchema)).toHaveLength(2)
  })

  it('shares one table between the per-range decoders of a single program', () => {
    const artifacts = render([
      {
        contractName: 'Jupiter',
        contractEvents: [swap, claim],
        deployments: [
          { address: jupiterAddress, range: { from: '10' } },
          { address: raydiumAddress, range: { from: '20' } },
        ],
      },
    ])

    expect(artifacts.decoderIds).toHaveLength(2)
    expect(extractCreateTableNames(artifacts.clickhouseTable)).toEqual(['jupiter_swap', 'jupiter_claim'])
    expect(artifacts.tables.map((t) => `${t.decoderId}:${t.table}`)).toEqual([
      'customJupiter:jupiter_swap',
      'customJupiter:jupiter_claim',
      'customJupiter2:jupiter_swap',
      'customJupiter2:jupiter_claim',
    ])
  })
})
