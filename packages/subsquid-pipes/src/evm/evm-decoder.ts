import type { AbiEvent, EventParams } from '@subsquid/evm-abi'
import { Codec, Sink } from '@subsquid/evm-codec'
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
import { Log, LogRequest } from '../portal-client/query/evm.js'
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

export type Events = Record<string, AbiEvent<any> | EventWithArgs<AbiEvent<any>>>

export type DecodeEventsFunctions<T extends Events> = ReturnType<ExtractEventType<EventsMap<T>[keyof T]>['decode']>

export type IndexedKeys<T> = {
  [K in keyof T]: T[K] extends { indexed: true } ? K : never
}[keyof T]

type CodecValueType<T> = T extends Codec<any, infer TOut> ? TOut : never

export type IndexedParams<T extends AbiEvent<any>> = {
  [K in IndexedKeys<T['params']>]: CodecValueType<T['params'][K]>
}

export type EventWithArgs<T extends AbiEvent<any>> = {
  event: T
  params: Partial<IndexedParams<T>>
}

export type EventEntryFor<V> =
  // If the entry is an AbiEvent, allow either the raw AbiEvent or the `{ event, params }` form
  V extends AbiEvent<any>
    ? V
    : V extends {
          event: infer E extends AbiEvent<any>
          params: infer P extends Record<PropertyKey, unknown>
        }
      ? // Reject params that include non-indexed keys
        Exclude<keyof P, keyof Partial<IndexedParams<E>>> extends never
        ? {
            event: E
            params: Partial<IndexedParams<E>>
          }
        : never
      : never

export type EventsMap<T> = {
  readonly [K in keyof T]: EventEntryFor<T[K]>
}

export type AbiDecodeEvent<T extends AbiEvent<any>> = ReturnType<T['decode']>

type ExtractEventType<V> = V extends AbiEvent<any> ? V : V extends { event: infer E extends AbiEvent<any> } ? E : never

export type EventResponse<T extends Events, F> = {
  [K in keyof T]: DecodedEvent<
    // child event - extract from EventsMap normalized type
    AbiDecodeEvent<ExtractEventType<EventsMap<T>[K]>>,
    // factory event
    F extends Factory<infer R> ? DecodedAbiEvent<R> : never
  >[]
}

type Contracts = Factory<any> | string[]

export type DecodedEventPipeArgs<T extends Events, C extends Contracts> = {
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

function isEventWithArgs<T extends AbiEvent<any>>(value: unknown): value is EventWithArgs<T> {
  return typeof value === 'object' && value !== null && 'event' in value
}

type LogParamTopics = Pick<LogRequest, 'topic0' | 'topic1' | 'topic2' | 'topic3'>

function buildEventTopics<T extends AbiEvent<any>>(event: T, indexedParams: Partial<IndexedParams<T>>): LogParamTopics {
  const params = event.params as EventParams<T>

  const paramsByTopicOrder: (string[] | undefined)[] = Object.keys(params).map((k) => {
    // TODO: this is being done because `IndexedParams` is not a subset of EventParams
    // and instead a completely different type. Should rework `IndexedParams` to avoid this casting
    const indexedParam = (indexedParams as EventParams<T>)[k]
    if (!indexedParam) return

    const eventParams = params[k] as Codec<any, any>
    const sink = new Sink(1)
    eventParams['encode'](sink, indexedParam)

    // TODO: need to consider that a param can take an array of values
    return [sink.toString()]
  })

  return {
    topic0: [event.topic],
    topic1: paramsByTopicOrder[0],
    topic2: paramsByTopicOrder[1],
    topic3: paramsByTopicOrder[2],
  }
}

function getNormalizeEvents<T extends Events>(events: T) {
  const normalizedEvents: EventWithArgs<
    T[keyof T] extends EventWithArgs<AbiEvent<any>> ? T[keyof T]['event'] : AbiEvent<any>
  >[] = []

  for (const eventName in events) {
    const event = events[eventName]

    if (isEventWithArgs(event)) {
      normalizedEvents.push(event)
    } else {
      normalizedEvents.push({
        event,
        params: {},
      } as EventWithArgs<AbiEvent<any>>)
    }
  }

  return normalizedEvents
}

function splitEvents<T extends AbiEvent<any>>(normalizedEvents: EventWithArgs<T>[]) {
  return {
    eventsWithoutParams: normalizedEvents.filter((event) => Object.keys(event.params).length === 0),
    eventsWithParams: normalizedEvents.filter((event) => Object.keys(event.params).length > 0),
  }
}

function buildEventRequests<T extends AbiEvent<any>, C extends Contracts>(
  eventWithParams: EventWithArgs<T>[],
  contracts?: C,
) {
  return eventWithParams
    .map<LogRequest | undefined>((event) => {
      // TODO: not sure how we should treat factories in this case. Need to figure out
      if (Factory.isFactory(contracts)) return

      const topics = buildEventTopics(event.event, event.params)
      return {
        ...topics,
        address: contracts,
        transaction: true,
      }
    })
    .filter((logRequest): logRequest is LogRequest => !!logRequest)
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
  const normalizedEvents = getNormalizeEvents(events)
  const { eventsWithParams, eventsWithoutParams } = splitEvents(normalizedEvents)
  const eventTopic0 = eventsWithoutParams.map((event) => event.event.topic)
  const eventWithParamsRequest = buildEventRequests(eventsWithParams, contracts)
  const decodedRange = parsePortalRange(range)

  return createTransformer({
    profiler: profiler || { id: 'EVM decoder' },
    query: async ({ queryBuilder, logger, portal }) => {
      const allEventTopics = normalizedEvents.map(({ event }) => event.topic)
      const duplicates = findDuplicates(allEventTopics)
      if (duplicates.length) {
        const entries = Object.entries(normalizedEvents)
        logger.error(
          DUPLICATED_EVENTS(
            duplicates.map((duplicate) => {
              const props = entries.filter(([, event]) => event.event.topic === duplicate).map(([name]) => name)
              return { props, event: duplicate }
            }),
          ),
        )
      }

      if (!Factory.isFactory(contracts)) {
        queryBuilder.addFields(decodedEventFields)

        if (eventsWithoutParams.length > 0)
          queryBuilder.addLog({
            range: decodedRange,
            request: {
              address: contracts,
              topic0: eventTopic0,
              transaction: true,
            },
          })

        for (const request of eventWithParamsRequest) {
          queryBuilder.addLog({
            range: decodedRange,
            request,
          })
        }

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

        // TODO: we should conditionally add the fields based on the events without params
        queryBuilder
          .addFields(decodedEventFields)
          .addLog({
            // pre-indexed stage
            range: firstRange,
            request: {
              address: children.map((c) => c.childAddress), // fill addresses from factory events
              topic0: eventTopic0,
              transaction: true,
            },
          })
          .addLog({
            range: secondRange,
            request: {
              topic0: eventTopic0,
              transaction: true,
            },
          })

        for (const request of eventWithParamsRequest) {
          queryBuilder.addLog({
            range: decodedRange,
            request,
          })
        }

        return
      }

      queryBuilder.addLog({
        range: decodedRange,
        request: {
          address: contracts.factoryAddress(),
          topic0: [contracts.factoryTopic()],
        },
      })

      queryBuilder.addFields(decodedEventFields)

      if (eventsWithoutParams.length > 0) {
        queryBuilder.addLog({
          range: decodedRange,
          request: {
            topic0: eventTopic0,
            transaction: true,
          },
        })
      }

      for (const request of eventWithParamsRequest) {
        queryBuilder.addLog({
          range: decodedRange,
          request,
        })
      }
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
      // TODO: should use normalizedEvents instead of events here
      for (const eventName in events) {
        ;(result[eventName as keyof T] as DecodeEventsFunctions<T>[]) = []
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
            const eventValue = events[eventName]
            let eventAbi: AbiEvent<any>

            if (isEventWithArgs(eventValue)) {
              eventAbi = eventValue.event
            } else {
              eventAbi = eventValue
            }

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
