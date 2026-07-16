import * as erc20 from '~/evm/abi/erc20.js'

export type { DefinedAbi, JsonAbiItem, JsonAbiParameter } from './define-abi.js'
export { defineAbi } from './define-abi.js'

export const commonAbis = {
  erc20,
}
