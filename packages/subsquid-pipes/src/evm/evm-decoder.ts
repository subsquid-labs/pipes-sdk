import type { AbiEvent } from '@subsquid/evm-abi'
import {
  BatchCtx,
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
import { EventArgs, Factory, FactoryEvent } from './factory.js'

export type DecodedEvent<D = object, F = unknown> = {
  event: D
  contract: string
  blockNumber: number
  timestamp: Date
  factory?: F extends EventArgs ? FactoryEvent<F> : never
  rawEvent: Log<{
    address: true
    topics: true
    data: true
    transactionHash: true
    logIndex: true
    transactionIndex: true
  }>
}

export type Events = Record<string, AbiEvent<any>>

type EventsMap<T extends Events> = {
  readonly [K in keyof T]: T[K] extends AbiEvent<any> ? T[K] : never
}

export type EventResponse<T extends Events, Factory> = {
  [K in keyof T]: DecodedEvent<ReturnType<T[K]['decode']>, Factory>[]
}

type Contracts = Factory<any> | string[]

type DecodedEventPipeArgs<T extends Events, C extends Contracts> = {
  range: PortalRange
  contracts?: C
  events: EventsMap<T>
  profiler?: ProfilerOptions
  onError?: (ctx: BatchCtx, error: any) => unknown | Promise<unknown>
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
  onError,
}: DecodedEventPipeArgs<T, C>): Transformer<
  EvmPortalData<typeof decodedEventFields>,
  EventResponse<T, C extends Factory<infer F> ? F : never>,
  EvmQueryBuilder
> {
  const eventTopics = Object.values(events).map((event) => event.topic)
  const decodedRange = parsePortalRange(range)

  return new Transformer({
    profiler: profiler || { id: 'EVM decoder' },
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
          logger: logger.child({ module: 'pre index' }),
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
      const result = {} as EventResponse<T, C extends Factory<infer F> ? F : never>
      for (const eventName in events) {
        ;(result[eventName as keyof T] as ReturnType<T[keyof T]['decode']>[]) = []
      }

      if (Factory.isFactory(contracts)) {
        const span = ctx.profiler.start('factory event decode')
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

      const span = Factory.isFactory(contracts) ? ctx.profiler.start('child events decode') : undefined
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
                contract: log.address,
                rawEvent: log,
                blockNumber: block.header.number,
                factory: factoryEvent,
                timestamp: new Date(block.header.timestamp * 1000),
              })
            } catch (error) {
              if (onError) {
                await onError(ctx, error)
              }

              throw error
            }
            break
          }
        }
      }
      span?.end()

      if (Factory.isFactory(contracts)) {
        const span = ctx.profiler.start('persist factory state')
        await contracts.persist()
        span.end()
      }

      return result
    },
  })
}
