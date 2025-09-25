import { AbiEvent } from '@subsquid/evm-abi'
import type { Codec } from '@subsquid/evm-codec'

import { createTarget, Logger, parsePortalRange } from '~/core/index.js'
import { PortalClient } from '~/portal-client/client.js'
import { createEvmDecoder } from './evm-decoder.js'
import { createEvmPortalSource } from './evm-portal-source.js'

export type EventArgs = {
  [key: string]: Codec<any> & { indexed?: boolean }
}

export interface FactoryPersistentAdapter<T extends { contract: string; blockNumber: number }> {
  all(): Promise<T[]>
  lookup(parameter: string): Promise<T | null>
  save(entities: T[]): Promise<void>
}

export type DecodedAbiEvent<T extends EventArgs> = ReturnType<AbiEvent<T>['decode']>
export type FactoryEvent<T extends EventArgs> = { contract: string; blockNumber: number; event: DecodedAbiEvent<T> }

// TODO FORKS!

export type FactoryOptions<T extends EventArgs> = {
  address: string
  event: AbiEvent<T>
  _experimental_preindex?: { from: number | string; to: number | string }
  parameter: string | ((data: DecodedAbiEvent<T>) => string)
  database: FactoryPersistentAdapter<FactoryEvent<T>>
}

export class Factory<T extends EventArgs> {
  constructor(private options: FactoryOptions<T>) {}

  #batch: FactoryEvent<T>[] = []

  factoryAddress() {
    return this.options.address
  }

  factoryTopic() {
    return this.options.event.topic
  }

  isFactoryEvent(log: any) {
    return this.options.event.is(log)
  }

  async decode(log: any, blockNumber: number) {
    const decoded = this.options.event.decode(log)
    const contract =
      typeof this.options.parameter === 'string'
        ? String(decoded[this.options.parameter])
        : this.options.parameter(decoded)

    this.#batch.push({
      contract,
      blockNumber,
      event: decoded,
    })
  }

  async getContract(address: string): Promise<FactoryEvent<T> | null> {
    const memory = this.#batch.find((b) => b.contract === address)
    if (memory) {
      return memory
    }

    return this.options.database.lookup(address)
  }

  preIndexRange() {
    return this.options._experimental_preindex
      ? (parsePortalRange(this.options._experimental_preindex) as { from: number; to: number })
      : undefined
  }

  async startPreIndex({ logger, portal }: { logger: Logger; portal: PortalClient }) {
    if (!this.options._experimental_preindex) return
    if (!this.options.database) {
      logger.warn('No database provided, skipping pre-index stage')
      return
    }

    logger.info('Starting pre-index stage')

    await createEvmPortalSource({
      portal,
      logger,
    })
      .pipe(
        createEvmDecoder({
          profiler: { id: 'pre-index' },
          contracts: [this.options.address],
          range: parsePortalRange(this.options._experimental_preindex),
          events: {
            factory: this.options.event,
          },
        }),
      )
      .pipeTo(
        createTarget({
          write: async ({ read }) => {
            for await (const { data } of read()) {
              const res: FactoryEvent<T>[] = []

              for (const event of data.factory) {
                res.push({
                  contract: event.contract,
                  blockNumber: event.blockNumber,
                  event: event.event,
                })
              }

              await this.options.database?.save(res)
            }
          },
        }),
      )

    logger.info('Finished pre-index stage')
  }

  async getAllContracts(): Promise<FactoryEvent<T>[]> {
    return this.options.database.all()
  }

  async persist() {
    await this.options.database.save(this.#batch)
    // Flush memory batch
    this.#batch = []
  }

  static isFactory(address: any) {
    return address instanceof Factory
  }
}

export function createFactory<T extends EventArgs>(options: FactoryOptions<T>) {
  return new Factory(options)
}
