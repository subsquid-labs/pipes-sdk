import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { writeTargetFilesStage } from './write-target-files.js'

describe('writeTargetFilesStage', () => {
  it('creates the .env file for a clickhouse target', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      target: 'clickhouse',
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await writeTargetFilesStage.run(ctx)

    // .env is written preserve-existing so regeneration keeps user secrets.
    const env = writer.createFileIfAbsentCalls.find((c) => c.relativePath === '.env')
    expect(env?.content).toContain('CLICKHOUSE_URL=')
    expect(writer.createFileCalls.some((c) => c.relativePath === '.env')).toBe(false)
  })

  it('creates per-template migration files for a clickhouse target', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      target: 'clickhouse',
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await writeTargetFilesStage.run(ctx)

    const paths = writer.createFileCalls.map((c) => c.relativePath)
    expect(paths).toContain('migrations/erc20Transfers-migration.sql')
  })

  it('creates a postgres .env file when target is postgresql', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      target: 'postgresql',
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await writeTargetFilesStage.run(ctx)

    const env = writer.createFileIfAbsentCalls.find((c) => c.relativePath === '.env')
    expect(env?.content).toContain('DB_CONNECTION_STR=')
    expect(writer.createFileCalls.some((c) => c.relativePath === '.env')).toBe(false)
  })
})
