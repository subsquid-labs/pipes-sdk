import { BOOLEAN, NAT, STRING, Validator, array, object, option, withDefault } from '@subsquid/util-internal-validation'

import {
  FLOAT,
  type ObjectValidatorShape,
  type PortalQuery,
  type Select,
  type Selected,
  type Selector,
  type Simplify,
  type Trues,
  project,
} from './common.js'

// Bitcoin Core / Subsquid Bitcoin portal emit hex strings WITHOUT the `0x`
// prefix EVM uses (e.g. `000000000019d668...`), so we validate them as plain
// strings rather than via the shared `BYTES` validator.
type Hex = string

// https://github.com/subsquid/data/blob/master/crates/query/src/query/bitcoin.rs

export type BlockHeaderFields = {
  number: number
  hash: Hex
  parentHash: Hex
  timestamp: number
  medianTime: number
  version: number
  merkleRoot: Hex
  nonce: number
  target: Hex
  bits: Hex
  difficulty: number
  chainWork: Hex
  strippedSize: number
  size: number
  weight: number
}

export type TransactionFields = {
  transactionIndex: number
  hex: Hex
  txid: Hex
  hash: Hex
  size: number
  vsize: number
  weight: number
  version: number
  locktime: number
}

export type InputFields = {
  transactionIndex: number
  inputIndex: number
  type: string
  txid?: Hex
  vout?: number
  scriptSigHex?: Hex
  scriptSigAsm?: string
  sequence: number
  coinbase?: Hex
  txInWitness?: Hex[]
  prevoutGenerated?: boolean
  prevoutHeight?: number
  prevoutValue?: number
  prevoutScriptPubKeyHex?: Hex
  prevoutScriptPubKeyAsm?: string
  prevoutScriptPubKeyDesc?: string
  prevoutScriptPubKeyType?: string
  prevoutScriptPubKeyAddress?: string
}

export type OutputFields = {
  transactionIndex: number
  outputIndex: number
  /** BTC amount as a JSON float (Bitcoin Core convention), NOT satoshis. */
  value: number
  scriptPubKeyHex: Hex
  scriptPubKeyAsm: string
  scriptPubKeyDesc: string
  scriptPubKeyType: string
  scriptPubKeyAddress?: string
}

export type BlockHeaderFieldSelection = Selector<keyof BlockHeaderFields>
export type BlockHeader<F extends BlockHeaderFieldSelection = Trues<BlockHeaderFieldSelection>> = Select<
  BlockHeaderFields,
  F
>

export type TransactionFieldSelection = Selector<keyof TransactionFields>
export type Transaction<F extends TransactionFieldSelection = Trues<TransactionFieldSelection>> = Select<
  TransactionFields,
  F
>

export type InputFieldSelection = Selector<keyof InputFields>
export type Input<F extends InputFieldSelection = Trues<InputFieldSelection>> = Select<InputFields, F>

export type OutputFieldSelection = Selector<keyof OutputFields>
export type Output<F extends OutputFieldSelection = Trues<OutputFieldSelection>> = Select<OutputFields, F>

export type FieldSelection = {
  block?: BlockHeaderFieldSelection
  transaction?: TransactionFieldSelection
  input?: InputFieldSelection
  output?: OutputFieldSelection
}

export type TransactionRequest = {
  inputs?: boolean
  outputs?: boolean
}

export type InputRequest = {
  type?: string[]
  prevoutScriptPubKeyAddress?: string[]
  prevoutScriptPubKeyType?: string[]
  prevoutGenerated?: boolean
  transaction?: boolean
  transactionInputs?: boolean
  transactionOutputs?: boolean
}

export type OutputRequest = {
  scriptPubKeyAddress?: string[]
  scriptPubKeyType?: string[]
  transaction?: boolean
  transactionInputs?: boolean
  transactionOutputs?: boolean
}

export type DataRequest = {
  includeAllBlocks?: boolean
  transactions?: TransactionRequest[]
  inputs?: InputRequest[]
  outputs?: OutputRequest[]
}

export type Query<F extends FieldSelection = FieldSelection> = Simplify<
  PortalQuery & {
    type: 'bitcoin'
    fields: F
  } & DataRequest
>

export type Block<F extends FieldSelection> = Simplify<{
  header: BlockHeader<Selected<F, 'block'>>
  transactions: Transaction<Selected<F, 'transaction'>>[]
  inputs: Input<Selected<F, 'input'>>[]
  outputs: Output<Selected<F, 'output'>>[]
}>

export function getBlockSchema<F extends FieldSelection>(fields: F): Validator<Block<F>, unknown> {
  const header = object(project(BlockHeaderShape, fields.block))
  const transaction = object(project(TransactionShape, fields.transaction))
  const input = object(project(InputShape, fields.input))
  const output = object(project(OutputShape, fields.output))

  return object({
    header,
    transactions: withDefault([], array(transaction)),
    inputs: withDefault([], array(input)),
    outputs: withDefault([], array(output)),
  }) as Validator<Block<F>, unknown>
}

const BlockHeaderShape: ObjectValidatorShape<BlockHeaderFields> = {
  number: NAT,
  hash: STRING,
  parentHash: STRING,
  timestamp: NAT,
  medianTime: NAT,
  version: NAT,
  merkleRoot: STRING,
  nonce: NAT,
  target: STRING,
  bits: STRING,
  difficulty: FLOAT,
  chainWork: STRING,
  strippedSize: NAT,
  size: NAT,
  weight: NAT,
}

const TransactionShape: ObjectValidatorShape<TransactionFields> = {
  transactionIndex: NAT,
  hex: STRING,
  txid: STRING,
  hash: STRING,
  size: NAT,
  vsize: NAT,
  weight: NAT,
  version: NAT,
  locktime: NAT,
}

const InputShape: ObjectValidatorShape<InputFields> = {
  transactionIndex: NAT,
  inputIndex: NAT,
  type: STRING,
  txid: option(STRING),
  vout: option(NAT),
  scriptSigHex: option(STRING),
  scriptSigAsm: option(STRING),
  sequence: NAT,
  coinbase: option(STRING),
  txInWitness: option(array(STRING)),
  prevoutGenerated: option(BOOLEAN),
  prevoutHeight: option(NAT),
  // BTC amount as JSON float (Bitcoin Core convention), not satoshis.
  prevoutValue: option(FLOAT),
  prevoutScriptPubKeyHex: option(STRING),
  prevoutScriptPubKeyAsm: option(STRING),
  prevoutScriptPubKeyDesc: option(STRING),
  prevoutScriptPubKeyType: option(STRING),
  prevoutScriptPubKeyAddress: option(STRING),
}

const OutputShape: ObjectValidatorShape<OutputFields> = {
  transactionIndex: NAT,
  outputIndex: NAT,
  value: FLOAT,
  scriptPubKeyHex: STRING,
  scriptPubKeyAsm: STRING,
  scriptPubKeyDesc: STRING,
  scriptPubKeyType: STRING,
  scriptPubKeyAddress: option(STRING),
}
