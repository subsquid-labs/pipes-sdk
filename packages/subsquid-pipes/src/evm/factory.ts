import { AbiEvent } from '@subsquid/evm-abi'
import type { Codec } from '@subsquid/evm-codec'

import { BlockCursor, Logger, createTarget, formatWarning } from '~/core/index.js'
import { ProgressTrackerOptions, formatProgressMessage } from '~/core/progress-tracker.js'
import { Range } from '~/core/query-builder.js'
import { HttpError } from '~/http-client/index.js'
import { arrayify } from '~/internal/array.js'
import { sha256Hex } from '~/internal/hash.js'
import { jsonStringify } from '~/internal/json.js'
import { PortalClient } from '~/portal-client/client.js'
import { Log, LogRequest } from '~/portal-client/query/evm.js'

import {
  EventWithArgs,
  EventWithArgsInput,
  FactoryEvent,
  IndexedParams,
  buildEventTopics,
  evmDecoder,
  getNormalizedEventParams,
  isEventWithArgs,
} from './evm-decoder.js'
import { evmPortalStream } from './evm-portal-source.js'

export type EventArgs = {
  [key: string]: Codec<any> & { indexed?: boolean }
}

/** @internal */
export type InternalFactoryEvent<T extends EventArgs> = {
  childAddress: string
  factoryAddress: string
  blockNumber: number
  transactionIndex: number
  logIndex: number
  event: DecodedAbiEvent<T>
}

export interface FactoryPersistentAdapter<T extends InternalFactoryEvent<any>> {
  all(): Promise<T[]>
  all(params: IndexedParams<AbiEvent<any>>): Promise<T[]>
  lookup(parameter: string): Promise<T | null>
  save(entities: T[]): Promise<void>
  remove(blockNumber: number): Promise<void>
  migrate(): Promise<void>
  /**
   * Optional: block range for which factory-creation events have been fully pre-indexed,
   * keyed by a factory-config hash. Adapters that don't implement these degrade to
   * re-scanning the full range on every start (safe — saving children is idempotent).
   */
  getPreindexedRange?(key: string): Promise<Range | null>
  setPreindexedRange?(key: string, range: Range): Promise<void>
}

export type DecodedAbiEvent<T extends EventArgs> = ReturnType<AbiEvent<T>['decode']>

export type PreindexOptions = {
  /**
   * Max number of child addresses inlined into the historical server-side filter.
   * Above this threshold the decoder logs a warning and falls back to a wildcard
   * (topic-only) query for the whole range.
   *
   * The address list is embedded into every portal stream request, so a large filter
   * inflates each request body (~50 bytes per address) — keep it well below the
   * portal's request-size limits.
   *
   * @default 5_000
   */
  maxAddressFilterSize?: number
}

export const DEFAULT_PREINDEX_MAX_ADDRESS_FILTER_SIZE = 5_000

/** @internal */
export const TOO_MANY_CHILDREN = (count: number, max: number) => {
  return formatWarning({
    title: `Factory has ${count} child contracts (more than ${max})`,
    content: [
      'The pre-indexed address list is too large for a server-side filter.',
      'Falling back to a wildcard (topic-only) query for the whole range.',
      'Raise `preindex.maxAddressFilterSize` to force the server-side filter — the scan resumes where it stopped.',
    ],
  })
}

export type ContractFactoryOptions<T extends EventArgs> = {
  address: string | string[]
  event: AbiEvent<T> | EventWithArgsInput<AbiEvent<T>>
  childAddressField: keyof T | ((data: DecodedAbiEvent<T>) => string | null)
  /**
   * It is safe to use `any` here because the FactoryPersistentAdapter generic argument
   * will be inferred in the constructor of `Factory`
   */
  database:
    | FactoryPersistentAdapter<InternalFactoryEvent<any>>
    | Promise<FactoryPersistentAdapter<InternalFactoryEvent<any>>>
  /**
   * Runs an explicit pre-indexing phase before the main loop starts:
   * all factory-creation events up to the finalized head are scanned first and the
   * discovered child addresses are persisted to the factory database. The main loop then
   * streams child events with a server-side address filter for the pre-indexed range
   * (fast backfill) and falls back to a wildcard (topic-only) query above it.
   *
   * Progress is persisted, so a completed (or interrupted) pre-index run is reused on
   * restart — only the gap up to the current finalized head is re-scanned.
   *
   * Note: with a {@link PortalCache}, the historical query embeds the discovered address
   * list, so the cache bucket changes whenever the child set grows.
   */
  preindex?: boolean | PreindexOptions
}

export class Factory<T extends EventArgs> {
  #batch: InternalFactoryEvent<T>[] = []
  #db?: FactoryPersistentAdapter<InternalFactoryEvent<T>>
  #preindexRun?: Promise<number | null>
  readonly #addresses: Set<string>
  readonly #event: AbiEvent<T>
  readonly #params: IndexedParams<AbiEvent<T>>

  constructor(private options: ContractFactoryOptions<T>) {
    this.#addresses = new Set(arrayify(this.options.address).map((a) => a.toLowerCase()))

    if (isEventWithArgs(this.options.event)) {
      this.#event = this.options.event.event
      this.#params = getNormalizedEventParams(this.options.event.params)
    } else {
      this.#event = this.options.event
      this.#params = {}
    }
  }

  factoryAddress(): string[] {
    return Array.from(this.#addresses)
  }

  factoryTopic() {
    return this.#event.topic
  }

  factoryEventParams(): IndexedParams<AbiEvent<T>> {
    return this.#params
  }

  factoryEvent(): AbiEvent<T> {
    return this.#event
  }

  buildFactoryEventRequest(): LogRequest {
    const params = this.factoryEventParams()
    const hasParams = Object.keys(params).length > 0

    if (!hasParams) {
      return {
        address: this.factoryAddress(),
        topic0: [this.factoryTopic()],
      }
    }

    const topics = buildEventTopics(this.#event, params)
    return {
      address: this.factoryAddress(),
      ...topics,
    }
  }

  isFactoryEvent(log: any) {
    return this.#event.is(log)
  }

  private assertDb() {
    if (!this.#db) throw new Error('Database not initialized. Call migrate() first.')

    return this.#db
  }

  async migrate() {
    this.#db = this.options.database instanceof Promise ? await this.options.database : this.options.database

    return this.assertDb().migrate()
  }

  async decode(log: Log, blockNumber: number) {
    const decoded = this.#event.decode(log)
    const contract =
      typeof this.options.childAddressField === 'function'
        ? this.options.childAddressField(decoded)
        : String(decoded[this.options.childAddressField])

    if (!contract) return

    this.#batch.push({
      childAddress: contract,
      factoryAddress: log.address,
      blockNumber,
      transactionIndex: log.transactionIndex,
      logIndex: log.logIndex,
      event: decoded,
    })
  }

  async getContract(address: string): Promise<FactoryEvent<DecodedAbiEvent<T>> | null> {
    const memory = this.#batch.find((b) => b.childAddress === address)
    if (memory) {
      if (!this.#addresses.has(memory.factoryAddress)) return null
      if (!this.matchesParams(memory.event)) return null

      return this.transform(memory)
    }

    const fromDb = await this.assertDb().lookup(address)
    if (!fromDb) return null
    else if (!this.#addresses.has(fromDb.factoryAddress)) return null
    else if (!this.matchesParams(fromDb.event)) return null

    return this.transform(fromDb)
  }

  private transform(event: InternalFactoryEvent<T>): FactoryEvent<DecodedAbiEvent<T>> {
    return {
      contract: event.factoryAddress,
      blockNumber: event.blockNumber,
      event: event.event,
    }
  }

  private matchesParams(event: DecodedAbiEvent<T>): boolean {
    if (Object.keys(this.#params).length === 0) {
      return true
    }

    for (const [key, values] of Object.entries(this.#params)) {
      // This value is being casted because TS isn't being able to infer the value of expectedValues out of `this.#params`.
      const expectedValues = values as unknown[]
      const eventValue = event[key as keyof T]
      if (!expectedValues.some((ev) => String(ev).toLowerCase() === String(eventValue).toLowerCase())) {
        return false
      }
    }

    return true
  }

  preindexEnabled(): boolean {
    return Boolean(this.options.preindex)
  }

  maxAddressFilterSize(): number {
    const preindex = this.options.preindex
    const size = typeof preindex === 'object' ? preindex.maxAddressFilterSize : undefined

    return size ?? DEFAULT_PREINDEX_MAX_ADDRESS_FILTER_SIZE
  }

  /**
   * Stable hash of the factory configuration (addresses, event topics, indexed params).
   * Keys the persisted pre-index progress so that a config change safely restarts
   * discovery from scratch while reusing the same database file.
   *
   * @internal
   */
  async preindexKey(): Promise<string> {
    return sha256Hex(
      jsonStringify({
        addresses: this.factoryAddress().sort(),
        request: this.buildFactoryEventRequest(),
        params: this.#params,
      }),
    )
  }

  /**
   * All known child addresses of this factory, lowercased and deduplicated.
   * Filters by factory address in memory — a shared database may hold children
   * of other factories, and `all(params)` filters by indexed params only.
   *
   * @internal
   */
  async getChildAddresses(): Promise<string[]> {
    const contracts = await this.getAllContracts()

    const addresses = new Set<string>()
    for (const contract of contracts) {
      if (!this.#addresses.has(contract.factoryAddress)) continue

      addresses.add(contract.childAddress.toLowerCase())
    }

    return Array.from(addresses)
  }

  /**
   * Runs the pre-indexing phase: ensures every factory-creation event in `range`,
   * clamped to the finalized head, has been scanned and its child addresses persisted.
   *
   * Returns the upper bound `W` of the pre-indexed range — the main query can safely
   * use a server-side child-address filter for `[range.from … W]` — or `null` when
   * pre-indexing is disabled or impossible (no finalized head, empty range).
   *
   * @internal
   */
  async ensurePreindexed(args: { portal: PortalClient; logger: Logger; range: Range }): Promise<number | null> {
    if (!this.preindexEnabled()) return null

    // Serialized rather than memoized: a factory shared between decoders never runs two
    // concurrent pre-passes, yet each caller scans against its own range — persisted
    // progress makes an overlapping follow-up run a cheap no-op, while a range extending
    // below the covered one still triggers the re-scan it needs
    const run = (this.#preindexRun ?? Promise.resolve(null)).catch(() => null).then(() => this.runPreindexPhase(args))
    this.#preindexRun = run

    return run
  }

  private async runPreindexPhase({
    portal,
    logger,
    range,
  }: {
    portal: PortalClient
    logger: Logger
    range: Range
  }): Promise<number | null> {
    await this.migrate()

    let finalized: { number: number } | undefined
    try {
      finalized = await portal.getHead({ finalized: true })
    } catch (error) {
      if (error instanceof HttpError && error.response.status === 404) {
        finalized = undefined
      } else {
        throw error
      }
    }

    if (!finalized) {
      logger.warn('factory preindex: the dataset does not expose a finalized head, skipping pre-indexing')

      return null
    }

    const to = Math.min(finalized.number, range.to ?? Infinity)
    if (to < range.from) return null

    const db = this.assertDb()
    if (!db.getPreindexedRange || !db.setPreindexedRange) {
      logger.warn(
        'factory preindex: the database adapter does not persist pre-index progress; the full range will be re-scanned on every start',
      )
    }

    const key = await this.preindexKey()
    const covered = normalizePreindexedRange(await db.getPreindexedRange?.(key))
    const target = { from: range.from, to }

    // With more children than fit into the server-side filter the main query falls back
    // to a wildcard anyway, so scanning ahead of it buys nothing — bail out before the scan
    const max = this.maxAddressFilterSize()
    const discovered = new Set(await this.getChildAddresses())
    if (discovered.size > max) {
      logger.warn(TOO_MANY_CHILDREN(discovered.size, max))

      return null
    }

    const scan = preindexScanRange(target, covered)
    if (!scan) {
      logger.info(`factory preindex: already up to date at block ${to}`)

      return to
    }

    const factories = this.factoryAddress().join(', ')
    const name = `factory preindex ${factories}`
    logger.info(`factory preindex: scanning blocks ${scan.from}…${scan.to} for factory ${factories}`)

    await evmPortalStream({
      id: name,
      portal,
      logger,
      progress: preindexProgressHandlers(),
      outputs: evmDecoder({
        profiler: { name },
        contracts: this.factoryAddress(),
        range: scan,
        events: {
          factory: Object.keys(this.#params).length > 0 ? { event: this.#event, params: this.#params } : this.#event,
        },
      }),
    }).pipeTo(
      createTarget({
        write: async ({ read }) => {
          for await (const { data, ctx } of read()) {
            const res: InternalFactoryEvent<T>[] = []

            for (const event of data.factory) {
              const contract =
                typeof this.options.childAddressField === 'function'
                  ? this.options.childAddressField(event.event)
                  : String(event.event[this.options.childAddressField])

              if (!contract) continue

              res.push({
                childAddress: contract,
                factoryAddress: event.contract,
                blockNumber: event.block.number,
                transactionIndex: event.rawEvent.transactionIndex,
                logIndex: event.rawEvent.logIndex,
                event: event.event,
              })
            }

            await this.assertDb().save(res)

            for (const entity of res) {
              discovered.add(entity.childAddress.toLowerCase())
            }

            // Advance the persisted progress with every batch so an interrupted
            // pre-index run resumes where it left off instead of starting over
            const scanned = { from: scan.from, to: Math.min(ctx.stream.state.current.number, scan.to) }
            await db.setPreindexedRange?.(key, mergePreindexedRanges(scanned, covered))

            // Crossing the cap mid-scan: stop early — the covered range stays honest,
            // and a later run with a raised cap resumes from it
            if (discovered.size > max) {
              return
            }
          }
        },
      }),
    )

    if (discovered.size > max) {
      logger.warn(TOO_MANY_CHILDREN(discovered.size, max))

      return null
    }

    await db.setPreindexedRange?.(key, mergePreindexedRanges(scan, covered))
    logger.info(`factory preindex: finished, blocks ${target.from}…${target.to} covered`)

    return to
  }

  async getAllContracts() {
    return this.assertDb().all(this.#params)
  }

  async persist() {
    await this.assertDb().save(this.#batch)
    // Flush memory batch
    this.#batch = []
  }

  async fork(cursor: BlockCursor) {
    await this.assertDb().remove(cursor.number)
  }

  static isFactory(address: any) {
    return address instanceof Factory
  }
}

/**
 * Progress hooks for the pre-pass stream. The phase announces itself with its own
 * `scanning blocks X…Y` line, so the default `Start indexing…` would read as the main
 * loop starting; progress ticks carry a `factory preindex:` prefix for the same reason.
 *
 * @internal
 */
export function preindexProgressHandlers(): ProgressTrackerOptions {
  return {
    onStart: () => {},
    onProgress: ({ progress, logger }) => {
      if (progress.state.current === 0 && progress.state.last === 0) return

      const msg = formatProgressMessage(progress)
      logger.info({ ...msg, message: `factory preindex: ${msg['message']}` })
    },
  }
}

/** A fully-scanned block range with both boundaries resolved. @internal */
export type PreindexedRange = { from: number; to: number }

function normalizePreindexedRange(range: Range | null | undefined): PreindexedRange | null {
  if (range == null || range.to == null) return null

  return { from: range.from, to: range.to }
}

/**
 * Determines which blocks the pre-index phase still has to scan to make the
 * covered range a superset of `target`. Returns `null` when already covered.
 *
 * @internal
 */
export function preindexScanRange(target: PreindexedRange, covered: PreindexedRange | null): PreindexedRange | null {
  if (!covered) return target

  // History extended below the covered range — re-scan from the new lower bound.
  // Saving children is idempotent and factory-event scans are cheap, so one full
  // pass is preferred over tracking multiple disjoint covered ranges.
  if (target.from < covered.from) return target

  // Upper gap between the covered range and the target
  if (target.to > covered.to) return { from: covered.to + 1, to: target.to }

  return null
}

/**
 * Merges a freshly scanned range into the previously covered one. When the two are
 * disjoint, only the scanned range is kept — a single contiguous range must never
 * claim blocks that were skipped in between.
 *
 * @internal
 */
export function mergePreindexedRanges(scanned: PreindexedRange, covered: PreindexedRange | null): PreindexedRange {
  if (!covered) return scanned

  const contiguous = scanned.from <= covered.to + 1 && covered.from <= scanned.to + 1
  if (!contiguous) return scanned

  return { from: Math.min(scanned.from, covered.from), to: Math.max(scanned.to, covered.to) }
}

/**
 * Creates a Factory instance to track contract creation events and enable decoding events from dynamically created contracts.
 *
 * A Factory pattern is useful when you need to decode events from contracts that are created dynamically
 * by factory contracts (e.g., Uniswap pools created by a factory). The factory tracks creation events,
 * extracts child contract addresses, and stores them in a database for efficient lookup during event decoding.
 *
 * @param options - Configuration object for the factory
 * @param options.address - Factory contract address(es) to monitor for creation events. Can be a single address or an array of addresses
 * @param options.event - The factory event that signals contract creation. Can be:
 *   - An {@link AbiEvent} instance to capture all creation events
 *   - An {@link EventWithArgs} object with `event` and `params` to filter by indexed parameters
 * @param options.childAddressField - Field name or function to extract the child contract address from the decoded factory event.
 *   - If a string, it should be a key from the event's decoded data
 *   - If a function, it receives the decoded event data and should return the contract address or null
 * @param options.database - Database adapter for storing and querying factory events. Can be a {@link FactoryPersistentAdapter} instance or a Promise that resolves to one
 * @returns A {@link Factory} instance that can be used as the `contracts` parameter in {@link evmDecoder}
 *
 * @example
 * ```ts
 * contractFactory({
 *   address: '0x1f98431c8ad98523631ae4a59f267346ea31f984',
 *   event: factoryAbi.PoolCreated,
 *   childAddressField: 'pool',
 *   database: contractFactoryStore({
 *     path: './uniswap3-eth-pools.sqlite',
 *   }),
 * })
 * ```
 *
 */
export function contractFactory<T extends EventArgs>(options: ContractFactoryOptions<T>) {
  return new Factory(options)
}

/** @deprecated Use {@link contractFactory} instead. */
export const factory = contractFactory
