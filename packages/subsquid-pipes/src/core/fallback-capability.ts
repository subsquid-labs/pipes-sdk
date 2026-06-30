import { isForkException } from '~/portal-client/index.js'

import { FallbackUnderlyingSource } from './fallback-source.js'
import { BlockCursor } from './types.js'

export interface CapabilityProbeOptions {
  /** Report not-capable if the probe slice stays outstanding longer than this. Default 30s. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Build a generic `probeCapability` for any {@link FallbackUnderlyingSource}. It pulls a single
 * batch of *exactly the data the source is configured to serve* — the query (fields + request) is
 * baked into the source, so one `read(cursor)` batch re-exercises the whole pipeline (logs, traces,
 * state diffs) — starting just past the indexing frontier, and reports whether the source could
 * serve it.
 *
 * This catches the reachable-but-incapable failures liveness alone misses: an RPC node with the
 * trace/`debug_` API disabled or pruned state at that depth fails the slice, as does a Portal that
 * answers HTTP 400 to a query that passed type-level validation. The supervisor anchors `atCursor`
 * to the frontier, so during a backfill the probe verifies capability *at the depth the source is
 * about to read in bulk*.
 *
 * Capable iff the slice yields a batch or the stream ends without a non-fork error. A
 * `ForkException` counts as capable — the source served data and detected a reorg, a chain event
 * rather than an inability to serve. Any other error, or exceeding `timeoutMs`, reports not-capable.
 *
 * (Unlike the Squid probe, which requests a one-block `{from, to}` slice, the Pipes `read` contract
 * is unbounded — so the probe takes only the first batch and closes the stream.)
 */
export function makeCapabilityProbe<T>(
  source: FallbackUnderlyingSource<T>,
  options: CapabilityProbeOptions = {},
): (atCursor?: BlockCursor) => Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (atCursor?: BlockCursor): Promise<boolean> => {
    const iterator = source.read(atCursor)[Symbol.asyncIterator]()
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      const next = iterator.next()
      next.catch(() => {}) // a late rejection after a timeout must not surface as unhandled
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('capability probe timed out')), timeoutMs)
      })

      // One batch (or a clean stream end) is enough: it proves the source served the slice.
      await Promise.race([next, timeout])

      return true
    } catch (e) {
      return isForkException(e)
    } finally {
      if (timer) clearTimeout(timer)
      // Don't await: closing the probe stream must not block, and a stalled source's `return()`
      // can hang on the same unresolved fetch.
      try {
        iterator.return?.()?.then(
          () => {},
          () => {},
        )
      } catch {
        /* ignore */
      }
    }
  }
}
