import { afterEach, describe, expect, it } from 'vitest'
import { solana } from '~/portal-client/index.js'
import { SolanaQueryBuilder } from '~/solana/solana-query-builder.js'
import { closeMockPortal, createMockPortal, MockPortal } from '../tests/index.js'
import { createSolanaPortalSource } from './solana-portal-source.js'

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
          { header: { number: 1, hash: 'abcd1', timestamp: 1000 } },
          { header: { number: 2, hash: 'abcd2', timestamp: 2000 } },
        ],
      },
    ])

    const fields: solana.FieldSelection = {
      log: { programId: true, message: true },
      block: { number: true, hash: true, timestamp: true },
      transaction: { version: true },
      instruction: { data: true },
      tokenBalance: { account: true },
      balance: { account: true },
      reward: { lamports: true },
    } as const

    const stream = createSolanaPortalSource({
      portal: mockPortal.url,
      query: new SolanaQueryBuilder().addFields(fields).addRange({ from: 0, to: 2 }),
    })

    for await (const { data } of stream) {
      const [block] = data.blocks

      expect(block.logs).toBeInstanceOf(Array)
      expect(block.transactions).toBeInstanceOf(Array)
      expect(block.instructions).toBeInstanceOf(Array)
      expect(block.tokenBalances).toBeInstanceOf(Array)
      expect(block.balances).toBeInstanceOf(Array)
      expect(block.rewards).toBeInstanceOf(Array)
    }
  })
})
