import { beforeEach, describe, expect, it } from 'vitest'

import { solanaInstructionDecoder } from '~/solana/solana-instruction-decoder.js'
import { solanaPortalSource } from '~/solana/solana-portal-source.js'
import { MockPortal, MockResponse, createMockPortal, readAll } from '~/testing/index.js'

import * as tokenProgram from './abi/tokenProgram/index.js'

describe('solanaInstructionDecoder transform', () => {
  let mockPortal: MockPortal

  beforeEach(async () => {
    await mockPortal?.close()
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
})
