import {
  DecodeErrorHook,
  InstructionDecoderConfigurationError,
  PortalRange,
  ProfilerOptions,
  defaultDecodeError,
  parsePortalRange,
  recordSuppressedDecode,
} from '~/core/index.js'
import { arrayify } from '~/internal/array.js'
import { FieldSelection, Instruction, TokenBalance, Transaction } from '~/portal-client/query/solana.js'

import { solanaQuery } from './solana-query-builder.js'
import { getInstructionD1, getInstructionD2, getInstructionD4, getInstructionD8 } from './types.js'

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
} satisfies FieldSelection

type SelectedFields = typeof decodedEventFields

export type DecodedInstruction<D> = {
  instruction: D
  programId: string
  block: { number: number; hash: string }
  timestamp: Date
  transaction: Transaction<SelectedFields['transaction']>
  innerInstructions: Instruction<SelectedFields['instruction']>[]
  rawInstruction: Instruction<SelectedFields['instruction']>
  tokenBalances: TokenBalance<SelectedFields['tokenBalance']>[]
}

interface AbiInstruction<A, D> {
  d1?: string
  d2?: string
  d4?: string
  d8?: string
  decode(event: any): { accounts: A; data: D }
}

const DISCRIMINATOR_WIDTHS = ['d1', 'd2', 'd4', 'd8'] as const
type DiscriminatorWidth = (typeof DISCRIMINATOR_WIDTHS)[number]

export type Instructions = Record<string, AbiInstruction<any, any>>

type InstructionsArgs<T extends Instructions> = {
  readonly [K in keyof T]: T[K] extends AbiInstruction<any, any> ? T[K] : never
}

export type AbiDecodeInstruction<T extends AbiInstruction<any, any>> = DecodedInstruction<ReturnType<T['decode']>>

export type EventResponse<T extends Instructions> = {
  [K in keyof T]: AbiDecodeInstruction<T[K]>[]
}

type DecodedEventPipeArgs<T extends Instructions> = {
  range: PortalRange
  programId: string | string[]
  instructions: InstructionsArgs<T>
  profiler?: ProfilerOptions
  onError?: DecodeErrorHook
}

export function solanaInstructionDecoder<T extends Instructions>(opts: DecodedEventPipeArgs<T>) {
  const range = parsePortalRange(opts.range)
  const programId = arrayify(opts.programId)
  const onError = opts.onError || defaultDecodeError

  const query = solanaQuery().addFields(decodedEventFields)

  const byWidth: Record<DiscriminatorWidth, string[]> = { d1: [], d2: [], d4: [], d8: [] }
  const seen = new Map<string, string>()
  const missing: string[] = []
  for (const name in opts.instructions) {
    const i = opts.instructions[name]
    const widths = DISCRIMINATOR_WIDTHS.filter((w) => i[w])
    if (widths.length === 0) {
      missing.push(name)
      continue
    }

    if (widths.length > 1) {
      throw new InstructionDecoderConfigurationError([
        `Instruction "${name}" sets multiple discriminators (${widths.join(', ')}).`,
        'An instruction is identified by exactly one discriminator; several mean a malformed ABI',
        'entry. Pass a single instruction definition carrying one discriminator width.',
      ])
    }

    const width = widths[0]
    const value = i[width]!
    const previous = seen.get(`${width}:${value}`)
    if (previous) {
      throw new InstructionDecoderConfigurationError([
        `Instructions "${previous}" and "${name}" share the discriminator ${value} (${width}).`,
        'Solana discriminators are program-independent, so a shared one would decode the same raw',
        'instruction under both keys. A decoder covers a single program/ABI — split unrelated',
        'programs into separate solanaInstructionDecoder() calls.',
      ])
    }

    seen.set(`${width}:${value}`, name)
    byWidth[width].push(value)
  }

  const widthsPresent = DISCRIMINATOR_WIDTHS.filter((w) => byWidth[w].length > 0)

  // Ordered before the empty-set message below: when every entry lacks a discriminator
  // both apply, and only this one names the offending keys.
  if (missing.length > 0) {
    throw new InstructionDecoderConfigurationError([
      `Instruction(s) ${missing.map((n) => `"${n}"`).join(', ')} have no discriminator (d1/d2/d4/d8).`,
      'An instruction without a discriminator matches every instruction of the program and would',
      'decode foreign data under its key. Every entry must carry exactly one discriminator — check',
      'you passed an instruction definition, not an event.',
    ])
  }

  if (widthsPresent.length === 0) {
    throw new InstructionDecoderConfigurationError([
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
    ])
  }

  if (widthsPresent.length > 1) {
    throw new InstructionDecoderConfigurationError([
      `A decoder mixes discriminator widths (${widthsPresent.join(', ')}); the portal rejects more than one width per request.`,
      'Usually this means unrelated programs were combined into one decoder — a decoder covers a',
      'single program/ABI, so split them into separate solanaInstructionDecoder() calls. If these',
      'instructions really are one program (an ABI whose extension instructions carry a wider',
      'discriminator), split it by width instead: one decoder per width, same programId.',
    ])
  }

  const width = widthsPresent[0]
  query.addInstructionRequest({
    range,
    request: {
      programId,
      [width]: byWidth[width],
      isCommitted: true,
      innerInstructions: true,
      transaction: true,
      transactionTokenBalances: true,
    },
  })

  return query.build().pipe({
    profiler: opts.profiler || { name: 'instruction decoder' },

    transform: async (data, ctx) => {
      const result = {} as EventResponse<T>
      for (const insName in opts.instructions) {
        ;(result[insName as keyof T] as ReturnType<T[keyof T]['decode']>[]) = []
      }

      for (const block of data) {
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
                // The emitting deployment: a decoder may cover several addresses of one ABI.
                programId: instruction.programId,
                rawInstruction: instruction,
                block: { number: block.header.number, hash: block.header.hash },
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
              recordSuppressedDecode(ctx)
            }
          }
        }
      }

      return result
    },
  })
}
