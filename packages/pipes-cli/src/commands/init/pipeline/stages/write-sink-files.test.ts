import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { writeSinkFilesStage } from './write-sink-files.js'

describe('writeSinkFilesStage', () => {
  it('creates the .env file for a clickhouse sink', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      sink: 'clickhouse',
      templates: [
        {
          template: erc20,
          params: { contractAddresses: [], range: { from: '1' } },
        },
      ],
    })

    await writeSinkFilesStage.run(ctx)

    const env = writer.createFileCalls.find((c) => c.relativePath === '.env')
    expect(env?.content).toContain('CLICKHOUSE_URL=')
  })

  it('creates per-template migration files for a clickhouse sink', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      sink: 'clickhouse',
      templates: [
        {
          template: erc20,
          params: { contractAddresses: [], range: { from: '1' } },
        },
      ],
    })

    await writeSinkFilesStage.run(ctx)

    const paths = writer.createFileCalls.map((c) => c.relativePath)
    expect(paths).toContain('migrations/erc20Transfers-migration.sql')
  })

  it('creates a postgres .env file when sink is postgresql', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      sink: 'postgresql',
      templates: [
        {
          template: erc20,
          params: { contractAddresses: [], range: { from: '1' } },
        },
      ],
    })

    await writeSinkFilesStage.run(ctx)

    const env = writer.createFileCalls.find((c) => c.relativePath === '.env')
    expect(env?.content).toContain('DB_CONNECTION_STR=')
  })
})
