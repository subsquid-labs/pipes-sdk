import pThrottle, { ThrottledFunction } from 'p-throttle'
import { inspect } from 'util'
import {
  type Address,
  BaseError,
  createPublicClient,
  erc20Abi,
  http,
  PublicClient,
  RawContractError,
} from 'viem'
import { createDefaultLogger, type LogLevel, type Logger } from '~/core/logger.js'
import { EvmMulticallAddress } from '~/evm/transformers/token-metadata/constants.js'
import { LFUCache } from './lfu-cache.js'
import { Token } from './types.js'
import { TokenStore } from './stores/types.js'

const TOKEN_BATCH_SIZE = 100
const MAX_CACHE_SIZE = 2_000_000
const NATIVE_TOKEN = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'

/**
 * Creates a placeholder token for addresses that couldn't be resolved.
 */
export function unknownToken(address: string): Token {
  return {
    address: address.toLowerCase(),
    symbol: 'UNKNOWN',
    name: 'Unknown Token',
    decimals: 18,
  }
}

// ============================================================================
// Types
// ============================================================================

/** ERC20 token info (name, symbol, decimals) */
export type { Token } from './types.js'

/**
 * Configuration options for the token info service.
 */
export interface TokenInfoOptions {
  /**
   * RPC endpoint(s) for fetching token info.
   * Can be a single URL or an array for load balancing.
   * @example 'https://eth.llamarpc.com'
   * @example ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth']
   */
  rpc: string | string[]

  /**
   * Persistent store for caching token info.
   * Use `SqliteTokenStore` or `ClickHouseTokenStore`.
   * If omitted, tokens are cached in-memory only (no persistence).
   */
  store?: TokenStore | Promise<TokenStore>

  /**
   * Custom multicall contract address.
   * @default Standard Multicall3 address (works on most EVM chains)
   */
  multicallAddress?: Address

  /** Logger instance or log level */
  logger?: Logger | LogLevel

  /**
   * Maximum RPC requests per second.
   * @default 400
   */
  rateLimit?: number

  /**
   * Maximum retry attempts for failed RPC calls.
   * @default 3
   */
  maxRetries?: number

  /**
   * Delay between retries in milliseconds.
   * @default 200
   */
  retryDelayMs?: number
}

// ============================================================================
// TokenInfo Service
// ============================================================================

/**
 * Service for enriching blockchain data with ERC20 token info.
 *
 * Fetches and caches token name, symbol, and decimals from on-chain data.
 * Results are persisted to avoid redundant RPC calls.
 *
 * @example
 * ```ts
 * const tokens = tokenInfo({
 *   rpc: 'https://eth.llamarpc.com',
 *   store: SqliteTokenStore.create('./tokens.db'),
 * })
 *
 * // Use in a pipeline
 * stream.pipe(tokens.enrich('tokenAddress'))
 *
 * // Or fetch directly
 * const metadata = await tokens.get(['0x...', '0x...'])
 * ```
 */
export class TokenInfo {
  private store?: TokenStore
  private initialized = false
  private initPromise?: Promise<void>
  private readonly cache: LFUCache<Token>
  private readonly errorCounts = new Map<string, number>()
  private readonly multicallAddress: Address
  private readonly rpcEndpoints: readonly string[]
  private readonly logger: Logger
  private readonly readContractPool: ThrottledFunction<PublicClient['readContract']>[] = []
  private readonly multicallPool: ThrottledFunction<PublicClient['multicall']>[] = []
  private rpcIndex = -1
  private readonly maxRetries: number
  private readonly retryDelayMs: number

  constructor(private readonly options: TokenInfoOptions) {
    this.logger =
      options.logger && typeof options.logger !== 'string'
        ? options.logger
        : createDefaultLogger()

    this.maxRetries = options.maxRetries ?? 3
    this.retryDelayMs = options.retryDelayMs ?? 200
    this.multicallAddress = options.multicallAddress ?? EvmMulticallAddress

    // Normalize RPC endpoints
    this.rpcEndpoints = typeof options.rpc === 'string' ? [options.rpc] : options.rpc

    if (this.rpcEndpoints.length === 0) {
      throw new Error('TokenInfo requires at least one RPC endpoint')
    }

    // Setup throttled RPC clients
    const throttle = pThrottle({ limit: options.rateLimit ?? 400, interval: 1000 })

    for (const rpc of this.rpcEndpoints) {
      const client = createPublicClient({
        cacheTime: 100_000,
        batch: { multicall: { batchSize: 1024 } },
        transport: http(rpc),
      })

      this.readContractPool.push(throttle(client.readContract))
      this.multicallPool.push(throttle(client.multicall))
    }

    // Initialize cache with native ETH
    this.cache = new LFUCache<Token>(MAX_CACHE_SIZE)
    this.cacheToken({
      address: NATIVE_TOKEN,
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
    })

    // Start initialization eagerly (non-blocking)
    void this.ensureInitialized()
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Fetches token info for the given addresses.
   *
   * Results are cached - subsequent calls for the same addresses are instant.
   *
   * @param addresses - Token contract addresses to look up
   * @returns Map of lowercase address to token info
   *
   * @example
   * ```ts
   * const metadata = await tokens.get([
   *   '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
   *   '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
   * ])
   *
   * const usdc = metadata.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')
   * console.log(usdc?.symbol) // 'USDC'
   * ```
   */
  async get(addresses: string[]): Promise<Map<string, Token>> {
    await this.ensureInitialized()

    const normalized = addresses.map((a) => a.toLowerCase())
    const unique = [...new Set(normalized)]

    await this.fetchMissingTokens(unique)

    const result = new Map<string, Token>()
    for (const addr of unique) {
      const token = this.cache.get(addr)
      if (token) result.set(addr, token)
    }
    return result
  }

  /**
   * Creates a transformer that enriches objects with token info.
   *
   * For each specified key, adds a corresponding `{key}Metadata` field
   * containing the token's name, symbol, decimals, and address.
   *
   * @param key - Object key(s) containing token addresses
   * @returns Transformer function for use with `.pipe()`
   *
   * @example
   * ```ts
   * // Single field
   * stream.pipe(tokens.enrich('tokenAddress'))
   * // Input:  { tokenAddress: '0x...', amount: 100n }
   * // Output: { tokenAddress: '0x...', amount: 100n, tokenAddressMetadata: { symbol: 'USDC', ... } }
   *
   * // Multiple fields
   * stream.pipe(tokens.enrich(['token0', 'token1']))
   * // Adds both token0Metadata and token1Metadata
   * ```
   */
  enrich<K extends string>(
    key: K | K[],
  ): <T extends Record<K, string>>(items: T[]) => Promise<(T & { [P in K as `${P}Metadata`]: Token | undefined })[]> {
    const keys = Array.isArray(key) ? key : [key]

    return async <T extends Record<K, string>>(items: T[]) => {
      // Collect all addresses
      const addresses = keys.flatMap((k) =>
        items.map((item) => {
          const value = item[k]
          if (typeof value !== 'string') {
            throw new TypeError(
              `Expected '${k}' to be a string address, got ${typeof value}`,
            )
          }
          return value
        }),
      )

      const metadata = await this.get(addresses)

      return items.map((item) => {
        const enriched = { ...item } as T & { [P in K as `${P}Metadata`]: Token | undefined }

        for (const k of keys) {
          const address = item[k].toLowerCase()
          const metadataKey = `${k}Metadata`
          ;(enriched as Record<string, unknown>)[metadataKey] = metadata.get(address)
        }

        return enriched
      })
    }
  }

  // ==========================================================================
  // Internal Methods
  // ==========================================================================

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return

    if (!this.initPromise) {
      this.initPromise = (async () => {
        if (this.options.store) {
          this.store =
            this.options.store instanceof Promise ? await this.options.store : this.options.store
          await this.store.migrate()
        }
        this.initialized = true
      })()
    }

    await this.initPromise
  }

  private nextRpc() {
    this.rpcIndex = (this.rpcIndex + 1) % this.rpcEndpoints.length
    return this.rpcIndex
  }

  private readContract(params: Parameters<PublicClient['readContract']>[0]) {
    return this.readContractPool[this.nextRpc()](params)
  }

  private multicall(params: Parameters<PublicClient['multicall']>[0]) {
    return this.multicallPool[this.nextRpc()](params)
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastError: unknown
    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn()
      } catch (err) {
        lastError = err
        if (attempt < this.maxRetries) {
          this.logger.warn(
            `Token info operation failed (attempt ${attempt}/${this.maxRetries}), retrying...`,
          )
          if (this.retryDelayMs > 0) {
            await new Promise((r) => setTimeout(r, this.retryDelayMs))
          }
        }
      }
    }
    throw lastError
  }

  private cacheToken(token: Token): void {
    const normalized = { ...token, address: token.address.toLowerCase() }
    this.cache.set(normalized.address, normalized, normalized.address === NATIVE_TOKEN)
  }

  private async fetchMissingTokens(addresses: string[]): Promise<void> {
    const uncached = addresses.filter((a) => !this.cache.has(a))
    if (uncached.length === 0) return

    // Try loading from store first (if store is configured)
    if (this.store) {
      const fromStore = await this.store.get(uncached)
      Object.values(fromStore).forEach((token) => this.cacheToken(token))
    }

    // Fetch remaining from RPC
    const missing = uncached.filter((a) => !this.cache.has(a))
    if (missing.length === 0) return

    for (let i = 0; i < missing.length; i += TOKEN_BATCH_SIZE) {
      const batch = missing.slice(i, i + TOKEN_BATCH_SIZE)
      await this.fetchBatch(batch)
    }
  }

  private async fetchBatch(addresses: string[]): Promise<void> {
    // Try multicall first
    let multicallResults: Record<string, { decimals: number; symbol: string; name: string }> = {}
    let multicallSuccess = false

    for (let attempt = 1; attempt <= this.maxRetries && !multicallSuccess; attempt++) {
      try {
        multicallResults = await this.executeMulticall(addresses)
        multicallSuccess = true
      } catch (err) {
        this.logger.error(`Multicall failed: ${(err as any).shortMessage || (err as any).message}`)
      }
    }

    const tokensToSave: Token[] = []
    const failedAddresses: string[] = []

    if (multicallSuccess) {
      for (const address of addresses) {
        try {
          const data = multicallResults[address]
          const token: Token = {
            address,
            decimals: data.decimals,
            symbol: data.symbol,
            name: data.name,
          }
          tokensToSave.push(token)
          this.cacheToken(token)
        } catch {
          failedAddresses.push(address)
        }
      }

      if (tokensToSave.length > 0 && this.store) {
        await this.withRetry(async () => {
          await this.store!.save(tokensToSave)
        })
      }
    } else {
      failedAddresses.push(...addresses)
    }

    // Fallback to individual RPC calls for failed addresses
    if (failedAddresses.length > 0) {
      this.logger.warn(`Fetching ${failedAddresses.length} tokens individually...`)
      await this.fetchIndividually(failedAddresses)
    }
  }

  private async executeMulticall(
    addresses: string[],
  ): Promise<Record<string, { decimals: number; symbol: string; name: string }>> {
    const calls = addresses.flatMap((address) => [
      { address: address as Address, abi: erc20Abi, functionName: 'decimals' },
      { address: address as Address, abi: erc20Abi, functionName: 'symbol' },
      { address: address as Address, abi: erc20Abi, functionName: 'name' },
    ] as const)

    type MulticallResult =
      | { status: 'success'; result: unknown }
      | { status: 'failure'; error: Error }

    const results = (await this.multicall({
      contracts: calls,
      multicallAddress: this.multicallAddress,
    })) as MulticallResult[]

    const output: Record<string, { decimals: number; symbol: string; name: string }> = {}

    addresses.forEach((address, i) => {
      const base = i * 3
      const decimals = results[base]
      const symbol = results[base + 1]
      const name = results[base + 2]

      output[address] = {
        decimals: decimals.status === 'success' ? (decimals.result as number) : 18,
        symbol: symbol.status === 'success' ? (symbol.result as string) : '',
        name: name.status === 'success' ? (name.result as string) : '',
      }
    })

    return output
  }

  private async fetchIndividually(addresses: string[]): Promise<void> {
    const results = await Promise.all(
      addresses.map(async (address): Promise<Token | undefined> => {
        try {
          const [decimals, symbol, name] = await Promise.allSettled([
            this.readContract({ address: address as Address, abi: erc20Abi, functionName: 'decimals' }),
            this.readContract({ address: address as Address, abi: erc20Abi, functionName: 'symbol' }),
            this.readContract({ address: address as Address, abi: erc20Abi, functionName: 'name' }),
          ])

          // If all calls failed with non-missing-field errors, token doesn't exist
          const allFailed =
            decimals.status === 'rejected' &&
            !this.isMissingFieldError(decimals.reason) &&
            symbol.status === 'rejected' &&
            !this.isMissingFieldError(symbol.reason) &&
            name.status === 'rejected' &&
            !this.isMissingFieldError(name.reason)

          if (allFailed) {
            this.logger.error(`Failed to fetch token ${address}`)
            return undefined
          }

          return {
            address: address.toLowerCase(),
            decimals: decimals.status === 'fulfilled' ? Number(decimals.value) : 18,
            symbol: symbol.status === 'fulfilled' ? (symbol.value as string) : '',
            name: name.status === 'fulfilled' ? (name.value as string) : '',
          }
        } catch (err) {
          this.logger.error(`Error fetching token ${address}: ${inspect(err)}`)
          return undefined
        }
      }),
    )

    const tokensToSave: Token[] = []

    for (let i = 0; i < addresses.length; i++) {
      const token = results[i]
      const address = addresses[i]

      if (token) {
        tokensToSave.push(token)
        this.cacheToken(token)
        this.errorCounts.delete(address)
      } else {
        // Track failures, save as unknown after threshold
        const errorCount = (this.errorCounts.get(address) ?? 0) + 1
        if (errorCount > 10) {
          const unknown = unknownToken(address)
          tokensToSave.push(unknown)
          this.cacheToken(unknown)
          this.errorCounts.delete(address)
        } else {
          this.errorCounts.set(address, errorCount)
        }
      }
    }

    if (tokensToSave.length > 0 && this.store) {
      await this.withRetry(async () => {
        await this.store!.save(tokensToSave)
      })
    }
  }

  private isMissingFieldError(error: unknown): boolean {
    if (!(error instanceof BaseError)) return false

    let isMissing = false
    error.walk((err: unknown) => {
      if (err instanceof RawContractError && (!err.data || err.data === '0x')) {
        isMissing = true
      }
      if (
        err &&
        typeof err === 'object' &&
        'shortMessage' in err &&
        typeof (err as { shortMessage: unknown }).shortMessage === 'string'
      ) {
        const msg = ((err as { shortMessage: string }).shortMessage).toLowerCase()
        if (msg.includes('execution reverted') || msg.includes('no data')) {
          isMissing = true
        }
      }
      return false
    })

    return isMissing
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Creates a token info service for enriching blockchain data with ERC20 token information.
 *
 * @param options - Configuration options
 * @returns TokenInfo service instance
 *
 * @example
 * ```ts
 * import { tokenInfo, SqliteTokenStore } from '@subsquid/pipes'
 *
 * const tokens = tokenInfo({
 *   rpc: 'https://eth.llamarpc.com',
 *   store: SqliteTokenStore.create('./tokens.db'),
 * })
 *
 * // Enrich transfer events with token info
 * const enrichedTransfers = await evmPortalSource({ portal })
 *   .pipe(evmDecoder({ events: { transfers: erc20.Transfer } }))
 *   .pipe((d) => d.transfers)
 *   .pipe(tokens.enrich('address'))
 *
 * // Or fetch metadata directly
 * const metadata = await tokens.get(['0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'])
 * console.log(metadata.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.symbol) // 'USDC'
 * ```
 */
export function tokenInfo(options: TokenInfoOptions): TokenInfo {
  return new TokenInfo(options)
}

// ============================================================================
// Re-exports
// ============================================================================

export { ClickHouseTokenStore, SqliteTokenStore, type TokenStore } from './stores/index.js'
