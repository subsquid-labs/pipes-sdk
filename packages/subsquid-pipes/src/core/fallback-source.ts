import { isForkException } from '~/portal-client/index.js'

import { ForkCursorMissingError, ForkNoPreviousBlocksError, TargetForkNotSupportedError } from './errors.js'
import type { ProbeResult } from './fallback-capability.js'
import { SourceErrorInfo, classifyError, freshnessFailure } from './fallback-diagnostics.js'
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
  /**
   * Full, infrequent capability probe — verifies the source can still serve the query's data.
   * `atCursor` is the indexing frontier (last committed cursor); the probe should confirm the
   * source can serve the configured data just past it and resolve not-`ok` (with a cause) if it
   * cannot.
   */
  probeCapability?: (atCursor?: BlockCursor) => Promise<ProbeResult>
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** A structured snapshot of the fallback's observable state, for a metrics surface (§4). */
export interface FallbackMetrics {
  activeIndex: number | undefined
  switchCount: number
  sources: { name: string; health: FallbackHealth; active: boolean; cause?: SourceErrorInfo }[]
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

  /** Guards against firing a second capability probe for a source while one is still in flight. */
  readonly #capabilityProbing: boolean[] = []
  /** Clock of the last capability probe per source — throttles the (full-query) standby probe. */
  readonly #lastProbeAt: number[] = []

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

          // Eager switch-up: reclaim a recovered higher-preference source at the batch boundary
          // (never mid-batch). Probe those candidates first so a recovered one can re-prove its
          // capability and reach `healthy` — switch-up only ever promotes to a `healthy` source.
          if (this.#policy.preferPrimary === 'eager') {
            this.#probeHigherPreference(active, last)
            if (this.#selector.pickSwitchUp(active) !== undefined) {
              switchedUp = true
              break
            }
          }
        }

        if (!switchedUp) return // source completed (bounded stream)
      } catch (e) {
        if (isForkException(e)) throw e // propagate; do NOT switch

        this.#failSource(active, classifyError('stream', e))
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

  /**
   * Drive capability (and, with it, liveness) for the not-yet-active *higher-preference* sources,
   * so a recovered one can re-prove it can serve the query and be reclaimed by eager switch-up.
   * When the active source is the primary (index 0) there are none, so this is a no-op on the hot
   * path; it only does work after a failover — exactly when a recovered primary needs noticing.
   *
   * Fire-and-forget (a full query slice must not block the boundary) and never concurrently for the
   * same source. Unlike Squid, Pipes has no cheap head poll, so a successful probe is the liveness
   * signal too: it counts a liveness pass *and* confirms capability, so after `M` throttled probes
   * the source reaches `healthy`. The probe is anchored to the frontier (`last`) so it verifies the
   * depth the source is about to read. The gating in {@link SourceHealth} means a probe failure (or
   * a later stream error) drops the confirmation, so the source must re-prove before recovering.
   */
  #probeHigherPreference(active: number, last?: BlockCursor): void {
    for (let i = 0; i < active; i++) {
      const probe = this.#sources[i].probeCapability
      // Only probe a candidate that is eligible to recover: `unhealthy` is still cooling down, and
      // `healthy` is already confirmed (the gating drops it back to `unknown`-eligible on failure).
      if (!probe || this.#health[i].state !== 'unknown' || this.#capabilityProbing[i]) continue

      const now = this.#policy.clock()
      if (now - (this.#lastProbeAt[i] ?? 0) < this.#policy.capabilityProbeIntervalMs) continue

      this.#lastProbeAt[i] = now
      this.#capabilityProbing[i] = true
      probe(last)
        .then(
          (r) => {
            if (r.ok) {
              this.#health[i].onLivenessPass()
              this.#health[i].onCapability(true)
            } else {
              this.#failSource(i, r.cause ?? freshnessFailure('capability', 'stale', 'probe reported not-capable'))
            }
          },
          (e) => this.#failSource(i, classifyError('capability', e)),
        )
        .finally(() => {
          this.#capabilityProbing[i] = false
        })
    }
  }

  /**
   * Feed a failure to a source's health (the `check` selects the signal), then log *why* — but only
   * when it actually flips the source unhealthy, so a log line always marks a real transition
   * (liveness fails are noisy until they trip the threshold). The bounded `reason`/`code`/`check`
   * also reach {@link metrics}; the full `detail` (incl. the request) is logged, never a label.
   */
  #failSource(i: number, cause: SourceErrorInfo): void {
    const before = this.#health[i].state
    switch (cause.check) {
      case 'stream':
        this.#health[i].onStreamError(cause)
        break
      case 'liveness':
        this.#health[i].onLivenessFail(cause)
        break
      case 'capability':
        this.#health[i].onCapability(false, cause)
        break
    }
    if (before !== 'unhealthy' && this.#health[i].state === 'unhealthy') {
      this.#logger.warn(
        { source: this.#sources[i].name, check: cause.check, reason: cause.reason, code: cause.code },
        `fallback source "${this.#sources[i].name}" marked unhealthy: ${cause.detail}`,
      )
    }
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
        cause: this.#health[i].cause,
      })),
    }
  }
}
