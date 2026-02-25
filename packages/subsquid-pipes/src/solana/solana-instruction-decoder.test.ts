import { beforeEach, describe, expect, it } from 'vitest'

import { QueryAwareTransformer } from '~/core/index.js'
import { solanaInstructionDecoder } from '~/solana/solana-instruction-decoder.js'
import { solanaPortalSource } from '~/solana/solana-portal-source.js'
import { SolanaQueryBuilder } from '~/solana/solana-query-builder.js'
import {
  MockPortal,
  MockResponse,
  closeMockPortal,
  createMockPortal,
  createTestLogger,
  readAll,
} from '~/tests/index.js'

import * as tokenProgram from './abi/tokenProgram/index.js'

async function captureQueryBuilder<Q extends SolanaQueryBuilder<any>>(
  decoder: QueryAwareTransformer<any, any, Q>,
  logger = createTestLogger(),
): Promise<Q> {
  const query = new SolanaQueryBuilder() as Q
  await decoder.setupQuery({ query, logger })
  return query
}

describe('solanaInstructionDecoder transform', () => {
  let mockPortal: MockPortal

  beforeEach(async () => {
    if (mockPortal) {
      await closeMockPortal(mockPortal)
    }

    mockPortal = await createMockPortal(PORTAL_MOCK_RESPONSE)
  })

  const PORTAL_MOCK_RESPONSE: MockResponse[] = [
    {
      statusCode: 200,
      data: [
        {
          header: { number: 1, hash: 'ooooooooooooooooooooooooooooooooooooooooooo1', timestamp: 2000 },
          instructions: [
            {
              transactionIndex: 85,
              instructionAddress: [2, 0, 0],
              programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
              accounts: [
                '98vhGWL5CtK61KSKCJjJn2PVfkjzaw9QF6sRLptBWZvZ',
                '49gyyvxzf61PknHoTg2cFGYQCJRnUrC7Web8h8go7ceM',
                'EDMGEpKKGKS7nxpu1gjLmuHHWAmvLNy3BZWDxNC3nhAt',
              ],
              data: '3DXy58UDhJuu',
            },
          ],
        },
      ],
    },
  ]

  it('should decode the events', async () => {
    const stream = solanaPortalSource({
      portal: mockPortal.url,
      logger: false,
      outputs: solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        instructions: {
          transfers: tokenProgram.instructions.transfer,
        },
      }).pipe((e) => e.transfers),
    })

    const res = await readAll(stream)

    expect(res).toHaveLength(1)

    const [tx] = res

    expect(tx.instruction).toMatchObject({
      accounts: {
        authority: 'EDMGEpKKGKS7nxpu1gjLmuHHWAmvLNy3BZWDxNC3nhAt',
        destination: '49gyyvxzf61PknHoTg2cFGYQCJRnUrC7Web8h8go7ceM',
        source: '98vhGWL5CtK61KSKCJjJn2PVfkjzaw9QF6sRLptBWZvZ',
      },
      data: {
        amount: 50000000000n,
      },
    })
  })

  it('should filter events by programId across multiple decoders', async () => {
    const stream = solanaPortalSource({
      portal: mockPortal.url,
      logger: false,
      outputs: {
        validProgramId: solanaInstructionDecoder({
          range: { from: 0, to: 1 },
          programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
          instructions: {
            transfers: tokenProgram.instructions.transfer,
          },
        }),
        unknownProgramId: solanaInstructionDecoder({
          range: { from: 0, to: 1 },
          programId: 'xxxx',
          instructions: {
            transfers: tokenProgram.instructions.transfer,
          },
        }),
      },
    })

    const valid = []
    const invalid = []
    for await (const { data } of stream) {
      valid.push(...data.validProgramId.transfers)
      invalid.push(...data.unknownProgramId.transfers)
    }

    expect(valid).toHaveLength(1)
    expect(invalid).toHaveLength(0)
  })

  it('should merge extraFields into query fields', async () => {
    const decoder = solanaInstructionDecoder({
      range: { from: 0, to: 1 },
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      instructions: {
        transfers: tokenProgram.instructions.transfer,
      },
      extraFields: {
        transaction: { fee: true },
        instruction: { isCommitted: true },
      },
    })

    const capturedQuery = await captureQueryBuilder(decoder)
    const fields = capturedQuery.getFields()

    expect(fields).toMatchObject({
      block: { number: true, hash: true, timestamp: true },
      transaction: { transactionIndex: true, signatures: true, fee: true },
      instruction: {
        transactionIndex: true,
        data: true,
        instructionAddress: true,
        programId: true,
        accounts: true,
        isCommitted: true,
      },
    })
  })

  it('should work without extraFields', async () => {
    const decoder = solanaInstructionDecoder({
      range: { from: 0, to: 1 },
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      instructions: {
        transfers: tokenProgram.instructions.transfer,
      },
    })

    const capturedQuery = await captureQueryBuilder(decoder)
    const fields = capturedQuery.getFields()

    expect(fields).toMatchObject({
      block: { number: true, hash: true, timestamp: true },
      transaction: { transactionIndex: true, signatures: true },
      instruction: {
        transactionIndex: true,
        data: true,
        instructionAddress: true,
        programId: true,
        accounts: true,
      },
    })
    expect(fields.transaction).not.toHaveProperty('fee')
  })

  it('should decode events with extraFields providing additional data', async () => {
    const mockWithTx = await createMockPortal([
      {
        statusCode: 200,
        data: [
          {
            header: { number: 1, hash: 'ooooooooooooooooooooooooooooooooooooooooooo1', timestamp: 2000 },
            transactions: [{ transactionIndex: 85, signatures: ['sig1'], fee: '5000' }],
            instructions: [
              {
                transactionIndex: 85,
                instructionAddress: [2, 0, 0],
                programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
                accounts: [
                  '98vhGWL5CtK61KSKCJjJn2PVfkjzaw9QF6sRLptBWZvZ',
                  '49gyyvxzf61PknHoTg2cFGYQCJRnUrC7Web8h8go7ceM',
                  'EDMGEpKKGKS7nxpu1gjLmuHHWAmvLNy3BZWDxNC3nhAt',
                ],
                data: '3DXy58UDhJuu',
                isCommitted: true,
              },
            ],
            tokenBalances: [],
          },
        ],
      },
    ])

    const stream = solanaPortalSource({
      portal: mockWithTx.url,
      logger: false,
      outputs: solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        instructions: {
          transfers: tokenProgram.instructions.transfer,
        },
        extraFields: {
          transaction: { fee: true },
          instruction: { isCommitted: true },
        },
      }).pipe((e) => e.transfers),
    })

    const res = await readAll(stream)

    expect(res).toHaveLength(1)
    expect(res[0].transaction).toMatchObject({ transactionIndex: 85, fee: 5000n })
    expect(res[0].rawInstruction).toHaveProperty('isCommitted', true)

    await closeMockPortal(mockWithTx)
  })

  it('should preserve extraFields types', () => {
    const decoder = solanaInstructionDecoder({
      range: { from: 0, to: 1 },
      programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
      instructions: {
        transfers: tokenProgram.instructions.transfer,
      },
      extraFields: {
        transaction: { fee: true },
      },
    })

    decoder.pipe((e) => {
      const transfer = e.transfers[0]

      // These should be available from default fields
      const _blockNumber: number = transfer.blockNumber
      const _programId: string = transfer.programId
      const _txIndex: number = transfer.transaction.transactionIndex

      // This should be available from extraFields
      const _fee: bigint = transfer.transaction.fee

      // @ts-expect-error - 'version' is not in default or extra fields
      transfer.transaction.version

      return e.transfers
    })
  })
})
