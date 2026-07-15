import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { generateTypesStage } from './generate-types.js'

describe('generateTypesStage', () => {
  it('is optional so a failed typegen does not discard the project', () => {
    expect(generateTypesStage.optional).toBe(true)
  })

  it('is a no-op (no shell-out) for templates without a postSetup hook', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx } = makeTestContext({
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await expect(generateTypesStage.run(ctx)).resolves.toBeUndefined()
  })
})
