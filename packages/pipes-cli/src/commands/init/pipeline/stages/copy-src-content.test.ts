import { describe, expect, it } from 'vitest'

import { getTemplate } from '../../templates/registry.js'
import { makeTestContext } from '../testing/make-context.js'
import { copySrcContentStage } from './copy-src-content.js'

describe('copySrcContentStage', () => {
  it('skips templates without a copySrc flag', async () => {
    const erc20 = getTemplate('evm', 'erc20Transfers')!
    expect(erc20.copySrc).toBeFalsy()

    const { ctx, writer } = makeTestContext({
      templates: [
        {
          template: erc20,
          params: { deployments: [{ address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', range: { from: '1' } }] },
        },
      ],
    })

    await copySrcContentStage.run(ctx)

    expect(writer.copyFileCalls).toEqual([])
  })

  it('copies src when the template declares copySrc', async () => {
    const uniswap = getTemplate('evm', 'uniswapV3Swaps')!
    expect(uniswap.copySrc).toBeTruthy()

    const { ctx, writer } = makeTestContext({
      templates: [
        {
          template: uniswap,
          params: { factoryAddress: '0x0', range: { from: '1' } },
        },
      ],
    })

    await copySrcContentStage.run(ctx)

    expect(writer.copyFileCalls.length).toBeGreaterThan(0)
    expect(writer.copyFileCalls[0]?.relativeTargetPath).toBe('src')
  })
})
