import { BatchCtx, createTransformer, PortalRange, ProfilerOptions, parsePortalRange } from '~/core/index.js'
import { arrayify } from '~/internal/array.js'
import { Instruction, Transaction } from '~/portal-client/query/solana.js'
import { SolanaPortalData, SolanaTransformer } from '~/solana/solana-portal-source.js'
import { getInstructionD1, getInstructionD2, getInstructionD4, getInstructionD8 } from '~/solana/types.js'

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
    postMint: true,
  },
} as const

type DecodedInstruction<D> = {
  instruction: D
  programId: string
  blockNumber: number
  timestamp: Date
  transaction: Transaction<(typeof decodedEventFields)['transaction']>
  innerInstructions: Instruction<(typeof decodedEventFields)['instruction']>[]
  rawInstruction: Instruction<(typeof decodedEventFields)['instruction']>
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

export type EventResponse<T extends Instructions> = {
  [K in keyof T]: DecodedInstruction<ReturnType<T[K]['decode']>>[]
}

const defaultError = (ctx: BatchCtx, error: any) => {
  throw error
}

type DecodedEventPipeArgs<T extends Instructions> = {
  range: PortalRange
  programId: string | string[]
  instructions: InstructionsArgs<T>
  profiler?: ProfilerOptions
  onError?: (ctx: BatchCtx, error: any) => unknown | Promise<unknown>
}

export function createSolanaInstructionDecoder<T extends Instructions>(
  opts: DecodedEventPipeArgs<T>,
): SolanaTransformer<SolanaPortalData<typeof decodedEventFields>, EventResponse<T>> {
  const range = parsePortalRange(opts.range)
  const programId = arrayify(opts.programId)
  const onError = opts.onError || defaultError

  return createTransformer({
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
      }
      if (d2.length) {
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
      }
      if (d4.length) {
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
      }
      if (d8.length) {
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

      for (const block of data.blocks) {
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
