import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { InstructionDecoderConfigurationError } from '~/core/index.js'
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

  it('decodes one ABI across multiple deployment addresses in a single request', async () => {
    const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
    const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
    const accounts = [
      '98vhGWL5CtK61KSKCJjJn2PVfkjzaw9QF6sRLptBWZvZ',
      '49gyyvxzf61PknHoTg2cFGYQCJRnUrC7Web8h8go7ceM',
      'EDMGEpKKGKS7nxpu1gjLmuHHWAmvLNy3BZWDxNC3nhAt',
    ]

    let requestBody: any
    await portal?.close()
    portal = await mockPortal([
      {
        statusCode: 200,
        validateRequest: (body) => {
          requestBody = body
        },
        data: [
          {
            header: { number: 1, hash: 'ooooooooooooooooooooooooooooooooooooooooooo1', timestamp: 2000 },
            instructions: [
              { transactionIndex: 85, instructionAddress: [2, 0, 0], programId: TOKEN, accounts, data: '3DXy58UDhJuu' },
              {
                transactionIndex: 86,
                instructionAddress: [3, 0, 0],
                programId: TOKEN_2022,
                accounts,
                data: '3DXy58UDhJuu',
              },
            ],
          },
        ],
      },
    ])

    const stream = solanaPortalStream({
      id: 'test',
      portal: portal.url,
      logger: false,
      outputs: solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: [TOKEN, TOKEN_2022],
        instructions: { transfers: tokenProgram.instructions.transfer },
      }).pipe((e) => e.transfers),
    })

    const res = await readAll(stream)

    expect(res.map((r) => r.programId)).toEqual([TOKEN, TOKEN_2022])
    expect(res.map((r) => r.rawInstruction.programId)).toEqual([TOKEN, TOKEN_2022])

    expect(requestBody.instructions).toHaveLength(1)
    expect(requestBody.instructions[0]).toMatchObject({
      programId: [TOKEN, TOKEN_2022],
      d1: ['0x03'],
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

describe('solanaInstructionDecoder configuration guards', () => {
  const PROGRAM_ID = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
  const anchorSwap = { d8: '0xf8c69e91e17587c8', decode: () => ({ accounts: {}, data: {} }) }

  it('rejects mixing discriminator widths in one decoder', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: { transfers: tokenProgram.instructions.transfer, swap: anchorSwap },
      }),
    ).toThrow(InstructionDecoderConfigurationError)
  })

  it('rejects two instructions sharing a discriminator', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: { transfers: tokenProgram.instructions.transfer, alias: tokenProgram.instructions.transfer },
      }),
    ).toThrow(InstructionDecoderConfigurationError)
  })

  it('rejects a decoder with no discriminators', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: { noop: { decode: () => ({ accounts: {}, data: {} }) } },
      }),
    ).toThrow(InstructionDecoderConfigurationError)
  })

  it('rejects an instruction that sets multiple discriminator widths', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: {
          transfers: { d1: '0x03', d8: '0xf8c69e91e17587c8', decode: () => ({ accounts: {}, data: {} }) },
        },
      }),
    ).toThrow(InstructionDecoderConfigurationError)
  })

  it('names the offending instructions when every entry lacks a discriminator', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: {
          swap: { decode: () => ({ accounts: {}, data: {} }) },
          claim: { decode: () => ({ accounts: {}, data: {} }) },
        },
      }),
    ).toThrow(/"swap", "claim"/)
  })

  it('rejects a discriminator-less instruction alongside a valid one', () => {
    expect(() =>
      solanaInstructionDecoder({
        range: { from: 0, to: 1 },
        programId: PROGRAM_ID,
        instructions: {
          transfers: tokenProgram.instructions.transfer,
          noop: { decode: () => ({ accounts: {}, data: {} }) },
        },
      }),
    ).toThrow(InstructionDecoderConfigurationError)
  })
})
