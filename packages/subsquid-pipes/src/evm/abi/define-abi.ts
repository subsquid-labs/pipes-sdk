import {
  type AbiFunction,
  type AbiEvent as SubsquidAbiEvent,
  event,
  fun,
  indexed,
  keccak256,
  viewFun,
} from '@subsquid/evm-abi'
import type { Codec } from '@subsquid/evm-codec'
import * as p from '@subsquid/evm-codec'

// =====================================================================
// JSON ABI types (standard Solidity compiler output)
// =====================================================================

export type JsonAbiParameter = {
  readonly name?: string
  readonly type: string
  readonly indexed?: boolean
  readonly components?: readonly JsonAbiParameter[]
  readonly internalType?: string
}

export type JsonAbiItem = {
  readonly type: string
  readonly name?: string
  readonly anonymous?: boolean
  readonly stateMutability?: string
  readonly inputs?: readonly JsonAbiParameter[]
  readonly outputs?: readonly JsonAbiParameter[]
}

// =====================================================================
// Type-level Solidity type → TypeScript output type mapping
// =====================================================================

type SmallNumberBits = '8' | '16' | '24' | '32'

/** Maps a Solidity type string to its decoded TypeScript type */
type SolidityOutputType<T extends string> = T extends 'address'
  ? string
  : T extends 'bool'
    ? boolean
    : T extends 'string'
      ? string
      : T extends 'bytes'
        ? string
        : T extends `bytes${string}`
          ? string
          : T extends `uint${infer N}`
            ? N extends SmallNumberBits
              ? number
              : bigint
            : T extends `int${infer N}`
              ? N extends SmallNumberBits
                ? number
                : bigint
              : T extends `${infer Base}[]`
                ? SolidityOutputType<Base>[]
                : T extends `${infer Base}[${string}]`
                  ? SolidityOutputType<Base>[]
                  : T extends 'tuple'
                    ? Record<string, unknown>
                    : unknown

// =====================================================================
// Type-level ABI → codec structure mapping
// =====================================================================

/** Convert event inputs to codec struct type (with indexed markers) */
type EventCodecsFromInputs<T extends readonly JsonAbiParameter[]> = {
  [I in T[number] as I extends { readonly name: infer N extends string } ? N : never]: I extends {
    readonly indexed: true
  }
    ? Codec<any, SolidityOutputType<I['type']>> & { indexed: true }
    : Codec<any, SolidityOutputType<I['type']>>
}

/** Convert function inputs to codec struct type */
type FunctionCodecsFromInputs<T extends readonly JsonAbiParameter[]> = {
  [I in T[number] as I extends { readonly name: infer N extends string } ? N : never]: Codec<
    any,
    SolidityOutputType<I['type']>
  >
}

/** Resolve function return type from outputs */
type FunctionReturnCodec<T extends readonly JsonAbiParameter[]> = T extends readonly [
  infer Single extends JsonAbiParameter,
]
  ? Codec<any, SolidityOutputType<Single['type']>>
  : T extends readonly [JsonAbiParameter, ...JsonAbiParameter[]]
    ? FunctionCodecsFromInputs<T>
    : undefined

// Extract event/function items from ABI array
type ExtractEvents<T extends readonly JsonAbiItem[]> = Extract<
  T[number],
  { readonly type: 'event'; readonly name: string }
>
type ExtractFunctions<T extends readonly JsonAbiItem[]> = Extract<
  T[number],
  { readonly type: 'function'; readonly name: string }
>

/** Build typed events record from ABI items */
type EventsRecord<T extends readonly JsonAbiItem[]> = {
  [E in ExtractEvents<T> as E['name']]: E extends { readonly inputs: infer I extends readonly JsonAbiParameter[] }
    ? SubsquidAbiEvent<EventCodecsFromInputs<I>>
    : SubsquidAbiEvent<Record<string, never>>
}

/** Build typed functions record from ABI items */
type FunctionsRecord<T extends readonly JsonAbiItem[]> = {
  [F in ExtractFunctions<T> as F['name']]: F extends {
    readonly inputs: infer I extends readonly JsonAbiParameter[]
    readonly outputs: infer O extends readonly JsonAbiParameter[]
  }
    ? AbiFunction<FunctionCodecsFromInputs<I>, FunctionReturnCodec<O>>
    : F extends { readonly inputs: infer I extends readonly JsonAbiParameter[] }
      ? AbiFunction<FunctionCodecsFromInputs<I>, undefined>
      : AbiFunction<Record<string, never>, undefined>
}

/** Result of defineAbi */
export type DefinedAbi<T extends readonly JsonAbiItem[]> = {
  events: EventsRecord<T> & { [key: string]: SubsquidAbiEvent<any> }
  functions: FunctionsRecord<T> & { [key: string]: AbiFunction<any, any> }
}

// =====================================================================
// Runtime: Solidity type → @subsquid/evm-codec mapping
// =====================================================================

const CODEC_MAP: Record<string, Codec<any, any>> = {
  address: p.address,
  bool: p.bool,
  string: p.string,
  bytes: p.bytes,
  // bytesN
  bytes1: p.bytes1,
  bytes2: p.bytes2,
  bytes3: p.bytes3,
  bytes4: p.bytes4,
  bytes5: p.bytes5,
  bytes6: p.bytes6,
  bytes7: p.bytes7,
  bytes8: p.bytes8,
  bytes9: p.bytes9,
  bytes10: p.bytes10,
  bytes11: p.bytes11,
  bytes12: p.bytes12,
  bytes13: p.bytes13,
  bytes14: p.bytes14,
  bytes15: p.bytes15,
  bytes16: p.bytes16,
  bytes17: p.bytes17,
  bytes18: p.bytes18,
  bytes19: p.bytes19,
  bytes20: p.bytes20,
  bytes21: p.bytes21,
  bytes22: p.bytes22,
  bytes23: p.bytes23,
  bytes24: p.bytes24,
  bytes25: p.bytes25,
  bytes26: p.bytes26,
  bytes27: p.bytes27,
  bytes28: p.bytes28,
  bytes29: p.bytes29,
  bytes30: p.bytes30,
  bytes31: p.bytes31,
  bytes32: p.bytes32,
  // uintN
  uint8: p.uint8,
  uint16: p.uint16,
  uint24: p.uint24,
  uint32: p.uint32,
  uint40: p.uint40,
  uint48: p.uint48,
  uint56: p.uint56,
  uint64: p.uint64,
  uint72: p.uint72,
  uint80: p.uint80,
  uint88: p.uint88,
  uint96: p.uint96,
  uint104: p.uint104,
  uint112: p.uint112,
  uint120: p.uint120,
  uint128: p.uint128,
  uint136: p.uint136,
  uint144: p.uint144,
  uint152: p.uint152,
  uint160: p.uint160,
  uint168: p.uint168,
  uint176: p.uint176,
  uint184: p.uint184,
  uint192: p.uint192,
  uint200: p.uint200,
  uint208: p.uint208,
  uint216: p.uint216,
  uint224: p.uint224,
  uint232: p.uint232,
  uint240: p.uint240,
  uint248: p.uint248,
  uint256: p.uint256,
  // intN
  int8: p.int8,
  int16: p.int16,
  int24: p.int24,
  int32: p.int32,
  int40: p.int40,
  int48: p.int48,
  int56: p.int56,
  int64: p.int64,
  int72: p.int72,
  int80: p.int80,
  int88: p.int88,
  int96: p.int96,
  int104: p.int104,
  int112: p.int112,
  int120: p.int120,
  int128: p.int128,
  int136: p.int136,
  int144: p.int144,
  int152: p.int152,
  int160: p.int160,
  int168: p.int168,
  int176: p.int176,
  int184: p.int184,
  int192: p.int192,
  int200: p.int200,
  int208: p.int208,
  int216: p.int216,
  int224: p.int224,
  int232: p.int232,
  int240: p.int240,
  int248: p.int248,
  int256: p.int256,
}

function solidityTypeToCodec(type: string, components?: readonly JsonAbiParameter[]): Codec<any, any> {
  // Handle array types: type[] and type[N]
  const arrayMatch = type.match(/^(.+?)(\[(\d*)\])$/)
  if (arrayMatch) {
    const baseCodec = solidityTypeToCodec(arrayMatch[1], components)
    const size = arrayMatch[3]
    return size === '' ? p.array(baseCodec) : p.fixedSizeArray(baseCodec, Number.parseInt(size))
  }

  // Handle tuple types
  if (type === 'tuple' && components) {
    const fields: Record<string, Codec<any, any>> = {}
    for (let i = 0; i < components.length; i++) {
      const comp = components[i]
      fields[comp.name || `_${i}`] = solidityTypeToCodec(comp.type, comp.components)
    }
    return p.struct(fields)
  }

  // Handle tuple arrays: tuple[] or tuple[N]
  if (type.startsWith('tuple[') && components) {
    const tupleCodec = solidityTypeToCodec('tuple', components)
    const suffix = type.slice(5) // "[...]"
    const sizeMatch = suffix.match(/^\[(\d*)\]$/)
    if (sizeMatch) {
      const size = sizeMatch[1]
      return size === '' ? p.array(tupleCodec) : p.fixedSizeArray(tupleCodec, Number.parseInt(size))
    }
  }

  const codec = CODEC_MAP[type]
  if (codec) return codec

  throw new Error(`Unsupported Solidity type: "${type}"`)
}

// =====================================================================
// Runtime: signature computation
// =====================================================================

/** Produces canonical Solidity type string (resolves tuples to their component form) */
function canonicalType(param: JsonAbiParameter): string {
  if (param.type === 'tuple') {
    const inner = (param.components || []).map((c) => canonicalType(c)).join(',')
    return `(${inner})`
  }
  if (param.type.startsWith('tuple[')) {
    const inner = (param.components || []).map((c) => canonicalType(c)).join(',')
    const suffix = param.type.slice(5) // e.g., "[]" or "[3]"
    return `(${inner})${suffix}`
  }
  return param.type
}

function buildSignature(name: string, inputs: readonly JsonAbiParameter[]): string {
  return `${name}(${inputs.map((i) => canonicalType(i)).join(',')})`
}

function computeTopicHash(signature: string): string {
  return `0x${Buffer.from(keccak256(signature)).toString('hex')}`
}

function computeSelector(signature: string): string {
  return `0x${Buffer.from(keccak256(signature)).toString('hex').slice(0, 8)}`
}

// =====================================================================
// Runtime: ABI item construction
// =====================================================================

function buildEvent(item: JsonAbiItem): SubsquidAbiEvent<any> {
  const inputs = item.inputs || []
  const signature = buildSignature(item.name!, inputs)
  const topic = computeTopicHash(signature)

  const codecs: Record<string, Codec<any, any>> = {}
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    const name = input.name || `_${i}`
    const codec = solidityTypeToCodec(input.type, input.components)
    codecs[name] = input.indexed ? indexed(codec) : codec
  }

  return event(topic, signature, codecs)
}

function buildFunction(item: JsonAbiItem): AbiFunction<any, any> {
  const inputs = item.inputs || []
  const outputs = item.outputs || []
  const signature = buildSignature(item.name!, inputs)
  const selector = computeSelector(signature)

  const inputCodecs: Record<string, Codec<any, any>> = {}
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i]
    inputCodecs[input.name || `_${i}`] = solidityTypeToCodec(input.type, input.components)
  }

  let returnType: Codec<any, any> | Record<string, Codec<any, any>> | undefined
  if (outputs.length === 1) {
    returnType = solidityTypeToCodec(outputs[0].type, outputs[0].components)
  } else if (outputs.length > 1) {
    const outputCodecs: Record<string, Codec<any, any>> = {}
    for (let i = 0; i < outputs.length; i++) {
      const output = outputs[i]
      outputCodecs[output.name || `_${i}`] = solidityTypeToCodec(output.type, output.components)
    }
    returnType = outputCodecs
  }

  const isView = item.stateMutability === 'view' || item.stateMutability === 'pure'
  return isView
    ? viewFun(selector, signature, inputCodecs, returnType)
    : fun(selector, signature, inputCodecs, returnType)
}

// =====================================================================
// Public API
// =====================================================================

/**
 * Converts a standard JSON ABI into subsquid decoder objects with fast runtime decoding.
 *
 * Accepts either a plain ABI array or a Hardhat/Foundry artifact object with an `abi` field.
 * The returned object contains `.events` and `.functions` maps that can be used directly
 * with `evmDecoder()` and other subsquid APIs.
 *
 * Uses `@subsquid/evm-codec` for 10x faster decoding compared to viem, while accepting
 * the same standard JSON ABI format — no code generation required.
 *
 * @example
 * ```ts
 * // From a JSON ABI file
 * import erc20Json from './erc20.json'
 * const erc20 = defineAbi(erc20Json)
 *
 * evmDecoder({
 *   range: { from: 'latest' },
 *   events: {
 *     transfers: erc20.events.Transfer,
 *     approvals: {
 *       event: erc20.events.Approval,
 *       params: { owner: '0x...' },
 *     },
 *   },
 * })
 * ```
 *
 * @example
 * ```ts
 * // Inline with `as const` for full type inference
 * const erc20 = defineAbi([
 *   {
 *     type: 'event',
 *     name: 'Transfer',
 *     inputs: [
 *       { indexed: true, name: 'from', type: 'address' },
 *       { indexed: true, name: 'to', type: 'address' },
 *       { indexed: false, name: 'value', type: 'uint256' },
 *     ],
 *   },
 * ] as const)
 *
 * // erc20.events.Transfer is fully typed:
 * // .decode() returns { from: string, to: string, value: bigint }
 * ```
 *
 * @example
 * ```ts
 * // From Hardhat artifact
 * import artifact from './artifacts/MyContract.json'
 * const myContract = defineAbi(artifact)
 * ```
 */
export function defineAbi<const T extends readonly JsonAbiItem[]>(items: T): DefinedAbi<T>
export function defineAbi<const T extends readonly JsonAbiItem[]>(artifact: {
  abi: T
  [key: string]: unknown
}): DefinedAbi<T>
export function defineAbi(input: readonly JsonAbiItem[] | { abi: readonly JsonAbiItem[] }): {
  events: Record<string, SubsquidAbiEvent<any>>
  functions: Record<string, AbiFunction<any, any>>
} {
  const items: readonly JsonAbiItem[] = 'abi' in input ? input.abi : input

  const events: Record<string, SubsquidAbiEvent<any>> = {}
  const functions: Record<string, AbiFunction<any, any>> = {}

  for (const item of items) {
    if (item.type === 'event' && item.name && !item.anonymous) {
      if (!events[item.name]) {
        events[item.name] = buildEvent(item)
      }
    } else if (item.type === 'function' && item.name) {
      if (!functions[item.name]) {
        functions[item.name] = buildFunction(item)
      }
    }
  }

  return { events, functions }
}
