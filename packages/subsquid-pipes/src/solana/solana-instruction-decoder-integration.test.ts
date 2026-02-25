import { describe, expect, it } from 'vitest'

import { solanaPortalSource } from '~/solana/solana-portal-source.js'
import { SolanaQueryBuilder } from '~/solana/solana-query-builder.js'

const SOLANA_PORTAL_URL_DEVNET = 'https://portal.sqd.dev/datasets/solana-devnet'
const SOLANA_PORTAL_URL_MAINNET = 'https://portal.sqd.dev/datasets/solana-mainnet'

describe('solanaInstructionDecoder integration - logs presence – devnet', () => {
  it(
    'fetches real portal data and exposes block.logs for program',
    async () => {
      const MY_PROGRAM_ID = 'G2cLfty9nwG79WrJMXt7JRnk75E7WwVCkrCtyeGHXkmE'
      const range = { from: 442964144, to: 442964144 + 1 };

      const query = new SolanaQueryBuilder()
        .addFields(ALL_FIELDS)
        .addInstruction({
          range,
          request: {
            programId: [MY_PROGRAM_ID],
            isCommitted: true,
            transaction: true,
            transactionTokenBalances: true,
            innerInstructions: true,
            logs: true,
          },
        }).addLog({
          range,
          request: {
            programId: [MY_PROGRAM_ID],
            transaction: true,
            instruction: true,
          }
        });

      const stream = solanaPortalSource({
        portal: SOLANA_PORTAL_URL_DEVNET,
        query,
        logger: false,
      })

      let found = false

      for await (const { data } of stream) {
        for (const block of data.blocks) {
          if (block.header.number !== range.from) continue

          for (const instruction of block.instructions) {
            if (instruction.programId !== MY_PROGRAM_ID) continue

            const tx = block.transactions.find(
              (t) => t.transactionIndex === instruction.transactionIndex,
            )

            if (tx?.signatures[0] !== "578Jj6wFZLMNzmzLKf32RUfgkoFBexXmNpfisdtquAZb1M8wVha6mFg6MadwR3GYeaghnCdX8pnunYFuffNibMjz") continue;

            //const logs = block.logs.find(l => )

            expect(tx).toBeDefined()

            expect(Array.isArray(tx!.accountKeys)).toBe(true)
            expect(tx!.accountKeys.length).toBeGreaterThanOrEqual(4)
            expect(tx!.accountKeys).toContain('11111111111111111111111111111111')
            expect(tx!.accountKeys).toContain(MY_PROGRAM_ID)

            found = true
            break
          }

          if (found) break
        }

        if (found) break
      }

      expect(found).toBe(true)
    },
    60_000,
  )
})


describe('solanaInstructionDecoder integration - logs presence – raydium-clmm-swap', () => {
  it(
    'fetches real portal data and exposes block.logs for raydium-clmm swap',
    async () => {
      const range = { from: 398213410, to: 398213410 + 1 };
      const RAYDIUM_PROGRAM_ID = "CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK";

      const query = new SolanaQueryBuilder()
        .addFields(ALL_FIELDS)
        .addInstruction({
          range,
          request: {
            programId: [RAYDIUM_PROGRAM_ID],
            isCommitted: true,
            transaction: true,
            transactionTokenBalances: true,
            innerInstructions: true,
            logs: true,
          },
        })
        .addLog({
          range,
          request: {
            programId: [RAYDIUM_PROGRAM_ID],
            transaction: true,
            instruction: true,
          }
        });

      const stream = solanaPortalSource({
        portal: SOLANA_PORTAL_URL_MAINNET,
        query,
        logger: false,
      })

      let found = false

      for await (const { data } of stream) {
        for (const block of data.blocks) {
          if (block.header.number !== range.from) continue

          for (const instruction of block.instructions) {
            if (instruction.programId !== RAYDIUM_PROGRAM_ID) continue

            const tx = block.transactions.find(
              (t) => t.transactionIndex === instruction.transactionIndex,
            )
            if (tx?.signatures[0] !== "4XThVcS5GDjfX6AToQwdbUTYmjxTeCW2XUyKWE1Fm9p2joEEegwo7VyYPaYjCURiq4AR4jZYY69rxhBpF3Kvw7ji") continue;

            expect(tx).toBeDefined()

            const txLogs = block.logs.filter(
              (l) =>
                l.transactionIndex === tx!.transactionIndex &&
                l.instructionAddress.length === instruction.instructionAddress.length &&
                l.instructionAddress.every((v, i) => v === instruction.instructionAddress[i]),
            )
            const DATA_LOG_MESSAGE =
              'QMbN6CYIceLfug0rXaDQRrGO3ZopxKuogANe+D873sJ4b0XS1ZJwFwVK1aJDHzjsNrxiUZ0dow0jvgF2goaCLeMgxh2kZzNbb1GzV9N1t8O/IOLYrh+09JXKlzO0q3Mj5OmTIdWDGxnUsFC2DCIAJtsSmHHlnZnCze18+bjuLIPrme0biXQ3FhO+XAsAAAAAAAAAAAAAAAB4FjK6LAAAAAAAAAAAAAAAAAAAbNH53Dm/HwAAAAAAAACH0CiPwxcAAAAAAAAAAAAAJw4BAA=='
            expect(txLogs.length).equal(2)
            expect(txLogs[0].kind).toBe('log')
            expect(txLogs[0].message).toBe('Instruction: SwapV2')
            expect(txLogs[1].kind).toBe('data')
            expect(txLogs[1].message).toBe(DATA_LOG_MESSAGE)

            found = true
            break
          }

          if (found) break
        }

        if (found) break
      }

      expect(found).toBe(true)
    },
    60_000,
  )
})


const ALL_FIELDS = {
  block: {
    number: true,
    hash: true,
    timestamp: true,
  },
  transaction: {
    transactionIndex: true,
    version: true,
    accountKeys: true,
    addressTableLookups: true,
    numReadonlySignedAccounts: true,
    numReadonlyUnsignedAccounts: true,
    numRequiredSignatures: true,
    recentBlockhash: true,
    signatures: true,
    err: true,
    computeUnitsConsumed: true,
    fee: true,
    loadedAddresses: true,
    hasDroppedLogMessages: true,
  },
  instruction: {
    transactionIndex: true,
    instructionAddress: true,
    programId: true,
    accounts: true,
    data: true,
    computeUnitsConsumed: true,
    error: true,
    isCommitted: true,
    hasDroppedLogMessages: true,
  },
  tokenBalance: {
    transactionIndex: true,
    account: true,
    preMint: true,
    preAmount: true,
    preDecimals: true,
    postMint: true,
    postAmount: true,
    postDecimals: true,
  },
} as const;