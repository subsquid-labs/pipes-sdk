import pino from 'pino'

import { Transformer } from '~/core/transformer.js'

import { Profiler } from './profiling.js'

import Logger = pino.Logger

export type BlockCursor = {
  number: number
  hash?: string
  timestamp?: number
}

export type Ctx = { logger: Logger; profiler: Profiler }

type ClassOutput<T> = T extends Transformer<any, infer O> ? O : never
type StreamsOutput<T> = { [K in keyof T]: ClassOutput<T[K]> }
type FunctionOutput<T> = T extends (...args: any) => Transformer<any, infer O> ? O : never

export type output<T> =
  T extends Record<string, Transformer<any, any>>
    ? StreamsOutput<T>
    : T extends (...args: any) => any
      ? FunctionOutput<T>
      : ClassOutput<T>

export type Subset<T, Shape> = T extends object
  ? Shape extends object
    ? T &
        Record<Exclude<keyof T, keyof Shape>, never> & {
          [K in keyof T & keyof Shape]: Subset<T[K], Shape[K]>
        }
    : never
  : T
