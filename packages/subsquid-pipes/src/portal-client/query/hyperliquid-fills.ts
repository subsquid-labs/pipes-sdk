import {
  array,
  BOOLEAN,
  BYTES,
  constant,
  NAT,
  object,
  oneOf,
  option,
  STRING,
  Validator,
  withDefault,
} from '@subsquid/util-internal-validation'
import {
  FLOAT,
  type Hex,
  type ObjectValidatorShape,
  type PortalQuery,
  project,
  type Select,
  type Selected,
  type Selector,
  type Simplify,
  type Trues,
} from './common.js'

export type BlockHeaderFields = {
  number: number
  hash: Hex
  parentHash: Hex
  timestamp: number
}

export type FillFields = {
  fillIndex: number
  user: Hex
  coin: string
  px: number
  sz: number
  side: 'A' | 'B'
  time: number
  startPosition: number
  dir: string
  closedPnl: number
  hash: Hex
  oid: number
  crossed: boolean
  fee: number
  builderFee?: number
  tid: number
  cloid?: Hex
  feeToken: string
  builder?: Hex
  twapId?: number
}

export type BlockHeaderFieldSelection = Selector<keyof BlockHeaderFields>
export type BlockHeader<F extends BlockHeaderFieldSelection = Trues<BlockHeaderFieldSelection>> = Select<
  BlockHeaderFields,
  F
>

export type FillFieldSelection = Selector<keyof FillFields>
export type Transaction<F extends FillFieldSelection = Trues<FillFieldSelection>> = Select<FillFields, F>

export type FieldSelection = {
  block?: BlockHeaderFieldSelection
  fill?: FillFieldSelection
}

export type DataRequest = {
  includeAllBlocks?: boolean
  fills?: FillRequest[]
}

export type FillRequest = {
  user?: Hex[]
  coin?: string[]
  dir?: string[]
  cloid?: Hex[]
  feeToken?: string[]
  builder?: Hex[]
}

export type Query<F extends FieldSelection = FieldSelection> = Simplify<
  PortalQuery & {
    type: 'hyperliquidFills'
    fields: F
  } & DataRequest
>

export type Block<F extends FieldSelection> = Simplify<{
  header: BlockHeader<Selected<F, 'block'>>
  fills: Transaction<Selected<F, 'fill'>>[]
}>

export function getBlockSchema<F extends FieldSelection>(fields: F): Validator<Block<F>, unknown> {
  let header = object(project(BlockHeaderShape, fields.block))
  let fill = object(project(FillShape, fields.fill))

  return object({
    header,
    fills: withDefault([], array(fill)),
  }) as Validator<Block<F>, unknown>
}

const BlockHeaderShape: ObjectValidatorShape<BlockHeaderFields> = {
  number: NAT,
  hash: BYTES,
  parentHash: BYTES,
  timestamp: NAT,
}

const FillShape: ObjectValidatorShape<FillFields> = {
  fillIndex: NAT,
  user: BYTES,
  coin: STRING,
  px: FLOAT,
  sz: FLOAT,
  side: oneOf({
    bid: constant('B'),
    ask: constant('A'),
  }),
  time: NAT,
  startPosition: FLOAT,
  dir: STRING,
  closedPnl: FLOAT,
  hash: BYTES,
  oid: NAT,
  crossed: BOOLEAN,
  fee: FLOAT,
  builderFee: option(FLOAT),
  tid: NAT,
  cloid: option(BYTES),
  feeToken: STRING,
  builder: option(BYTES),
  twapId: option(NAT),
}
