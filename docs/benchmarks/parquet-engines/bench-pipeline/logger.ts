import pino from 'pino'

import type { Logger } from '../../../../packages/pipes/src/core/index.js'

/**
 * Warn-level logger bound to STDERR. run-one's protocol requires stdout to carry exactly one
 * JSON metrics line, so indexer diagnostics (e.g. the event registry's deliberate
 * duplicate-topic warning) must never reach stdout. Synchronous destination so nothing is
 * buffered past process exit.
 */
export function benchLogger(id: string): Logger {
  return pino({ level: 'warn', base: { id }, messageKey: 'message' }, pino.destination({ dest: 2, sync: true }))
}
