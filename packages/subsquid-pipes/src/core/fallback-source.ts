import { isForkException } from '~/portal-client/index.js'

import { ForkCursorMissingError, ForkNoPreviousBlocksError, TargetForkNotSupportedError } from './errors.js'
import {
  AllSourcesDownError,
  FallbackHealth,
  FallbackPolicy,
  ResolvedFallbackPolicy,
  Selector,
  SourceHealth,
  resolveFallbackPolicy,
} from './fallback-health.js'
import { FinalizedWatermark } from './finalized-watermark.js'
import { Logger, createDefaultLogger } from './logger.js'
import { PortalBatch } from './portal-source.js'
import { Target, TargetState } from './target.js'
import { BlockCursor } from './types.js'

/**
 * One ranked underlying source. `read(cursor)` must yield `PortalBatch`es starting just after
 * `cursor` and throw a `ForkException` when the chain diverges at the resume point — exactly the
 * contract `PortalSource` already satisfies, so a Portal stream (or, later, an RPC stream) drops
 * straight in.
 */
export interface FallbackUnderlyingSource<T> {
  name: string
  read: (cursor?: BlockCursor) => AsyncIterable<PortalBatch<T>>
  /** Full, infrequent capability probe — verifies the source can still serve the query. */
  probeCapability?: () => Promise<boolean>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A structured snapshot of the fallback's observable state, for a metrics surface (§4). */
export interface FallbackMetrics {
  activeIndex: number | undefined
  switchCount: number
  sources: { name: string; health: FallbackHealth; active: boolean }[]
}

/**
 * A meta-source over an ordered list of sources. It drives the lowest-index healthy (or
 * optimistically `unknown`) source and, on a non-fork error, resumes the next source from the
 * last committed cursor. A `ForkException` is propagated untouched so a fork straddling a switch
 * is handled by the same `pipeTo` rewind path as an ordinary reorg.
 *
 * Like `PortalSource`, it owns the single monotonic finalized high-watermark for the pipe (the
 * targets no longer do): it seeds the floor from the target's persisted finalized head and clamps
 * every batch's finalized head through it before yielding. This is what makes a source *switch*
 * safe — a new source reporting a deeper/transiently-missing finalized head can never un-finalize
 * already-committed data.
 *
 * Drop-in for a `PortalSource`: it exposes the same `AsyncIterable<PortalBatch<T>>` + `pipeTo`.
 */
export class FallbackSource<T> {
  readonly #sources: FallbackUnderlyingSource<T>[]
  readonly #policy: ResolvedFallbackPolicy
  readonly #health: SourceHealth[]
  readonly #selector: Selector
  readonly #logger: Logger
  /** Single monotonic finalized high-watermark for the whole pipe, seeded from the target's floor. */
  readonly #watermark = new FinalizedWatermark()

  /** Observable state (for metrics). */
  activeIndex: number | undefined
  switchCount = 0

  constructor(sources: FallbackUnderlyingSource<T>[], policy?: FallbackPolicy, logger?: Logger) {
    if (sources.length === 0) {
      throw new Error('FallbackSource requires at least one source')
    }
    this.#sources = sources
    this.#policy = resolveFallbackPolicy(policy)
    this.#health = sources.map((s) => new SourceHealth(this.#policy, !!s.probeCapability))
    this.#selector = new Selector(this.#health)
    this.#logger = logger ?? createDefaultLogger({ id: 'fallback' })
  }

  /** The supervisor: switches sources internally; only `ForkException` (and completion) escape. */
  async *read(cursor?: BlockCursor): AsyncIterable<PortalBatch<T>> {
    let last = cursor
    let allDownSince: number | undefined

    while (true) {
      const active = this.#selector.pickForFailover()
      if (active === undefined) {
        if (await this.#waitAllDown(allDownSince ?? (allDownSince = this.#policy.clock()))) continue

        throw new AllSourcesDownError()
      }
      allDownSince = undefined
      this.#setActive(active)

      let switchedUp = false
      try {
        for await (const batch of this.#sources[active].read(last)) {
          this.#health[active].onBatch()

          // Clamp the source's finalized head through the shared monotonic watermark before it
          // reaches the target, so a source switch reporting a deeper/transiently-missing finalized
          // head can never un-finalize already-committed data. (The rollback chain is left as the
          // source derived it; the clamp can only raise the head, so the chain stays a safe superset
          // of the unfinalized tail.)
          batch.ctx.stream.head.finalized = this.#watermark.clamp(batch.ctx.stream.head.finalized)

          yield batch
          last = batch.ctx.stream.state.current

          if (this.#policy.preferPrimary === 'eager' && this.#selector.pickSwitchUp(active) !== undefined) {
            switchedUp = true
            break
          }
        }

        if (!switchedUp) return // source completed (bounded stream)
      } catch (e) {
        if (isForkException(e)) throw e // propagate; do NOT switch

        this.#health[active].onStreamError()
        // re-select and resume from `last` on the next iteration
      }
    }
  }

  pipeTo(target: Target<T>): Promise<void> {
    const self = this

    return target.write({
      logger: this.#logger,
      read: async function* (state?: TargetState) {
        // Seed the monotonic floor from the target's persisted finalized head so the watermark
        // survives an unclean restart mid-fork (null ⇒ no floor ⇒ no-finality passthrough). The
        // floor then persists in `self.#watermark` across fork re-invocations below.
        self.#watermark.seed(state?.finalized ?? undefined)

        let cursor = state?.latest
        while (true) {
          try {
            for await (const batch of self.read(cursor)) {
              yield batch
            }

            return
          } catch (e) {
            if (!isForkException(e)) throw e

            if (!e.previousBlocks.length) {
              throw new ForkNoPreviousBlocksError()
            }
            if (!target.fork) {
              throw new TargetForkNotSupportedError()
            }

            const forked = await target.fork(e.previousBlocks)
            if (!forked) {
              throw new ForkCursorMissingError()
            }

            cursor = forked
          }
        }
      },
    })
  }

  async *[Symbol.asyncIterator](): AsyncIterator<PortalBatch<T>> {
    yield* this.read()
  }

  /** Returns true if it waited (retry), false if the all-down timeout elapsed. */
  async #waitAllDown(since: number): Promise<boolean> {
    if (this.#policy.allDownTimeoutMs != null && this.#policy.clock() - since >= this.#policy.allDownTimeoutMs) {
      return false
    }
    await sleep(this.#policy.allDownPollMs)

    return true
  }

  #setActive(i: number): void {
    if (this.activeIndex !== i) {
      if (this.activeIndex !== undefined) this.switchCount++
      this.activeIndex = i
    }
  }

  /** Snapshot of the observable state for export to a metrics surface (§4). */
  metrics(): FallbackMetrics {
    return {
      activeIndex: this.activeIndex,
      switchCount: this.switchCount,
      sources: this.#sources.map((s, i) => ({
        name: s.name,
        health: this.#health[i].state,
        active: this.activeIndex === i,
      })),
    }
  }
}
