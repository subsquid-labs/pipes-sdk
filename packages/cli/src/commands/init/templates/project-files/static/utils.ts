export const snakeCaseUtilsTemplate = `export type SnakeCase<S extends string> =
  S extends \`\${infer H}\${infer T}\`
    ? \`\${H extends Lowercase<H> ? H : \`_\${Lowercase<H>}\`}\${SnakeCase<T>}\`
    : S

export type SnakeTopKeys<T> =
  T extends object
    ? { [K in keyof T as K extends string ? SnakeCase<K> : K]: T[K] }
    : T

export const toSnakeKeys = <T extends Record<string, any>>(obj: T): SnakeTopKeys<T> => {
  const toSnake = (k: string) => k.replace(/[A-Z]/g, (m) => \`_\${m.toLowerCase()}\`)
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [toSnake(k), v])) as SnakeTopKeys<T>
}

export const toSnakeKeysArray = <T extends Record<string, any>>(
  obj: T[],
): SnakeTopKeys<T>[] => {
  return obj.map((o) => toSnakeKeys(o))
}

export function serializeJsonWithBigInt(obj: unknown): string {
  return JSON.stringify(obj, (_key, value) =>
    typeof value === 'bigint' ? value.toString() : value,
  )
}
`

export const eventEnricherUtilsTemplate = `
import { type EventResponse, Events } from '@subsquid/pipes/evm'

export type ExtendEventResponse<ER extends EventResponse<Events, string[]>, Extra extends object> = {
  [K in keyof ER]: ER[K] extends Array<infer E> ? Array<E & Extra> : never
}

export interface EnrichedEventMeta {
  blockNumber: number
  txHash: string
  logIndex: number
  timestamp: number // unix seconds
}

export function enrichEvents<T extends EventResponse<Events, string[]>>(obj: T): ExtendEventResponse<T, EnrichedEventMeta> {
  const result = {} as ExtendEventResponse<T, EnrichedEventMeta>
  
  for (const key in obj) {
    const value = obj[key]
    result[key] = (value as any[]).map((v) => ({
      ...v,
      blockNumber: v.block.number,
      txHash: v.rawEvent.transactionHash,
      logIndex: v.rawEvent.logIndex,
      timestamp: new Date(v.timestamp).getTime() / 1000,
    })) as ExtendEventResponse<T, EnrichedEventMeta>[typeof key]
  }

  return result
}
`
