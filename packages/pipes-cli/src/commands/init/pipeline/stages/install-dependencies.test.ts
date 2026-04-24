import { describe, expect, it } from 'vitest'

import type { PackageManager } from '~/types/init.js'

import { makeTestContext } from '../testing/make-context.js'
import { installDependenciesStage } from './install-dependencies.js'

describe('installDependenciesStage', () => {
  it.each<[PackageManager, string]>([
    ['pnpm', 'pnpm install'],
    ['yarn', 'yarn install'],
    ['npm', 'npm install'],
    ['bun', 'bun install'],
  ])('runs `%s install` for %s package manager', async (pm, expectedCommand) => {
    const { ctx, writer } = makeTestContext({ packageManager: pm })

    await installDependenciesStage.run(ctx)

    expect(writer.executeCommandCalls).toEqual([expectedCommand])
  })
})
