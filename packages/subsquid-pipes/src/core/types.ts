import pino from 'pino'

import Logger = pino.Logger

import { Decoder } from '~/core/decoder.js'
import { Transformer } from '~/core/transformer.js'

import { Profiler } from './profiling.js'

export type BlockCursor = {
  number: number
  hash?: string
  timestamp?: number
}

export type Ctx = { logger: Logger; profiler: Profiler }

export type PipeOutputType<T> = T extends (...args: any) => infer R
  ? // a function returning transformer
    R extends Decoder<any, infer O, any>
    ? O
    : // a function returning decoder
      R extends Transformer<any, infer O>
      ? O
      : never
  : // simple decoder
    T extends Decoder<any, infer O, any>
    ? O
    : // simple transformer
      T extends Transformer<any, infer O>
      ? O
      : never
