import { Base58Bytes, getInstructionData, getInstructionDescriptor } from '@subsquid/solana-stream'
import { toHex } from '@subsquid/util-internal-hex'

export const D0_SYM = Symbol('D0')
export const D1_SYM = Symbol('D1')
export const D2_SYM = Symbol('D2')
export const D4_SYM = Symbol('D4')

interface RawInstruction {
  data: Base58Bytes
  [D0_SYM]?: string
  [D1_SYM]?: string
  [D2_SYM]?: string
  [D4_SYM]?: string
}

export function getInstructionD1(instruction: RawInstruction) {
  if (instruction[D1_SYM]) return instruction[D1_SYM]
  instruction[D1_SYM] = toHex(getInstructionData(instruction)).slice(0, 4)
  return instruction[D1_SYM]
}

export function getInstructionD2(instruction: RawInstruction) {
  if (instruction[D2_SYM]) return instruction[D2_SYM]
  instruction[D2_SYM] = toHex(getInstructionData(instruction)).slice(0, 8)
  return instruction[D2_SYM]
}

export function getInstructionD4(instruction: RawInstruction) {
  if (instruction[D4_SYM]) return instruction[D4_SYM]
  instruction[D4_SYM] = toHex(getInstructionData(instruction)).slice(0, 14)
  return instruction[D4_SYM]
}

export function getInstructionD8(instruction: RawInstruction) {
  return getInstructionDescriptor(instruction) // 0, 18
}
