import { fun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'

/**
 * Multicall3 aggregate3 function ABI.
 * See: https://github.com/mds1/multicall
 */
export const aggregate3 = fun(
  '0x82ad56cb',
  'aggregate3((address,bool,bytes)[])',
  {
    calls: p.array(
      p.struct({
        target: p.address,
        allowFailure: p.bool,
        callData: p.bytes,
      }),
    ),
  },
  p.array(
    p.struct({
      success: p.bool,
      returnData: p.bytes,
    }),
  ),
)

export interface MulticallRequest {
  target: string
  callData: string
  allowFailure?: boolean
}

export interface MulticallResult {
  success: boolean
  returnData: string
}

/**
 * Canonical Multicall3 address deployed on most EVM chains.
 * See: https://www.multicall3.com/deployments
 */
export const MULTICALL3_ADDRESS = '0xcA11bde05977b3631167028862bE2a173976CA11'

/**
 * Encode multiple calls into a single Multicall3 aggregate3 call.
 */
export function encodeMulticall(requests: MulticallRequest[]): string {
  const calls = requests.map((req) => ({
    target: req.target,
    allowFailure: req.allowFailure ?? true,
    callData: req.callData,
  }))

  return aggregate3.encode({ calls })
}

/**
 * Decode the result from a Multicall3 aggregate3 call.
 */
export function decodeMulticallResult(data: string): MulticallResult[] {
  const decoded = aggregate3.decodeResult(data)
  return decoded.map((result) => ({
    success: result.success,
    returnData: result.returnData,
  }))
}
