import { describe, expect, it } from 'vitest'

import { makeTestContext } from '../testing/make-context.js'
import { writeConfigFilesStage } from './write-config-files.js'

describe('writeConfigFilesStage', () => {
  it('writes the ordered config files for pnpm + clickhouse', async () => {
    const { ctx, writer } = makeTestContext({ packageManager: 'pnpm', sink: 'clickhouse' })

    await writeConfigFilesStage.run(ctx)

    const written = writer.createFileCalls.map((c) => c.relativePath)
    expect(written).toEqual([
      'biome.json',
      'tsconfig.json',
      '.gitignore',
      'AGENTS.md',
      'pnpm-workspace.yaml',
      'package.json',
      'Dockerfile',
      'docker-compose.yml',
      'README.md',
      'src/utils/index.ts',
    ])
  })

  it('omits pnpm-workspace.yaml when package manager is not pnpm', async () => {
    const { ctx, writer } = makeTestContext({ packageManager: 'yarn' })

    await writeConfigFilesStage.run(ctx)

    const written = writer.createFileCalls.map((c) => c.relativePath)
    expect(written).not.toContain('pnpm-workspace.yaml')
  })

  it('uses the single "Writing config files" label', () => {
    expect(writeConfigFilesStage.label).toBe('Writing config files')
  })

  it('does not write .env or drizzle.config.ts', async () => {
    const { ctx, writer } = makeTestContext({ sink: 'postgresql' })

    await writeConfigFilesStage.run(ctx)

    const written = writer.createFileCalls.map((c) => c.relativePath)
    expect(written).not.toContain('.env')
    expect(written).not.toContain('drizzle.config.ts')
  })
})
