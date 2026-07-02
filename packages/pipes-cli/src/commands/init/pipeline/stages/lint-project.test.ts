import { describe, expect, it } from 'vitest'

import type { PackageManager } from '~/types/init.js'

import { makeTestContext } from '../testing/make-context.js'
import { lintProjectStage } from './lint-project.js'

describe('lintProjectStage', () => {
  it.each<[PackageManager, string]>([
    ['pnpm', 'pnpm run lint'],
    ['yarn', 'yarn run lint'],
    ['npm', 'npm run lint'],
    ['bun', 'bun run lint'],
  ])('runs `%s run lint` for %s package manager', async (pm, expectedCommand) => {
    const { ctx, writer } = makeTestContext({ packageManager: pm })

    await lintProjectStage.run(ctx)

    expect(writer.executeCommandCalls).toEqual([expectedCommand])
  })
})
