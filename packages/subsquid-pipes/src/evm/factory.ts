import { AbiEvent } from '@subsquid/evm-abi'
import type { Codec } from '@subsquid/evm-codec'

import { BlockCursor, createTarget, Logger, PortalRange, parsePortalRange } from '~/core/index.js'
import { arrayify } from '~/internal/array.js'
import { PortalClient } from '~/portal-client/client.js'
import { Log } from '~/portal-client/query/evm.js'
import { evmDecoder, FactoryEvent } from './evm-decoder.js'
import { evmPortalSource } from './evm-portal-source.js'

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
  lookup(parameter: string): Promise<T | null>
  save(entities: T[]): Promise<void>
  remove(blockNumber: number): Promise<void>
  migrate(): Promise<void>
}

export type DecodedAbiEvent<T extends EventArgs> = ReturnType<AbiEvent<T>['decode']>

export type FactoryOptions<T extends EventArgs> = {
  address: string | string[]
  event: AbiEvent<T>
  _experimental_preindex?: { from: number | string; to: number | string }
  parameter: keyof T | ((data: DecodedAbiEvent<T>) => string)
  database:
    | FactoryPersistentAdapter<InternalFactoryEvent<T>>
    | Promise<FactoryPersistentAdapter<InternalFactoryEvent<T>>>
}

export class Factory<T extends EventArgs> {
  #batch: InternalFactoryEvent<T>[] = []
  #db?: FactoryPersistentAdapter<InternalFactoryEvent<T>>
  readonly #addresses: Set<string>

  constructor(private options: FactoryOptions<T>) {
    this.#addresses = new Set(arrayify(this.options.address).map((a) => a.toLowerCase()))
  }

  factoryAddress(): string[] {
    return Array.from(this.#addresses)
  }

  factoryTopic() {
    return this.options.event.topic
  }

  isFactoryEvent(log: any) {
    return this.options.event.is(log)
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
    const decoded = this.options.event.decode(log)
    const contract =
      typeof this.options.parameter === 'function'
        ? this.options.parameter(decoded)
        : String(decoded[this.options.parameter])

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

      return this.transform(memory)
    }

    const fromDb = await this.assertDb().lookup(address)
    if (!fromDb) return null
    else if (!this.#addresses.has(fromDb.factoryAddress)) return null

    return this.transform(fromDb)
  }

  private transform(event: InternalFactoryEvent<T>): FactoryEvent<DecodedAbiEvent<T>> {
    return {
      contract: event.factoryAddress,
      blockNumber: event.blockNumber,
      event: event.event,
    }
  }

  preIndexRange() {
    return this.options._experimental_preindex
      ? (parsePortalRange(this.options._experimental_preindex) as { from: number; to: number })
      : undefined
  }

  async startPreIndex({
    name,
    logger,
    portal,
    range,
  }: {
    name: string
    range: PortalRange
    logger: Logger
    portal: PortalClient
  }) {
    logger.info(`Starting ${name}`)

    await evmPortalSource({
      portal,
      logger,
    })
      .pipe(
        evmDecoder({
          profiler: { id: name },
          contracts: this.factoryAddress(),
          range,
          events: {
            factory: this.options.event,
          },
        }),
      )
      .pipeTo(
        createTarget({
          write: async ({ read }) => {
            for await (const { data } of read()) {
              const res: InternalFactoryEvent<T>[] = []

              for (const event of data.factory) {
                const contract =
                  typeof this.options.parameter === 'function'
                    ? this.options.parameter(event.event)
                    : String(event.event[this.options.parameter])

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
            }
          },
        }),
      )

    logger.info(`Finished ${name}`)
  }

  async getAllContracts() {
    return this.assertDb().all()
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

export function factory<T extends EventArgs>(options: FactoryOptions<T>) {
  return new Factory(options)
}
