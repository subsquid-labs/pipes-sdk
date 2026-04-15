import { describe, expect, it } from 'vitest'

import { getInstructionD1, getInstructionD2, getInstructionD4, getInstructionD8 } from '~/solana/types.js'

/**
 * Real instruction data from the Solana portal API (solana-mainnet, System Program Transfer).
 *
 * Portal response:
 *   programId: "11111111111111111111111111111111"
 *   data: "3Bxs4Ty4XnVSszuM"  (base58-encoded)
 *   d1: "0x02"
 *   d2: "0x0200"
 *   d4: "0x02000000"
 *   d8: "0x02000000a2151200"
 */
const SYSTEM_TRANSFER_INSTRUCTION = {
  transactionIndex: 804,
  instructionAddress: [3, 0, 2],
  programId: '11111111111111111111111111111111',
  accounts: [
    'JFKrXdoKnzZuGY2A5cnm3ubXcN7UGRUcs1iKZXHUJss',
    '6iK3n7QbmbLaTT1zwHar4WSCUgG1gsDmdQi9g6Ysb3RK',
  ],
  data: '3Bxs4Ty4XnVSszuM',
}

describe('discriminator extraction from real portal data', () => {
  it('getInstructionD1 extracts 1-byte discriminator', () => {
    expect(getInstructionD1({ ...SYSTEM_TRANSFER_INSTRUCTION })).toBe('0x02')
  })

  it('getInstructionD2 extracts 2-byte discriminator', () => {
    expect(getInstructionD2({ ...SYSTEM_TRANSFER_INSTRUCTION })).toBe('0x0200')
  })

  it('getInstructionD4 extracts 4-byte discriminator', () => {
    expect(getInstructionD4({ ...SYSTEM_TRANSFER_INSTRUCTION })).toBe('0x02000000')
  })

  it('getInstructionD8 extracts 8-byte discriminator', () => {
    expect(getInstructionD8({ ...SYSTEM_TRANSFER_INSTRUCTION } as any)).toBe('0x02000000a2151200')
  })
})
