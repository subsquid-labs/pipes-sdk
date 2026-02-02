import type { AbiFunction, FunctionReturn } from '@subsquid/evm-abi'
import type { Codec, Struct } from '@subsquid/evm-codec'

import type { Logger } from '~/core/logger.js'
import type { BatchCtx } from '~/core/portal-source.js'
import type { ProfilerOptions } from '~/core/profiling.js'
import { type Transformer, createTransformer } from '~/core/transformer.js'
import { LFUCache } from '~/internal/lfu-cache.js'

import { MULTICALL3_ADDRESS, type MulticallRequest } from './multicall.js'
import { RpcClient } from './rpc-client.js'

type AnyAbiFunction = AbiFunction<Struct, Codec<any> | Struct | undefined>

/**
 * Extract the function name from a signature like "name()" or "balanceOf(address)"
 */
type ExtractFunctionName<S extends string> = S extends `${infer Name}(${string})` ? Name : S

/**
 * Build a typed object from an array of AbiFunction definitions,
 * where keys are function names and values are their return types.
 */
type ContractStateResult<Methods extends readonly AnyAbiFunction[]> = {
  [F in Methods[number] as ExtractFunctionName<F['signature']>]?: FunctionReturn<F>
}

export type EnrichedItem<T, Methods extends readonly AnyAbiFunction[]> = T & {
  contractState: ContractStateResult<Methods>
}

/** Default cache capacity - stores up to 10,000 unique contract addresses */
const DEFAULT_CACHE_CAPACITY = 10_000

/** Default maximum calls per multicall batch */
const DEFAULT_BATCH_SIZE = 100

/** Default HTTP timeout for RPC calls in milliseconds */
const DEFAULT_HTTP_TIMEOUT = 30_000

/** Default number of retry attempts for failed RPC calls */
const DEFAULT_RETRY_ATTEMPTS = 3

/** Default number of batches to execute in parallel */
const DEFAULT_MAX_PARALLEL_BATCHES = 3

export interface RpcEnricherOptions<T, Methods extends readonly AnyAbiFunction[]> {
  /**
   * RPC endpoint URL(s). Can be a single URL or array for load balancing.
   */
  rpcUrls: string | string[]

  /**
   * Multicall3 contract address. Defaults to canonical address.
   */
  multicallAddress?: string

  /**
   * Field path to extract contract addresses from.
   * Supports dot notation for nested fields (e.g., 'event.contract').
   */
  addressField: keyof T | string

  /**
   * ABI function definitions to call for each address.
   * Must be view/pure functions with no arguments.
   *
   * **Important:** This enricher is designed for immutable contract data like
   * `name()`, `symbol()`, `decimals()`. For mutable state, be aware that cached
   * values may become stale after chain reorganizations.
   */
  methods: Methods

  /**
   * Maximum number of addresses to cache. Defaults to 10,000.
   */
  cacheCapacity?: number

  /**
   * Maximum calls per multicall batch. Defaults to 100.
   */
  batchSize?: number

  /**
   * HTTP timeout for RPC calls in milliseconds. Defaults to 30,000.
   */
  httpTimeout?: number

  /**
   * Number of retry attempts for failed RPC calls. Defaults to 3.
   */
  retryAttempts?: number

  /**
   * Make RPC calls at each event's block number.
   *
   * When enabled, each event gets RPC data fetched at its own `block.number`,
   * and caching is keyed by address+block+methods.
   *
   * Use this for mutable state like pool reserves that change every block.
   * Defaults to `false` (uses 'latest' block for all calls).
   *
   * @example
   * ```ts
   * rpcEnricher({
   *   rpcUrls: ['https://eth.llamarpc.com'],
   *   addressField: 'contract',
   *   methods: [poolAbi.functions.getReserves],
   *   callOnEventBlock: true,  // Fetch reserves at each event's block
   * })
   * ```
   */
  callOnEventBlock?: boolean

  /**
   * Maximum number of batches to execute in parallel. Defaults to 3.
   * Set to 1 for sequential execution.
   */
  maxParallelBatches?: number

  /**
   * Profiler configuration for performance monitoring.
   * Defaults to `{ id: 'RPC enricher' }`.
   */
  profiler?: ProfilerOptions
}

/**
 * Get a nested property from an object using dot notation.
 */
function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.')
  let current: unknown = obj

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    if (typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }

  return current
}

/**
 * Extract the function name from an AbiFunction.
 * The signature format is "functionName(args...)" so we extract the name part.
 */
function getFunctionName(func: AnyAbiFunction): string {
  const parenIndex = func.signature.indexOf('(')
  return parenIndex > 0 ? func.signature.slice(0, parenIndex) : func.signature
}

/**
 * Validate that a method has no arguments.
 * Methods with arguments cannot be used with rpcEnricher because we don't know
 * what arguments to pass.
 */
function validateZeroArgMethod(func: AnyAbiFunction): void {
  // Check the args struct for any defined argument fields
  // The args property contains the parameter definitions (e.g., { _owner: p.address })
  const argKeys = Object.keys(func.args || {})
  if (argKeys.length > 0) {
    throw new Error(
      `rpcEnricher only supports zero-argument functions. ` +
        `Method "${func.signature}" has arguments: ${argKeys.join(', ')}. ` +
        `Use methods like name(), symbol(), decimals() instead.`,
    )
  }
}

/**
 * Creates an RPC enricher transformer that fetches on-chain data for decoded events.
 *
 * This transformer extracts addresses from events and fetches contract data (e.g., token name,
 * symbol, decimals) using Multicall3 for batching. Results are cached using an LFU cache.
 *
 * **Failure handling:**
 * - If an RPC endpoint is unreachable, items are returned with empty `contractState`
 * - If a contract doesn't implement a method, that method is omitted from `contractState`
 * - Rate limiting triggers automatic retries with exponential backoff
 *
 * **Fork handling:**
 * This enricher does NOT clear its cache on chain reorganizations. This is intentional
 * for immutable data (name, symbol, decimals) but means mutable state may be stale
 * after a fork. Use only with immutable contract data.
 *
 * @example
 * ```ts
 * import { evmPortalSource, evmDecoder, rpcEnricher, commonAbis } from '@subsquid/pipes/evm'
 *
 * const stream = evmPortalSource({ portal })
 *   .pipe(evmDecoder({
 *     range: { from: 20_000_000 },
 *     events: { transfers: commonAbis.erc20.events.Transfer }
 *   }))
 *   .pipe(rpcEnricher({
 *     rpcUrls: ['https://eth.llamarpc.com'],
 *     addressField: 'contract',
 *     methods: [
 *       commonAbis.erc20.functions.name,
 *       commonAbis.erc20.functions.symbol,
 *       commonAbis.erc20.functions.decimals,
 *     ],
 *   }))
 *
 * for await (const { data } of stream) {
 *   for (const transfer of data.transfers) {
 *     console.log(transfer.contractState) // { name: 'USD Coin', symbol: 'USDC', decimals: 6 }
 *   }
 * }
 * ```
 */
export function rpcEnricher<
  T extends Record<string, object[]>,
  const Methods extends readonly AnyAbiFunction[],
>(
  options: RpcEnricherOptions<T[keyof T][number], Methods>,
): Transformer<T, { [K in keyof T]: EnrichedItem<T[K][number], Methods>[] }> {
  const {
    rpcUrls,
    multicallAddress = MULTICALL3_ADDRESS,
    addressField,
    methods,
    cacheCapacity = DEFAULT_CACHE_CAPACITY,
    batchSize = DEFAULT_BATCH_SIZE,
    httpTimeout = DEFAULT_HTTP_TIMEOUT,
    retryAttempts = DEFAULT_RETRY_ATTEMPTS,
    callOnEventBlock = false,
    maxParallelBatches = DEFAULT_MAX_PARALLEL_BATCHES,
    profiler = { id: 'RPC enricher' },
  } = options

  // Validate methods at construction time
  if (methods.length === 0) {
    throw new Error('rpcEnricher requires at least one method')
  }

  for (const method of methods) {
    validateZeroArgMethod(method)
  }

  const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls]

  // Create a short hash of method signatures for cache key
  // This ensures cache keys are unique per method set
  const methodsKey = methods.map((m) => m.sighash).sort().join('')

  let cache: LFUCache<ContractStateResult<readonly AnyAbiFunction[]>> | undefined
  let rpcClient: RpcClient | undefined

  return createTransformer({
    profiler,

    start: async ({ logger }) => {
      cache = new LFUCache(cacheCapacity)
      rpcClient = new RpcClient({
        urls,
        httpTimeout,
        retryAttempts,
        logger,
      })
      logger.debug(`RPC enricher initialized with ${urls.length} endpoint(s)`)
    },

    stop: async () => {
      // Allow garbage collection
      cache = undefined
      rpcClient = undefined
    },

    transform: async (data: T, ctx: BatchCtx) => {
      const result = {} as { [K in keyof T]: EnrichedItem<T[K][number], Methods>[] }

      // Initialize result arrays for each key
      for (const key of Object.keys(data) as (keyof T)[]) {
        result[key] = [] as unknown as EnrichedItem<T[typeof key][number], Methods>[]
      }

      // Ensure cache and rpcClient are available (should be set by start())
      if (!cache || !rpcClient) {
        throw new Error('rpcEnricher: cache or rpcClient not initialized. Was start() called?')
      }

      // Collect all items with their original positions to preserve order
      type ItemInfo = {
        key: keyof T
        index: number
        item: T[keyof T][number]
        address: string | null
        blockNum: number | null // Only used when callOnEventBlock is true
        cacheKey: string | null // address:methods or address:block:methods depending on mode
      }
      const allItems: ItemInfo[] = []
      const cacheKeySet = new Set<string>()

      for (const key of Object.keys(data) as (keyof T)[]) {
        const items = data[key]

        for (let index = 0; index < items.length; index++) {
          const item = items[index]
          const rawAddress = getNestedValue(item, String(addressField)) as string | undefined

          if (rawAddress) {
            const normalizedAddress = rawAddress.toLowerCase()

            // Extract block number from item.block.number when callOnEventBlock is enabled
            let blockNum: number | null = null
            let cacheKey: string

            if (callOnEventBlock) {
              const rawBlock = getNestedValue(item, 'block.number') as number | undefined
              if (rawBlock !== undefined) {
                blockNum = rawBlock
                cacheKey = `${normalizedAddress}:${blockNum}:${methodsKey}`
              } else {
                ctx.logger.warn(
                  `callOnEventBlock is enabled but block.number is undefined for address ${normalizedAddress}. ` +
                    `Falling back to 'latest' block for this item.`,
                )
                cacheKey = `${normalizedAddress}:${methodsKey}`
              }
            } else {
              cacheKey = `${normalizedAddress}:${methodsKey}`
            }

            allItems.push({ key, index, item, address: normalizedAddress, blockNum, cacheKey })
            cacheKeySet.add(cacheKey)
          } else {
            allItems.push({ key, index, item, address: null, blockNum: null, cacheKey: null })
          }
        }
      }

      // Warn if some items don't have addresses
      const itemsWithoutAddress = allItems.filter((i) => i.address === null).length
      if (itemsWithoutAddress > 0) {
        ctx.logger.warn(
          `${itemsWithoutAddress} item(s) have no address at field '${String(addressField)}'. ` +
            `These items will have empty contractState.`,
        )
      }

      // Filter out cached entries
      const uncachedKeys = Array.from(cacheKeySet).filter((key) => !cache!.has(key))

      // Fetch uncached data
      let fetchError: Error | null = null
      if (uncachedKeys.length > 0) {
        const span = ctx.profiler.start('RPC multicall')

        try {
          if (callOnEventBlock) {
            // Group by block number for per-event block mode
            const byBlock = new Map<number, string[]>()
            for (const cacheKey of uncachedKeys) {
              const [address, blockStr] = cacheKey.split(':')
              const block = parseInt(blockStr, 10)
              const addresses = byBlock.get(block) || []
              addresses.push(address)
              byBlock.set(block, addresses)
            }

            ctx.logger.debug(`Fetching RPC data for ${uncachedKeys.length} address:block pairs across ${byBlock.size} blocks`)

            // Fetch each block group
            for (const [block, addresses] of byBlock) {
              const blockHex = `0x${block.toString(16)}`
              await fetchAndCacheWithKey(
                rpcClient,
                multicallAddress,
                addresses,
                methods,
                cache,
                batchSize,
                blockHex,
                maxParallelBatches,
                ctx.logger,
                (addr) => `${addr}:${block}:${methodsKey}`, // Cache key includes block and methods
              )
            }
          } else {
            // Standard mode: cache by address and methods, use 'latest' block
            ctx.logger.debug(`Fetching RPC data for ${uncachedKeys.length} addresses`)
            // uncachedKeys already include methodsKey, extract just the addresses
            const addresses = uncachedKeys.map((key) => key.split(':')[0])
            await fetchAndCacheWithKey(
              rpcClient,
              multicallAddress,
              addresses,
              methods,
              cache,
              batchSize,
              'latest',
              maxParallelBatches,
              ctx.logger,
              (addr) => `${addr}:${methodsKey}`, // Cache key includes methods
            )
          }
        } catch (error) {
          ctx.logger.warn(`RPC enricher error: ${error}`)
          fetchError = error as Error
        }

        span.end()
      }

      // Build result in original order
      // Group items by key and sort by original index
      const itemsByKey = new Map<keyof T, ItemInfo[]>()
      for (const itemInfo of allItems) {
        const keyItems = itemsByKey.get(itemInfo.key) || []
        keyItems.push(itemInfo)
        itemsByKey.set(itemInfo.key, keyItems)
      }

      for (const [key, items] of itemsByKey) {
        // Items are already in order since we iterated in order
        for (const { item, cacheKey } of items) {
          // Start with existing contractState from previous enrichers
          const existingContractState = (item as { contractState?: object }).contractState || {}
          let newContractState: ContractStateResult<Methods> = {} as ContractStateResult<Methods>

          if (cacheKey) {
            // Try to get cached data even if there was a fetch error
            // This preserves data for entries that were cached before the error
            const cached = cache.get(cacheKey)
            if (cached !== undefined) {
              newContractState = cached as ContractStateResult<Methods>
            }
          }

          result[key].push({
            ...item,
            // Merge existing contractState with new data
            contractState: { ...existingContractState, ...newContractState } as ContractStateResult<Methods>,
          } as EnrichedItem<T[typeof key][number], Methods>)
        }
      }

      return result
    },
  })
}

async function fetchAndCacheWithKey(
  rpcClient: RpcClient,
  multicallAddress: string,
  addresses: string[],
  methods: readonly AnyAbiFunction[],
  cache: LFUCache<ContractStateResult<readonly AnyAbiFunction[]>>,
  batchSize: number,
  blockTag: string,
  maxParallelBatches: number,
  logger: Logger,
  getCacheKey: (address: string) => string,
): Promise<void> {
  const methodCount = methods.length

  // Guard against zero methods (would cause division issues)
  if (methodCount === 0) {
    return
  }

  // Calculate addresses per batch based on method count
  const addressesPerBatch = Math.max(1, Math.floor(batchSize / methodCount))

  // Split addresses into batches
  const batches: string[][] = []
  for (let i = 0; i < addresses.length; i += addressesPerBatch) {
    batches.push(addresses.slice(i, i + addressesPerBatch))
  }

  // Process batches with controlled parallelism
  // INVARIANT: addresses are deduplicated before batching, so no two batches
  // will write to the same cache key. This makes concurrent cache writes safe.
  for (let i = 0; i < batches.length; i += maxParallelBatches) {
    const parallelBatches = batches.slice(i, i + maxParallelBatches)

    await Promise.all(
      parallelBatches.map((batchAddresses) =>
        processBatch(rpcClient, multicallAddress, batchAddresses, methods, cache, blockTag, logger, getCacheKey),
      ),
    )
  }
}

async function processBatch(
  rpcClient: RpcClient,
  multicallAddress: string,
  batchAddresses: string[],
  methods: readonly AnyAbiFunction[],
  cache: LFUCache<ContractStateResult<readonly AnyAbiFunction[]>>,
  blockTag: string,
  logger: Logger,
  getCacheKey: (address: string) => string,
): Promise<void> {
  const requests: MulticallRequest[] = []

  // Build requests for this batch
  for (const address of batchAddresses) {
    for (const method of methods) {
      requests.push({
        target: address,
        callData: method.encode({}),
        allowFailure: true,
      })
    }
  }

  // Execute multicall
  const results = await rpcClient.multicall(multicallAddress, requests, blockTag)

  // Parse results and update cache
  let resultIdx = 0
  for (const address of batchAddresses) {
    const contractState: Record<string, unknown> = {}

    for (const method of methods) {
      const result = results[resultIdx++]
      const methodName = getFunctionName(method)

      if (result?.success && result.returnData && result.returnData !== '0x') {
        try {
          const decoded = method.decodeResult(result.returnData)
          contractState[methodName] = decoded
        } catch (error) {
          logger.warn(`Failed to decode ${methodName} result for ${address}: ${error}`)
        }
      } else if (result && !result.success) {
        logger.warn(`RPC call failed for ${methodName} on ${address}`)
      }
    }

    cache.set(getCacheKey(address), contractState as ContractStateResult<readonly AnyAbiFunction[]>)
  }
}
