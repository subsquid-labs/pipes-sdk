import assert from 'assert'
import pThrottle, { ThrottledFunction } from 'p-throttle'
import { inspect } from 'util'
import {
  type Address,
  BaseError,
  createPublicClient,
  erc20Abi,
  getAddress,
  http,
  PublicClient,
  RawContractError,
} from 'viem'
import { createDefaultLogger, type LogLevel, type Logger } from '~/core/logger.js'
import { EvmMulticallAddresses, type EvmNetwork } from './constants.js'
import { LFUCache } from './lfu-cache.js'
import { Token, TokenStore } from './types.js'

const TOKEN_BATCH_LEN = 100;
const MAX_CACHE_SIZE = 2_000_000; // ~ 7MB in memory
const NATIVE_TOKEN = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

export const unknownMetadata = (address: string): Token => ({
  symbol: "UKN",
  name: "Unknown",
  decimals: 18,
  address,
});

type WithMetadata<T, K extends keyof T> = T & {
  [P in K as `${Extract<P, string | number>}Metadata`]:
    | Token
    | undefined;
};

// Extract only keys of T whose values are strings (addresses)
type StringKeys<T> = {
  [K in keyof T]: T[K] extends string ? K : never;
}[keyof T];

export type TokenMetadataOptions = {
  store: TokenStore | Promise<TokenStore>
  rpcPool: string[]
  multicallAddress?: Address
  network?: EvmNetwork
  logger?: Logger | LogLevel
}

export class TokenService {
  #store?: TokenStore
  tokenMetadataCache: LFUCache<Token>
  tokenMetadataLoadErrorCount = new Map<string, number>()
  private multicallAddress?: Address
  private readonly rpcPool: readonly string[]
  private readonly logger: Logger
  private readContractPool: ThrottledFunction<PublicClient['readContract']>[] = []
  private multicallPool: ThrottledFunction<PublicClient['multicall']>[] = []
  private lastRpcUsed = -1

  constructor(private readonly options: TokenMetadataOptions) {
    this.logger = options.logger && typeof options.logger !== 'string'
      ? options.logger
      : createDefaultLogger({ level: options.logger as LogLevel | undefined })
    this.rpcPool = options.rpcPool

    if (options.rpcPool.length === 0) {
      throw new Error('Token metadata service requires at least one RPC endpoint')
    }

    this.multicallAddress = options.multicallAddress ??
      (options.network ? (EvmMulticallAddresses[options.network] as Address | undefined) : undefined)

    const throttle = pThrottle({ limit: 400, interval: 1000 })

    for (const rpc of options.rpcPool) {
      const rpcClient = createPublicClient({
        cacheTime: 100_000,
        batch: {
          multicall: {
            batchSize: 1024,
          },
        },
        transport: http(rpc),
      })

      this.readContractPool.push(throttle(rpcClient.readContract))
      this.multicallPool.push(throttle(rpcClient.multicall))
    }

    this.tokenMetadataCache = new LFUCache<Token>(MAX_CACHE_SIZE)
    this.cacheToken({
      name: 'Ether',
      symbol: 'ETH',
      decimals: 18,
      address: NATIVE_TOKEN,
    })
  }

  private assertStore() {
    if (!this.#store) throw new Error('Store not initialized. Call migrate() first.')
    return this.#store
  }

  private assertMulticall() {
    if (!this.multicallAddress) {
      throw new Error('Multicall address is required (pass multicallAddress or a supported network)')
    }
    return this.multicallAddress
  }

  private readContract(...params: Parameters<PublicClient['readContract']>) {
    this.updateRpcUsed()
    return this.readContractPool[this.lastRpcUsed](params[0])
  }

  private multicall(...params: Parameters<PublicClient['multicall']>) {
    this.updateRpcUsed()
    return this.multicallPool[this.lastRpcUsed](params[0])
  }

  private updateRpcUsed() {
    this.lastRpcUsed = (this.lastRpcUsed + 1) % this.rpcPool.length
  }

  private async withRetry<T>(
    fn: () => Promise<T> | T,
    maxRetries = 3,
    delayMs = 200,
  ): Promise<T> {
    let attempt = 0
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await fn()
      } catch (err) {
        attempt++
        if (attempt > maxRetries) throw err
        this.logger.warn(
          `token metadata operation failed (attempt ${attempt}/${maxRetries}), retrying: ${inspect(
            err,
          )}`,
        )
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs))
        }
      }
    }
  }

  async migrate() {
    this.#store = this.options.store instanceof Promise
      ? await this.options.store
      : this.options.store

    return this.assertStore().migrate()
  }

  public transform<T extends object, K extends StringKeys<T>>(
    key: K | K[],
  ): (objs: T[]) => Promise<WithMetadata<T, K>[]> {
    return async (objs: T[]) => {
      const keys = Array.isArray(key) ? key : [key]
      const tokenAddresses = keys.flatMap((k) => {
        return objs.map((v) => {
          if (typeof v[k] !== 'string')
            throw new Error('The keys of the object must be a valid Ethereum address')

          return v[k]
        })
      })

      const tokenMedata = await this.getTokenInventories(tokenAddresses)

      return objs.map((obj) => {
        const withTokenMedata = { ...obj } as WithMetadata<T, K>

        for (const key of keys) {
          const tokenAddress = obj[key] as string
          assert(!!tokenAddress, 'Missing token address in the params array')

          const metadatKey = `${String(key)}Metadata`
          const metadata = tokenMedata.get(tokenAddress)

          ;(withTokenMedata as Record<string, unknown>)[metadatKey] = metadata
        }
        return withTokenMedata
      })
    }
  }

  async getTokenInventories(addresses: string[]) {
    let uniqueTokens = Array.from(new Set(addresses))

    await this.ensureTokensMetadata(uniqueTokens)

    const metadataMap = new Map<string, Token>()
    uniqueTokens.forEach((addr) => {
      const md = this.tokenMetadataCache.get(addr)
      if (md) metadataMap.set(addr, md)
    })
    return metadataMap
  }

  private async ensureTokensMetadata(uniqueTokens: string[]) {
    const tokensToSearch = uniqueTokens.filter((t) => !this.tokenMetadataCache.has(t))

    if (!tokensToSearch.length) return

    const tokensFromDb = await this.assertStore().get(tokensToSearch)
    Object.values(tokensFromDb).forEach((token) => this.cacheToken(token))

    const missingTokens = tokensToSearch.filter((t) => !this.tokenMetadataCache.has(t))

    for (
      let startIndex = 0;
      startIndex < missingTokens.length;
      startIndex += TOKEN_BATCH_LEN
    ) {
      const unknownTokens = missingTokens.slice(startIndex, startIndex + TOKEN_BATCH_LEN)

      let multicallResults: Record<
        string,
        { decimals: number; symbol: string; name: string }
      > = {}

      let callSuccess = false
      for (let retries = 1; retries <= 3 && !callSuccess; retries++) {
        try {
          multicallResults = await this.executeMulticall(unknownTokens)
          callSuccess = true
        } catch (err) {
          this.logger.error(
            `multicall call error: ${(err as any).shortMessage || (err as any).reason}`,
          )
        }
      }
      const wrongDataTokenAddresses: string[] = []

      if (callSuccess) {
        for (const tokenAddress of unknownTokens) {
          try {
            const res = multicallResults[tokenAddress]
            const newToken = {
              address: tokenAddress,
              decimals: res.decimals,
              symbol: res.symbol,
              name: res.name,
            }
            await this.withRetry(() => this.assertStore().save([newToken]))
            this.cacheToken(newToken)
          } catch (err) {
            this.logger.warn({ err }, 'multicall decode error, will retry')
            wrongDataTokenAddresses.push(tokenAddress)
          }
        }
      } else {
        wrongDataTokenAddresses.push(...unknownTokens.map((t) => t))
      }

      if (wrongDataTokenAddresses.length) {
        this.logger.warn(
          `loading decimals/symbol one by one for: ${wrongDataTokenAddresses.join(' ')}`,
        )
        const tokensData = await this.getTokensMetadataRpc(wrongDataTokenAddresses)
        this.logger.warn(
          `one by one load completed, ${
            tokensData.filter((td) => td === undefined).length
          }/${tokensData.length} not loaded`,
        )
        for (let index = 0; index < tokensData.length; index++) {
          const td = tokensData[index]
          if (td) {
            await this.withRetry(() => this.assertStore().save([td]))
            this.cacheToken(td)
          } else {
            const tokenAddress = wrongDataTokenAddresses[index]
            const prevErrors = this.tokenMetadataLoadErrorCount.get(tokenAddress) ?? 0
            if (prevErrors > 10) {
              const unknown = unknownMetadata(tokenAddress)
              await this.withRetry(() => this.assertStore().save([unknown]))
              this.cacheToken(unknown)
            } else {
              this.tokenMetadataLoadErrorCount.set(tokenAddress, prevErrors + 1)
            }
          }
        }
      }
    }
  }

  private async executeMulticall(
    tokenAddresses: string[],
  ): Promise<Record<string, { decimals: number; symbol: string; name: string }>> {
    const calls = tokenAddresses
      .map((t) => getAddress(t))
      .flatMap((tokenAddress) => [
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'decimals',
        },
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'symbol',
        },
        {
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'name',
        },
      ])

    const returnData = await this.multicall({
      contracts: calls,
      multicallAddress: this.assertMulticall(),
    })
    const results: Record<string, { decimals: number; symbol: string; name: string }> = {}

    const callsPerToken = calls.length / tokenAddresses.length

    tokenAddresses.forEach((address, index) => {
      const decimalsData = returnData[index * callsPerToken] as { result: number }
      const symbolData = returnData[index * callsPerToken + 1] as { result: string }
      const nameData = returnData[index * callsPerToken + 2] as { result: string }
      results[address] = {
        decimals: (decimalsData.result as number) ?? 18,
        symbol: (symbolData.result as string) ?? '',
        name: (nameData.result as string) ?? '',
      }
    })

    return results
  }

  private async getTokensMetadataRpc(
    tokenAddresses: string[],
  ): Promise<(Token | undefined)[]> {
    const res = tokenAddresses.map(async (token) => {
      try {
        const [decimalsPromise, symbolPromise, namePromise] = (await Promise.allSettled([
          this.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: 'decimals',
          }),
          this.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: 'symbol',
          }),
          this.readContract({
            address: token as Address,
            abi: erc20Abi,
            functionName: 'name',
          }),
        ])) as [
          PromiseSettledResult<number | bigint>,
          PromiseSettledResult<string>,
          PromiseSettledResult<string>,
        ]

        const isMissingField = (rej: PromiseRejectedResult) =>
          this.isMissingFieldError(rej.reason)

        if (
          decimalsPromise.status === 'rejected' &&
          !isMissingField(decimalsPromise) &&
          symbolPromise.status === 'rejected' &&
          !isMissingField(symbolPromise) &&
          namePromise.status === 'rejected' &&
          !isMissingField(namePromise)
        ) {
          this.logger.error(
            `getTokensMetadataRpc token ${token} unknown error: decimals: ${inspect(
              decimalsPromise.reason,
            )}, symbol: ${inspect(symbolPromise.reason)}`,
          )
          return undefined
        }
        return {
          address: token,
          decimals:
            decimalsPromise.status === 'fulfilled' ? Number(decimalsPromise.value) : 18,
          symbol: symbolPromise.status === 'fulfilled' ? symbolPromise.value : '',
          name: namePromise.status === 'fulfilled' ? namePromise.value : '',
        } satisfies Token
      } catch (err) {
        this.logger.error(`getTokensMetadataRpc unknown error: ${inspect(err)}`)
        return undefined
      }
    })

    return Promise.all(res)
  }

  private cacheToken(token: Token) {
    this.tokenMetadataCache.set(token.address, token, token.address === NATIVE_TOKEN)
  }

  async enrichEventsWithToken<T>(
    events: T[],
    addressKey: string = 'address',
  ): Promise<(T & Token)[] | T[]> {
    const metadataMap = await this.getTokenInventories(
      events.map((e) => (e as any)[addressKey]),
    )
    return events.map((e) => {
      const addr = (e as any)[addressKey]
      const metadata = metadataMap.get(addr)
      if (metadata) {
        return {
          ...e,
          ...metadata,
        }
      } else {
        return e
      }
    })
  }

  private isMissingFieldError(error: unknown) {
    if (!(error instanceof BaseError)) return false

    let missingField = false
    error.walk((err: unknown) => {
      const baseErr = err as BaseError
      if (
        baseErr instanceof RawContractError &&
        (!baseErr.data || baseErr.data === '0x')
      ) {
        missingField = true
      }
      if (
        'shortMessage' in (baseErr as any) &&
        typeof (baseErr as { shortMessage?: string }).shortMessage === 'string'
      ) {
        const message = (baseErr as { shortMessage: string }).shortMessage.toLowerCase()
        if (message.includes('execution reverted') || message.includes('no data')) {
          missingField = true
        }
      }
      return false
    })

    return missingField
  }
}

/**
 * Creates a TokenMetadata instance to enrich events with ERC20 token metadata (name, symbol, decimals).
 *
 * The TokenMetadata service fetches token information via multicall RPC requests and caches results
 * in a persistent store. It can be used as a pipe transformer to automatically add metadata
 * to decoded events containing token addresses.
 *
 * @param options - Configuration object for the token metadata service
 * @param options.store - Database adapter for caching token metadata. Can be a {@link TokenStore} instance or a Promise that resolves to one
 * @param options.rpcPool - Array of RPC endpoints to use for fetching token metadata
 * @param options.multicallAddress - Optional multicall contract address. If not provided, must specify `network`
 * @param options.network - Optional network name to auto-resolve multicall address (e.g., 'ethereum-mainnet', 'base-mainnet')
 * @param options.logger - Optional logger instance or log level
 * @returns A {@link Token} instance that can be used with `.pipe()` to enrich events
 *
 * @example
 * ```ts
 * const tokenMetadataService = tokenMetadata({
 *   store: createSqliteTokenMetadataStore({ path: './tokens.sqlite' }),
 *   rpcPool: ['https://eth.llamarpc.com'],
 *   network: 'ethereum-mainnet',
 * })
 *
 * await tokenMetadataService.migrate()
 *
 * const stream = evmPortalSource({ portal })
 *   .pipe(evmDecoder({ range, events: { transfers: erc20.Transfer } }))
 *   .pipe((d) => d.transfers)
 *   .pipe(tokenMetadataService.transform('contract'))
 * ```
 */
export function tokenMetadata(options: TokenMetadataOptions) {
  return new TokenService(options)
}

export {
  ClickHouseTokenMetadataStore,
  SqliteTokenMetadataStore,
} from './stores/index.js'
export type { TokenStore } from './types.js'

