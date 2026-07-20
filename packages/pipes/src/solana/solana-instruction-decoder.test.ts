import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { solanaInstructionDecoder } from '~/solana/solana-instruction-decoder.js'
import { solanaPortalStream } from '~/solana/solana-portal-source.js'
import { MockPortal, MockResponse, mockMetricsServer, mockPortal, readAll } from '~/testing/index.js'

import * as tokenProgram from './abi/tokenProgram/index.js'

describe('solanaInstructionDecoder transform', () => {
  let portal: MockPortal

  beforeEach(async () => {
    await portal?.close()
    portal = await mockPortal(PORTAL_MOCK_RESPONSE)
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
    const stream = solanaPortalStream({
      id: 'test',
      portal: portal.url,
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
    const stream = solanaPortalStream({
      id: 'test',
      portal: portal.url,
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

describe('solanaInstructionDecoder decode errors', () => {
  const PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  const ACCOUNTS = [
    '98vhGWL5CtK61KSKCJjJn2PVfkjzaw9QF6sRLptBWZvZ',
    '49gyyvxzf61PknHoTg2cFGYQCJRnUrC7Web8h8go7ceM',
    'EDMGEpKKGKS7nxpu1gjLmuHHWAmvLNy3BZWDxNC3nhAt',
  ]

  let portal: MockPortal

  beforeEach(async () => {
    // A decodable transfer followed by one whose data is the discriminator byte only
    // (`'4'` = 0x03) — it matches d1 routing but `amount` (u64) cannot be read, so
    // `decode` throws.
    portal = await mockPortal([
      {
        statusCode: 200,
        data: [
          {
            header: { number: 1, hash: 'ooooooooooooooooooooooooooooooooooooooooooo1', timestamp: 2000 },
            instructions: [
              {
                transactionIndex: 85,
                instructionAddress: [2, 0, 0],
                programId: PROGRAM_ID,
                accounts: ACCOUNTS,
                data: '3DXy58UDhJuu',
              },
              {
                transactionIndex: 86,
                instructionAddress: [3, 0, 0],
                programId: PROGRAM_ID,
                accounts: ACCOUNTS,
                data: '4',
              },
            ],
          },
        ],
      },
    ])
  })

  afterEach(async () => {
    await portal?.close()
  })

  function stream(metrics: ReturnType<typeof mockMetricsServer>, onError?: (ctx: any, error: any) => unknown) {
    return solanaPortalStream({
      id: 'test',
      portal: portal.url,
      logger: false,
      metrics: metrics.server,
      outputs: solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: { transfers: tokenProgram.instructions.transfer },
        onError,
      }).pipe((e) => e.transfers),
    })
  }

  it('is fatal by default — no hook re-throws the decode error', async () => {
    const metrics = mockMetricsServer()

    await expect(readAll(stream(metrics))).rejects.toThrow()
    expect(metrics.counter('sqd_decode_errors_skipped_total')).toBeUndefined()
  })

  it('a returning hook suppresses the record and counts the skip', async () => {
    const metrics = mockMetricsServer()
    const seen: any[] = []

    const res = await readAll(stream(metrics, (_ctx, error) => seen.push(error)))

    expect(res).toHaveLength(1)
    expect(res[0].instruction.data.amount).toBe(50000000000n)
    expect(seen).toHaveLength(1)

    const skipped = metrics.counter('sqd_decode_errors_skipped_total')
    expect(skipped.total).toBe(1)
    expect(skipped.calls[0].labels).toEqual({ id: 'test' })
  })

  it('a re-throwing hook stays fatal and records no skip', async () => {
    const metrics = mockMetricsServer()

    await expect(
      readAll(
        stream(metrics, (_ctx, error) => {
          throw error
        }),
      ),
    ).rejects.toThrow()
    expect(metrics.counter('sqd_decode_errors_skipped_total')).toBeUndefined()
  })
})
