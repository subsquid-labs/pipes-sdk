import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { runTargetPostStepsStage } from './run-target-post-steps.js'

describe('runTargetPostStepsStage', () => {
  const erc20 = getTemplate('evm', 'erc20Transfers')!
  const templates = [
    {
      template: erc20,
      params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
    },
  ]

  it('runs the Postgres `db:generate` post-step', async () => {
    const { ctx, writer } = makeTestContext({ target: 'postgresql', packageManager: 'pnpm', templates })

    await runTargetPostStepsStage.run(ctx)

    expect(writer.executeCommandCalls).toEqual(['pnpm run db:generate'])
  })

  it('runs no post-steps for a ClickHouse target', async () => {
    const { ctx, writer } = makeTestContext({ target: 'clickhouse', templates })

    await runTargetPostStepsStage.run(ctx)

    expect(writer.executeCommandCalls).toEqual([])
  })

  it('is optional so a failed post-step does not discard the project', () => {
    expect(runTargetPostStepsStage.optional).toBe(true)
  })
})
