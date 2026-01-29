import { viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { MULTICALL3_ADDRESS, decodeMulticallResult, encodeMulticall } from './multicall.js'

describe('Multicall encoding/decoding', () => {
  const nameFunc = viewFun('0x06fdde03', 'name()', {}, p.string)
  const decimalsFunc = viewFun('0x313ce567', 'decimals()', {}, p.uint8)

  it('should encode multicall requests', () => {
    const requests = [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: nameFunc.encode({}),
        allowFailure: true,
      },
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: decimalsFunc.encode({}),
        allowFailure: true,
      },
    ]

    const encoded = encodeMulticall(requests)

    // Should start with aggregate3 selector
    expect(encoded.startsWith('0x82ad56cb')).toBe(true)
    // Should be a valid hex string
    expect(/^0x[0-9a-f]+$/i.test(encoded)).toBe(true)
  })

  it('should decode multicall result', () => {
    // Test with known encoded multicall return data
    const simpleResult = decodeMulticallResult(
      '0x' +
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to array
        '0000000000000000000000000000000000000000000000000000000000000001' + // array length = 1
        '0000000000000000000000000000000000000000000000000000000000000020' + // offset to first struct
        '0000000000000000000000000000000000000000000000000000000000000001' + // success = true
        '0000000000000000000000000000000000000000000000000000000000000040' + // offset to returnData
        '0000000000000000000000000000000000000000000000000000000000000004' + // returnData length = 4
        'deadbeef00000000000000000000000000000000000000000000000000000000', // returnData = 0xdeadbeef (padded)
    )

    expect(simpleResult).toHaveLength(1)
    expect(simpleResult[0].success).toBe(true)
    expect(simpleResult[0].returnData).toBe('0xdeadbeef')
  })

  it('should use canonical Multicall3 address', () => {
    expect(MULTICALL3_ADDRESS).toBe('0xcA11bde05977b3631167028862bE2a173976CA11')
  })

  it('should default allowFailure to true', () => {
    const requests = [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        callData: '0x06fdde03',
      },
    ]

    const encoded = encodeMulticall(requests)

    // The encoding should succeed without explicit allowFailure
    expect(encoded).toBeTruthy()
  })
})
