import pino from 'pino'
import { Profiler } from './profiling'

import Logger = pino.Logger

export type BlockCursor = {
  number: number
  hash?: string
  timestamp?: number
}

export type Ctx = { logger: Logger; profiler: Profiler }
