import { afterEach, describe, expect, it } from 'vitest'
import { EvmQueryBuilder } from '~/evm/evm-query-builder.js'
import { closeMockPortal, createMockPortal, MockPortal } from '../tests/index.js'
import { createEvmPortalSource, EvmPortalData } from './evm-portal-source.js'

describe('Portal abstract stream', () => {
  let mockPortal: MockPortal

  afterEach(async () => {
    await closeMockPortal(mockPortal)
  })

  it('should add default fields', async () => {
    mockPortal = await createMockPortal([
      {
        statusCode: 200,
        data: [
          { header: { number: 1, hash: '0x123', timestamp: 1000 } },
          { header: { number: 2, hash: '0x456', timestamp: 2000 } },
        ],
      },
    ])

    const fields = {
      log: { address: true, data: true, topics: true },
      block: { number: true, hash: true, timestamp: true },
      transaction: { from: true, to: true, hash: true },
      stateDiff: { address: true, key: true },
      trace: { error: true },
    } as const

    const stream = createEvmPortalSource({
      portal: mockPortal.url,
      query: new EvmQueryBuilder().addFields(fields).addRange({ from: 0, to: 2 }),
    }).pipe({
      transform: (data: EvmPortalData<typeof fields>) => {
        return data
      },
    })

    for await (const { data } of stream) {
      expect(data.blocks[0].logs).toBeInstanceOf(Array)
      expect(data.blocks[0].traces).toBeInstanceOf(Array)
      expect(data.blocks[0].transactions).toBeInstanceOf(Array)
      expect(data.blocks[0].stateDiffs).toBeInstanceOf(Array)
    }
  })
})
