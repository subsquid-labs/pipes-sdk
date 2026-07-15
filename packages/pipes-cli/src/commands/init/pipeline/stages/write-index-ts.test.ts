import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { writeIndexTsStage } from './write-index-ts.js'

describe('writeIndexTsStage', () => {
  it('writes src/index.ts with the rendered transformer code', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    const { ctx, writer } = makeTestContext({
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await writeIndexTsStage.run(ctx)

    const indexFile = writer.createFileCalls.find((c) => c.relativePath === 'src/index.ts')
    expect(indexFile).toBeDefined()
    expect(indexFile?.content.length).toBeGreaterThan(0)
  })
})
