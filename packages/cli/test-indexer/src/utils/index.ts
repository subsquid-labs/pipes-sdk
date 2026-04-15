import type { EventResponse, Events } from '@subsquid/pipes/evm'

export type ExtendEventResponse<ER extends EventResponse<Events, string[]>, Extra extends object> = {
  [K in keyof ER]: ER[K] extends Array<infer E> ? Array<E & Extra> : never
}

export interface EnrichedEventMeta {
  blockNumber: number
  txHash: string
  logIndex: number
  timestamp: number // unix seconds
}

export function enrichEvents<T extends EventResponse<Events, string[]>>(
  obj: T,
): ExtendEventResponse<T, EnrichedEventMeta> {
  const result = {} as ExtendEventResponse<T, EnrichedEventMeta>

  for (const key in obj) {
    const value = obj[key]
    result[key] = (value as any[]).map((v) => ({
      ...v.event,
      blockNumber: v.block.number,
      txHash: v.rawEvent.transactionHash,
      logIndex: v.rawEvent.logIndex,
      timestamp: new Date(v.timestamp).getTime() / 1000,
    })) as ExtendEventResponse<T, EnrichedEventMeta>[typeof key]
  }

  return result
}
