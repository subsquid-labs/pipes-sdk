import { BatchCtx, Decoder, PortalRange, ProfilerOptions, parsePortalRange } from '~/core/index.js'
import { arrayify } from '~/internal/array.js'
import { Instruction, TokenBalance, Transaction } from '~/portal-client/query/solana.js'
import { SolanaPortalData } from '~/solana/solana-portal-source.js'
import { getInstructionD1, getInstructionD2, getInstructionD4, getInstructionD8 } from '~/solana/types.js'

import { SolanaQueryBuilder } from './solana-query-builder.js'

const decodedEventFields = {
  block: {
    number: true,
    hash: true,
    timestamp: true,
  },
  transaction: {
    transactionIndex: true,
    signatures: true,
  },
  instruction: {
    transactionIndex: true,
    data: true,
    instructionAddress: true,
    programId: true,
    accounts: true,
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
} as const

type SelectedFields = Required<typeof decodedEventFields>

export type DecodedInstruction<D> = {
  instruction: D
  programId: string
  blockNumber: number
  timestamp: Date
  transaction: Transaction<SelectedFields['transaction']>
  innerInstructions: Instruction<SelectedFields['instruction']>[]
  rawInstruction: Instruction<SelectedFields['instruction']>
  tokenBalances: TokenBalance<SelectedFields['tokenBalance']>[]
}

interface AbiInstruction<A, D> {
  d0?: string
  d1?: string
  d2?: string
  d4?: string
  d8?: string
  decode(event: any): { accounts: A; data: D }
}

export type Instructions = Record<string, AbiInstruction<any, any>>

type InstructionsArgs<T extends Instructions> = {
  readonly [K in keyof T]: T[K] extends AbiInstruction<any, any> ? T[K] : never
}

export type AbiDecodeInstruction<T extends AbiInstruction<any, any>> = DecodedInstruction<ReturnType<T['decode']>>

export type EventResponse<T extends Instructions> = {
  [K in keyof T]: AbiDecodeInstruction<T[K]>[]
}

const defaultError = (ctx: BatchCtx, error: any) => {
  throw error
}

class SolanaDecoder<In, Out> extends Decoder<In, Out, SolanaQueryBuilder> {}

type DecodedEventPipeArgs<T extends Instructions> = {
  range: PortalRange
  programId: string | string[]
  instructions: InstructionsArgs<T>
  profiler?: ProfilerOptions
  onError?: (ctx: BatchCtx, error: any) => unknown | Promise<unknown>
}

export function solanaInstructionDecoder<T extends Instructions>(
  opts: DecodedEventPipeArgs<T>,
): SolanaDecoder<SolanaPortalData<typeof decodedEventFields>, EventResponse<T>> {
  const range = parsePortalRange(opts.range)
  const programId = arrayify(opts.programId)
  const onError = opts.onError || defaultError

  return new SolanaDecoder({
    profiler: opts.profiler || { id: 'instruction decoder' },
    query: async ({ queryBuilder }) => {
      queryBuilder.addFields(decodedEventFields)

      const d1: string[] = []
      const d2: string[] = []
      const d4: string[] = []
      const d8: string[] = []
      for (const name in opts.instructions) {
        const i = opts.instructions[name]

        if (i.d1) d1.push(i.d1)
        if (i.d2) d2.push(i.d2)
        if (i.d4) d4.push(i.d4)
        if (i.d8) d8.push(i.d8)
      }

      if (!d1.length && !d2.length && !d4.length && !d8.length) {
        throw new Error(
          [
            'No valid instruction discriminators found. It looks like one or more instructions in your ABI are missing their decoder configuration.',
            'This usually happens when you accidentally pass an event instead of an instruction, or when your ABI instruction definitions are incomplete.',
            'Please check that you are passing correct instruction definitions to "solanaInstructionDecoder":',
            '--------------------------------------------------',
            'Example',
            '',

            'import { events as orcaWhirlpool } from "./orca_abi";',

            '',
            ' // ... omitted logic ....',
            '',

            'solanaInstructionDecoder({',
            '  range: { from: 371602677 },',
            '  programId: orcaWhirlpool.programId,',
            '  instructions: {',
            '    initializeConfig: abi.instructions.InitializeConfig,',
            '    swap: abi.instructions.Swap,',
            '  },',
            '})',
            // TODO add docs link
          ].join('\n'),
        )
      }

      if (d1.length) {
        queryBuilder.addInstruction({
          range,
          request: {
            programId,
            d1,
            isCommitted: true,
            innerInstructions: true,
            transaction: true,
            transactionTokenBalances: true,
          },
        })
      } else if (d2.length) {
        queryBuilder.addInstruction({
          range,
          request: {
            programId,
            d2,
            isCommitted: true,
            innerInstructions: true,
            transaction: true,
            transactionTokenBalances: true,
          },
        })
      } else if (d4.length) {
        queryBuilder.addInstruction({
          range,
          request: {
            programId,
            d4,
            isCommitted: true,
            innerInstructions: true,
            transaction: true,
            transactionTokenBalances: true,
          },
        })
      } else if (d8.length) {
        queryBuilder.addInstruction({
          range,
          request: {
            programId,
            d8,
            isCommitted: true,
            innerInstructions: true,
            transaction: true,
            transactionTokenBalances: true,
          },
        })
      }
    },
    transform: async (data, ctx) => {
      const result = {} as EventResponse<T>
      for (const insName in opts.instructions) {
        ;(result[insName as keyof T] as ReturnType<T[keyof T]['decode']>[]) = []
      }

      for (const block of data) {
        if (!block.instructions) continue

        for (const instruction of block.instructions) {
          for (const eventName in opts.instructions) {
            const instructionAbi = opts.instructions[eventName]
            if (!programId.includes(instruction.programId)) {
              continue
            }

            if (instructionAbi.d1 && getInstructionD1(instruction) !== instructionAbi.d1) continue
            if (instructionAbi.d2 && getInstructionD2(instruction) !== instructionAbi.d2) continue
            if (instructionAbi.d4 && getInstructionD4(instruction) !== instructionAbi.d4) continue
            if (instructionAbi.d8 && getInstructionD8(instruction) !== instructionAbi.d8) continue

            const transaction = block.transactions.find((t) => t.transactionIndex === instruction.transactionIndex)

            try {
              const decoded = instructionAbi.decode(instruction)

              const res = {
                instruction: decoded,
                rawInstruction: instruction,
                blockNumber: block.header.number,
                transaction,
                tokenBalances: block.tokenBalances.filter((b) => b.transactionIndex === instruction.transactionIndex),
                innerInstructions: block.instructions.filter((inner) => {
                  if (inner.transactionIndex !== instruction.transactionIndex) return false
                  if (inner.instructionAddress.length <= instruction.instructionAddress.length) return false

                  return instruction.instructionAddress.every((v: any, i: any) => v === inner.instructionAddress[i])
                }),

                timestamp: new Date(block.header.timestamp * 1000),
              }

              result[eventName as keyof T].push(res as any)
            } catch (error) {
              await onError(ctx, error)
            }
          }
        }
      }

      return result
    },
  })
}
