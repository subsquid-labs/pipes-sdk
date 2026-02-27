import type { Logger } from '~/core/logger.js'
import { HttpClient } from '~/http-client/index.js'

import { type MulticallRequest, type MulticallResult, decodeMulticallResult, encodeMulticall } from './multicall.js'

export interface RpcClientOptions {
  urls: string[]
  httpTimeout?: number
  retryAttempts?: number
  logger?: Logger
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown[]
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number
  result?: T
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

/** Maximum safe request ID before wrapping to avoid overflow */
const MAX_REQUEST_ID = Number.MAX_SAFE_INTEGER - 1

/**
 * Simple JSON-RPC 2.0 client with round-robin load balancing.
 * Compatible with the Chain.client interface from @subsquid/evm-abi.
 */
export class RpcClient {
  private httpClients: HttpClient[]
  private currentIndex = 0
  private requestId = 0

  constructor(private options: RpcClientOptions) {
    if (options.urls.length === 0) {
      throw new Error('At least one RPC URL is required')
    }

    this.httpClients = options.urls.map(
      (url) =>
        new HttpClient({
          baseUrl: url,
          httpTimeout: options.httpTimeout ?? 30000,
          retryAttempts: options.retryAttempts ?? 3,
          logger: options.logger,
        }),
    )
  }

  /**
   * Call a JSON-RPC method.
   * Implements the Chain.client interface.
   */
  async call<T = unknown>(method: string, params?: unknown[]): Promise<T> {
    const client = this.getNextClient()
    this.requestId = this.requestId >= MAX_REQUEST_ID ? 1 : this.requestId + 1
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: this.requestId,
      method,
      params,
    }

    const response = await client.post<JsonRpcResponse<T>>('/', { json: request })

    if (response.error) {
      throw new RpcError(response.error.code, response.error.message, response.error.data)
    }

    return response.result as T
  }

  /**
   * Execute multiple calls via Multicall3 contract.
   */
  async multicall(
    multicallAddress: string,
    requests: MulticallRequest[],
    blockTag = 'latest',
  ): Promise<MulticallResult[]> {
    if (requests.length === 0) return []

    const callData = encodeMulticall(requests)

    const result = await this.call<string>('eth_call', [
      {
        to: multicallAddress,
        data: callData,
      },
      blockTag,
    ])

    return decodeMulticallResult(result)
  }

  private getNextClient(): HttpClient {
    const client = this.httpClients[this.currentIndex]
    this.currentIndex = (this.currentIndex + 1) % this.httpClients.length
    return client
  }
}

export class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(`RPC error ${code}: ${message}`)
    this.name = 'RpcError'
  }
}
