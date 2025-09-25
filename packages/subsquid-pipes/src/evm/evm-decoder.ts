import type { AbiEvent } from '@subsquid/evm-abi'
import {
  createTransformer,
  formatBlock,
  formatNumber,
  PortalRange,
  ProfilerOptions,
  parsePortalRange,
  Transformer,
} from '~/core/index.js'
import { Log } from '../portal-client/query/evm.js'
import { EvmPortalData } from './evm-portal-source.js'
import { EvmQueryBuilder } from './evm-query-builder.js'
import { Factory, FactoryEvent } from './factory.js'

type DecodedEvent<D, C> = {
  event: D
  contract: string
  blockNumber: number
  transactionHash: string
  timestamp: Date
  logIndex: number
  rawEvent: Log<{
    address: true
    topics: true
    data: true
    transactionHash: true
    logIndex: true
    transactionIndex: true
  }>
  // biome-ignore lint/complexity/noBannedTypes: <we extend the type only if C is a Factory>
} & (C extends Factory<infer F> ? { factory: FactoryEvent<F> } : {})

export type Events = Record<string, AbiEvent<any>>

type EventArgs<T extends Events> = {
  readonly [K in keyof T]: T[K] extends AbiEvent<any> ? T[K] : never
}

export type EventResponse<T extends Events, Contracts> = {
  [K in keyof T]: DecodedEvent<ReturnType<T[K]['decode']>, Contracts>[]
}

type Contracts = Factory<any> | string[]

type DecodedEventPipeArgs<T extends Events, C extends Contracts> = {
  range: PortalRange
  contracts?: C
  events: EventArgs<T>
  profiler?: ProfilerOptions
}

const decodedEventFields = {
  block: {
    number: true,
    hash: true,
    timestamp: true,
  },
  transaction: {
    from: true,
    to: true,
    hash: true,
    sighash: true,
  },
  log: {
    address: true,
    topics: true,
    data: true,
    transactionHash: true,
    logIndex: true,
    transactionIndex: true,
  },
} as const

export function createEvmDecoder<T extends Events, C extends Contracts>({
  range,
  contracts,
  events,
  profiler,
}: DecodedEventPipeArgs<T, C>): Transformer<
  EvmPortalData<typeof decodedEventFields>,
  EventResponse<T, C>,
  EvmQueryBuilder
> {
  const eventTopics = Object.values(events).map((event) => event.topic)
  const decodedRange = parsePortalRange(range)

  return createTransformer({
    profiler: profiler || { id: 'evm-decoder' },
    query: async ({ queryBuilder, logger, portal }) => {
      if (!Factory.isFactory(contracts)) {
        queryBuilder.addFields(decodedEventFields).addLog({
          range: decodedRange,
          request: {
            address: contracts,
            topic0: eventTopics,
            transaction: true,
          },
        })
        return
      }

      const preIndexRange = contracts.preIndexRange() //
      if (preIndexRange) {
        await contracts.startPreIndex({
          portal,
          logger: logger.child({ module: 'pre-index' }),
        })

        queryBuilder.addLog({
          range: preIndexRange,
          request: {
            address: [contracts.factoryAddress()],
            topic0: [contracts.factoryTopic()],
          },
        })

        const children = await contracts.getAllContracts()
        const firstRange = { from: decodedRange?.from || 0, to: preIndexRange.to }
        const secondRange = { from: preIndexRange.to + 1, to: decodedRange?.to }

        logger.info(
          [
            `Configuring pre-indexed range ${formatBlock(firstRange.from)} to ${formatNumber(firstRange.to)} using server-side filter with ${children.length} contracts`,
            `And range ${formatNumber(secondRange.from)}${secondRange.to ? ' to ' + formatNumber(secondRange.to || 0) : ''} using client-side filter`,
          ].join('\n'),
        )

        queryBuilder
          .addFields(decodedEventFields)
          .addLog({
            // pre-indexed stage
            range: firstRange,
            request: {
              address: children.map((c) => c.contract), // fill addresses from factory events
              topic0: eventTopics,
              transaction: true,
            },
          })
          .addLog({
            range: secondRange,
            request: {
              topic0: eventTopics,
              transaction: true,
            },
          })

        return
      }

      queryBuilder.addLog({
        range: decodedRange,
        request: {
          address: [contracts.factoryAddress()],
          topic0: [contracts.factoryTopic()],
        },
      })

      queryBuilder.addFields(decodedEventFields).addLog({
        range: decodedRange,
        request: {
          topic0: eventTopics,
          transaction: true,
        },
      })
    },
    transform: async (data, ctx) => {
      const result = {} as EventResponse<T, C>
      for (const eventName in events) {
        ;(result[eventName as keyof T] as ReturnType<T[keyof T]['decode']>[]) = []
      }

      if (Factory.isFactory(contracts)) {
        const span = ctx.profiler.start('factory decode')
        for (const block of data.blocks) {
          if (!block.logs) continue
          for (const log of block.logs) {
            if (Factory.isFactory(contracts) && contracts.isFactoryEvent(log)) {
              contracts.decode(log, block.header.number)
            }
          }
        }
        span.end()
      }

      const span = Factory.isFactory(contracts) ? ctx.profiler.start('child decode') : undefined
      for (const block of data.blocks) {
        if (!block.logs) continue

        for (const log of block.logs) {
          let factoryEvent: FactoryEvent<any> | null = null

          if (Factory.isFactory(contracts)) {
            factoryEvent = await contracts.getContract(log.address)
            if (!factoryEvent) {
              continue
            }
          }

          for (const eventName in events) {
            const eventAbi = events[eventName]
            const topic0 = log.topics[0]

            if (topic0 !== eventAbi.topic) {
              continue
            } else if (!eventAbi.is(log)) {
              continue
            }

            try {
              const decoded = eventAbi.decode(log)
              const eventArray = result[eventName as keyof T] as ReturnType<typeof eventAbi.decode>[]

              eventArray.push({
                event: decoded,
                rawEvent: log,
                factory: factoryEvent,
                contract: log.address,
                blockNumber: block.header.number,
                logIndex: log.logIndex,
                transactionHash: log.transactionHash,
                timestamp: new Date(block.header.timestamp * 1000),
              })
            } catch (error) {
              ctx.logger.warn({
                message: `Failed to decode log for event ${eventName}:`,
                error,
              })
            }
            break
          }
        }
      }
      span?.end()

      if (Factory.isFactory(contracts)) {
        const span = ctx.profiler.start('factory persist')
        await contracts.persist()
        span.end()
      }

      return result
    },
  })
}
