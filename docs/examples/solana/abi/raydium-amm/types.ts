import { address, Codec, fixedArray, ref, struct, u8, u64, u128 } from '@subsquid/borsh'

export interface WithdrawDestToken {
  withdrawAmount: bigint
  coinAmount: bigint
  pcAmount: bigint
  destTokenCoin: string
  destTokenPc: string
}

export const WithdrawDestToken: Codec<WithdrawDestToken> = struct({
  withdrawAmount: u64,
  coinAmount: u64,
  pcAmount: u64,
  destTokenCoin: address,
  destTokenPc: address,
})

export interface WithdrawQueue {
  owner: Array<bigint>
  head: bigint
  count: bigint
  buf: Array<WithdrawDestToken>
}

export const WithdrawQueue: Codec<WithdrawQueue> = struct({
  owner: fixedArray(u64, 4),
  head: u64,
  count: u64,
  buf: fixedArray(
    ref(() => WithdrawDestToken),
    64,
  ),
})

export interface TargetOrder {
  price: bigint
  vol: bigint
}

export const TargetOrder: Codec<TargetOrder> = struct({
  price: u64,
  vol: u64,
})

export interface OutPutData {
  needTakePnlCoin: bigint
  needTakePnlPc: bigint
  totalPnlPc: bigint
  totalPnlCoin: bigint
  poolOpenTime: bigint
  punishPcAmount: bigint
  punishCoinAmount: bigint
  orderbookToInitTime: bigint
  swapCoinInAmount: bigint
  swapPcOutAmount: bigint
  swapTakePcFee: bigint
  swapPcInAmount: bigint
  swapCoinOutAmount: bigint
  swapTakeCoinFee: bigint
}

export const OutPutData: Codec<OutPutData> = struct({
  needTakePnlCoin: u64,
  needTakePnlPc: u64,
  totalPnlPc: u64,
  totalPnlCoin: u64,
  poolOpenTime: u64,
  punishPcAmount: u64,
  punishCoinAmount: u64,
  orderbookToInitTime: u64,
  swapCoinInAmount: u128,
  swapPcOutAmount: u128,
  swapTakePcFee: u64,
  swapPcInAmount: u128,
  swapCoinOutAmount: u128,
  swapTakeCoinFee: u64,
})

export interface AmmConfig {
  pnlOwner: string
  cancelOwner: string
  pending1: Array<bigint>
  pending2: Array<bigint>
}

export const AmmConfig: Codec<AmmConfig> = struct({
  pnlOwner: address,
  cancelOwner: address,
  pending1: fixedArray(u64, 28),
  pending2: fixedArray(u64, 32),
})

export interface LastOrderDistance {
  lastOrderNumerator: bigint
  lastOrderDenominator: bigint
}

export const LastOrderDistance: Codec<LastOrderDistance> = struct({
  lastOrderNumerator: u64,
  lastOrderDenominator: u64,
})

export interface NeedTake {
  needTakePc: bigint
  needTakeCoin: bigint
}

export const NeedTake: Codec<NeedTake> = struct({
  needTakePc: u64,
  needTakeCoin: u64,
})

export interface SwapInstructionBaseIn {
  amountIn: bigint
  minimumAmountOut: bigint
}

export const SwapInstructionBaseIn: Codec<SwapInstructionBaseIn> = struct({
  amountIn: u64,
  minimumAmountOut: u64,
})

export interface SwapInstructionBaseOut {
  maxAmountIn: bigint
  amountOut: bigint
}

export const SwapInstructionBaseOut: Codec<SwapInstructionBaseOut> = struct({
  maxAmountIn: u64,
  amountOut: u64,
})

export interface TargetOrders {
  owner: Array<bigint>
  buyOrders: Array<TargetOrder>
  padding1: Array<bigint>
  targetX: bigint
  targetY: bigint
  planXBuy: bigint
  planYBuy: bigint
  planXSell: bigint
  planYSell: bigint
  placedX: bigint
  placedY: bigint
  calcPnlX: bigint
  calcPnlY: bigint
  sellOrders: Array<TargetOrder>
  padding2: Array<bigint>
  replaceBuyClientId: Array<bigint>
  replaceSellClientId: Array<bigint>
  lastOrderNumerator: bigint
  lastOrderDenominator: bigint
  planOrdersCur: bigint
  placeOrdersCur: bigint
  validBuyOrderNum: bigint
  validSellOrderNum: bigint
  padding3: Array<bigint>
  freeSlotBits: bigint
}

export const TargetOrders: Codec<TargetOrders> = struct({
  owner: fixedArray(u64, 4),
  buyOrders: fixedArray(
    ref(() => TargetOrder),
    50,
  ),
  padding1: fixedArray(u64, 8),
  targetX: u128,
  targetY: u128,
  planXBuy: u128,
  planYBuy: u128,
  planXSell: u128,
  planYSell: u128,
  placedX: u128,
  placedY: u128,
  calcPnlX: u128,
  calcPnlY: u128,
  sellOrders: fixedArray(
    ref(() => TargetOrder),
    50,
  ),
  padding2: fixedArray(u64, 6),
  replaceBuyClientId: fixedArray(u64, 10),
  replaceSellClientId: fixedArray(u64, 10),
  lastOrderNumerator: u64,
  lastOrderDenominator: u64,
  planOrdersCur: u64,
  placeOrdersCur: u64,
  validBuyOrderNum: u64,
  validSellOrderNum: u64,
  padding3: fixedArray(u64, 10),
  freeSlotBits: u128,
})

export interface Fees {
  minSeparateNumerator: bigint
  minSeparateDenominator: bigint
  tradeFeeNumerator: bigint
  tradeFeeDenominator: bigint
  pnlNumerator: bigint
  pnlDenominator: bigint
  swapFeeNumerator: bigint
  swapFeeDenominator: bigint
}

export const Fees: Codec<Fees> = struct({
  minSeparateNumerator: u64,
  minSeparateDenominator: u64,
  tradeFeeNumerator: u64,
  tradeFeeDenominator: u64,
  pnlNumerator: u64,
  pnlDenominator: u64,
  swapFeeNumerator: u64,
  swapFeeDenominator: u64,
})

export interface AmmInfo {
  status: bigint
  nonce: bigint
  orderNum: bigint
  depth: bigint
  coinDecimals: bigint
  pcDecimals: bigint
  state: bigint
  resetFlag: bigint
  minSize: bigint
  volMaxCutRatio: bigint
  amountWave: bigint
  coinLotSize: bigint
  pcLotSize: bigint
  minPriceMultiplier: bigint
  maxPriceMultiplier: bigint
  sysDecimalValue: bigint
  fees: Fees
  outPut: OutPutData
  tokenCoin: string
  tokenPc: string
  coinMint: string
  pcMint: string
  lpMint: string
  openOrders: string
  market: string
  serumDex: string
  targetOrders: string
  withdrawQueue: string
  tokenTempLp: string
  ammOwner: string
  lpAmount: bigint
  clientOrderId: bigint
  padding: Array<bigint>
}

export const AmmInfo: Codec<AmmInfo> = struct({
  status: u64,
  nonce: u64,
  orderNum: u64,
  depth: u64,
  coinDecimals: u64,
  pcDecimals: u64,
  state: u64,
  resetFlag: u64,
  minSize: u64,
  volMaxCutRatio: u64,
  amountWave: u64,
  coinLotSize: u64,
  pcLotSize: u64,
  minPriceMultiplier: u64,
  maxPriceMultiplier: u64,
  sysDecimalValue: u64,
  fees: ref(() => Fees),
  outPut: ref(() => OutPutData),
  tokenCoin: address,
  tokenPc: address,
  coinMint: address,
  pcMint: address,
  lpMint: address,
  openOrders: address,
  market: address,
  serumDex: address,
  targetOrders: address,
  withdrawQueue: address,
  tokenTempLp: address,
  ammOwner: address,
  lpAmount: u64,
  clientOrderId: u64,
  padding: fixedArray(u64, 2),
})

export interface Init {
  logType: number
  time: bigint
  pcDecimals: number
  coinDecimals: number
  pcLotSize: bigint
  coinLotSize: bigint
  pcAmount: bigint
  coinAmount: bigint
  market: string
}

export const Init: Codec<Init> = struct({
  logType: u8,
  time: u64,
  pcDecimals: u8,
  coinDecimals: u8,
  pcLotSize: u64,
  coinLotSize: u64,
  pcAmount: u64,
  coinAmount: u64,
  market: address,
})

export interface Deposit {
  logType: number
  maxCoin: bigint
  maxPc: bigint
  base: bigint
  poolCoin: bigint
  poolPc: bigint
  poolLp: bigint
  calcPnlX: bigint
  calcPnlY: bigint
  deductCoin: bigint
  deductPc: bigint
  mintLp: bigint
}

export const Deposit: Codec<Deposit> = struct({
  logType: u8,
  maxCoin: u64,
  maxPc: u64,
  base: u64,
  poolCoin: u64,
  poolPc: u64,
  poolLp: u64,
  calcPnlX: u128,
  calcPnlY: u128,
  deductCoin: u64,
  deductPc: u64,
  mintLp: u64,
})

export interface Withdraw {
  logType: number
  withdrawLp: bigint
  userLp: bigint
  poolCoin: bigint
  poolPc: bigint
  poolLp: bigint
  calcPnlX: bigint
  calcPnlY: bigint
  outCoin: bigint
  outPc: bigint
}

export const Withdraw: Codec<Withdraw> = struct({
  logType: u8,
  withdrawLp: u64,
  userLp: u64,
  poolCoin: u64,
  poolPc: u64,
  poolLp: u64,
  calcPnlX: u128,
  calcPnlY: u128,
  outCoin: u64,
  outPc: u64,
})

export interface SwapBaseIn {
  logType: number
  amountIn: bigint
  minimumAmountOut: bigint
  direction: bigint
  userSource: bigint
  poolCoin: bigint
  poolPc: bigint
  outAmount: bigint
}

export const SwapBaseIn: Codec<SwapBaseIn> = struct({
  logType: u8,
  amountIn: u64,
  minimumAmountOut: u64,
  direction: u64,
  userSource: u64,
  poolCoin: u64,
  poolPc: u64,
  outAmount: u64,
})

export interface SwapBaseOut {
  logType: number
  maxAmountIn: bigint
  amountOut: bigint
  direction: bigint
  userSource: bigint
  poolCoin: bigint
  poolPc: bigint
  deductIn: bigint
}

export const SwapBaseOut: Codec<SwapBaseOut> = struct({
  logType: u8,
  maxAmountIn: u64,
  amountOut: u64,
  direction: u64,
  userSource: u64,
  poolCoin: u64,
  poolPc: u64,
  deductIn: u64,
})
