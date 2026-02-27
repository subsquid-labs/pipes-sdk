import { viewFun } from '@subsquid/evm-abi'
import * as p from '@subsquid/evm-codec'
import { describe, expect, it } from 'vitest'

import { MULTICALL3_ADDRESS } from './multicall.js'
import { RpcClient } from './rpc-client.js'

describe('RpcClient', () => {
  it('should throw error when no URLs provided', () => {
    expect(() => new RpcClient({ urls: [] })).toThrow('At least one RPC URL is required')
  })

  it('should construct with single URL', () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    expect(client).toBeInstanceOf(RpcClient)
  })

  it('should construct with multiple URLs', () => {
    const client = new RpcClient({
      urls: ['http://localhost:8545', 'http://localhost:8546'],
    })
    expect(client).toBeInstanceOf(RpcClient)
  })

  // Integration tests would require a running RPC server
  // These are placeholder tests showing expected behavior

  it.skip('should call JSON-RPC method', async () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    const blockNumber = await client.call<string>('eth_blockNumber', [])
    expect(typeof blockNumber).toBe('string')
  })

  it.skip('should execute multicall', async () => {
    const client = new RpcClient({ urls: ['http://localhost:8545'] })
    const nameFunc = viewFun('0x06fdde03', 'name()', {}, p.string)

    const results = await client.multicall(MULTICALL3_ADDRESS, [
      {
        target: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC on Ethereum
        callData: nameFunc.encode({}),
      },
    ])

    expect(results).toHaveLength(1)
    expect(results[0].success).toBe(true)
  })
})
