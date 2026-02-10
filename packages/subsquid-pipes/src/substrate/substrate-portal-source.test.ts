import { afterEach, describe, expect, it } from 'vitest'

import { substrate } from '~/portal-client/index.js'
import { SubstrateQueryBuilder } from '~/substrate/substrate-query-builder.js'

import { MockPortal, closeMockPortal, createMockPortal } from '../tests/index.js'
import { substratePortalSource } from './substrate-portal-source.js'

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
          { header: { number: 1, hash: '0xabcd1', timestamp: 1000 } },
          { header: { number: 2, hash: '0xabcd2', timestamp: 2000 } },
        ],
      },
    ])

    const fields: substrate.FieldSelection = {
      block: { number: true, hash: true, timestamp: true },
      event: { name: true, args: true },
      call: { name: true, args: true },
      extrinsic: { index: true, version: true },
    } as const

    const stream = substratePortalSource({
      portal: mockPortal.url,
      query: new SubstrateQueryBuilder().addFields(fields).addRange({ from: 0, to: 2 }),
    })

    for await (const { data } of stream) {
      const [block] = data.blocks

      expect(block.events).toBeInstanceOf(Array)
      expect(block.calls).toBeInstanceOf(Array)
      expect(block.extrinsics).toBeInstanceOf(Array)
    }
  })
})
