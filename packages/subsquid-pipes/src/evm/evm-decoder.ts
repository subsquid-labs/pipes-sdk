import type { AbiEvent } from '@subsquid/evm-abi'
import {
  BatchCtx,
  createTransformer,
  formatBlock,
  formatNumber,
  formatWarning,
  PortalRange,
  ProfilerOptions,
  parsePortalRange,
  Transformer,
} from '~/core/index.js'
import { findDuplicates } from '~/internal/array.js'
import { Log } from '../portal-client/query/evm.js'
import { EvmPortalData } from './evm-portal-source.js'
import { EvmQueryBuilder } from './evm-query-builder.js'
import { DecodedAbiEvent, Factory } from './factory.js'

export type FactoryEvent<T> = {
  contract: string
  blockNumber: number
  event: T
}

export type DecodedEvent<D = object, F = unknown> = {
  event: D
  contract: string
  block: {
    number: number
    hash: string
  }
  timestamp: Date
  factory?: F extends object ? FactoryEvent<F> : never
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

export type AbiDecodeEvent<T extends AbiEvent<any>> = ReturnType<T['decode']>

export type EventResponse<T extends Events, F> = {
  [K in keyof T]: DecodedEvent<
    // child event
    AbiDecodeEvent<T[K]>,
    // factory event
    F extends Factory<infer R> ? DecodedAbiEvent<R> : never
  >[]
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

const DUPLICATED_EVENTS = (duplicates: { props: string[]; event: string }[]) => {
  const events = duplicates
    .map((d) =>
      `
Topic:      ${d.event}
Properties: ${d.props.join(', ')}

${d.props.slice(1).join(', ')} property will miss events due to the duplicate signature.
`.trim(),
    )
    .join('-----\n')

  return formatWarning({
    title: 'Duplicate event topics detected',
    content: [
      events,
      '', // empty line
      `Ensure each event has a unique signature to avoid decoding issues.`,
    ],
  })
}

export function evmDecoder<T extends Events, C extends Contracts>({
  range,
  contracts,
  events,
  profiler,
  onError,
}: DecodedEventPipeArgs<T, C>): Transformer<
  EvmPortalData<typeof decodedEventFields>,
  EventResponse<T, C>,
  EvmQueryBuilder
> {
  const eventTopics = Object.values(events).map((event) => event.topic)

  const decodedRange = parsePortalRange(range)

  return createTransformer({
    profiler: profiler || { id: 'EVM decoder' },
    query: async ({ queryBuilder, logger, portal }) => {
      const duplicates = findDuplicates(eventTopics)
      if (duplicates.length) {
        const entries = Object.entries(events)
        logger.error(
          DUPLICATED_EVENTS(
            duplicates.map((duplicate) => {
              const props = entries.filter(([, event]) => event.topic === duplicate).map(([name]) => name)
              return { props, event: duplicate }
            }),
          ),
        )
      }

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

      const preIndexRange = contracts.preIndexRange()
      if (preIndexRange) {
        await contracts.migrate()
        await contracts.startPreIndex({
          name: 'EVM decoder factory pre-index',
          range: preIndexRange,
          portal,
          logger,
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
              address: children.map((c) => c.childAddress), // fill addresses from factory events
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
          address: contracts.factoryAddress(),
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
    start: async ({ logger }) => {
      if (Factory.isFactory(contracts)) {
        logger.debug('Running factory migrations')
        await contracts.migrate()

        logger.debug('Finished factory migrations')
      }
    },
    transform: async (data, ctx) => {
      const result = {} as EventResponse<T, C>
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
                block: {
                  number: block.header.number,
                  hash: block.header.hash,
                },
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
    fork(cursor) {
      if (!Factory.isFactory(contracts)) return

      return contracts.fork(cursor)
    },
  })
}

/**
 *  @deprecated use `evmDecoder` instead
 */
export const createEvmDecoder = evmDecoder
