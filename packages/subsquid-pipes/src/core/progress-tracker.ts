import { Counter, Gauge } from '~/core/index.js'
import { displayEstimatedTime, formatBlock, formatNumber, humanBytes } from './formatters.js'
import { Logger } from './logger.js'
import { createTransformer } from './transformer.js'
import { BlockCursor } from './types.js'

function mapRequestStatusLabel(statusCode: number): string {
  if (statusCode === 429) return 'rate_limited'
  if (statusCode >= 200 && statusCode < 300) return 'success'
  if (statusCode >= 500) return 'server_error'
  return 'error'
}

type HistoryState = {
  ts: number
  bytesDownloaded: number
  blockNumber: number
  requests: Record<number, number>
}
type LastCursorState = { initial: number; last: number; current: BlockCursor }

export type StartState = {
  initial: number
  current?: BlockCursor
}

export type ProgressState = {
  state: {
    initial: number
    last: number
    current: number
    percent: number
    etaSeconds: number
  }
  interval: {
    requests: {
      total: {
        count: number
      }
      successful: {
        count: number
        percent: number
      }
      rateLimited: {
        count: number
        percent: number
      }
      failed: {
        count: number
        percent: number
      }
    }
    processedBlocks: {
      count: number
      perSecond: number
    }
    bytesDownloaded: {
      count: number
      perSecond: number
    }
  }
}

type ProgressHistoryOptions = {
  maxHistory?: number
  maxStaleSeconds?: number
}

class ProgressHistory {
  #options: Required<ProgressHistoryOptions>
  #states: HistoryState[] = []
  #lastCursorState?: LastCursorState

  constructor(options?: ProgressHistoryOptions) {
    this.#options = {
      maxHistory: 100,
      maxStaleSeconds: 10,

      ...options,
    }
  }

  addState({ bytes, state, requests }: { bytes: number; state: LastCursorState; requests: Record<number, number> }) {
    // if (!state.current?.number) return

    this.#states.push({
      ts: Date.now(),
      bytesDownloaded: bytes,
      blockNumber: state.current.number || 0,
      requests,
    })

    this.#lastCursorState = state

    // Keep only the last N states for X seconds
    this.#states = this.#states.slice(-this.#options.maxHistory)
  }

  private mapRequestStatus(statusCode: number): 'successful' | 'rateLimited' | 'failed' {
    if (statusCode >= 200 && statusCode < 300) {
      return 'successful'
    } else if (statusCode === 429) {
      return 'rateLimited'
    } else {
      return 'failed'
    }
  }

  private validateHistory(states: HistoryState[]) {
    const lastTs = states[states.length - 1]?.ts

    // If the last state is too old, reset the history
    // This can happen if the stream got stuck
    if (lastTs && Date.now() - lastTs > this.#options.maxStaleSeconds * 1000) {
      this.#states = []
      return {
        blocks: 0,
        bytes: 0,
        requests: {
          total: 0,
          successful: 0,
          rateLimited: 0,
          failed: 0,
        },
      }
    }

    return {
      blocks: states.length >= 2 ? states[states.length - 1].blockNumber - states[0].blockNumber : 0,
      bytes: states.reduce((acc, state) => acc + state.bytesDownloaded, 0),
      requests: states.reduce(
        (acc, state) => {
          for (const [status, value] of Object.entries(state.requests)) {
            acc.total += value
            acc[this.mapRequestStatus(Number(status))] += value
          }

          return acc
        },
        {
          total: 0,
          successful: 0,
          rateLimited: 0,
          failed: 0,
        },
      ),
    }
  }

  calculate(): ProgressState {
    const stat = this.validateHistory(this.#states)

    const last = this.#lastCursorState?.last || 0
    const initial = this.#lastCursorState?.initial || 0
    const current = this.#lastCursorState?.current?.number || 0

    const blocksTotal = Math.max(last - initial, 0)
    const blocksProcessed = Math.max(current - initial, 0)
    const blocksRemaining = Math.max(last - current, 0)

    const secsDiff = this.#states[0] ? (Date.now() - this.#states[0].ts) / 1000 : 0
    const blockPerSecond = secsDiff > 0 ? stat.blocks / secsDiff : 0

    return {
      state: {
        initial,
        last,
        current,
        percent: blocksTotal > 0 ? (blocksProcessed / blocksTotal) * 100 : 0,
        etaSeconds: blockPerSecond > 0 ? blocksRemaining / blockPerSecond : 0,
      },
      interval: {
        requests: {
          total: {
            count: stat.requests.total,
          },
          successful: {
            count: stat.requests.successful,
            percent: stat.requests.total > 0 ? (stat.requests.successful / stat.requests.total) * 100 : 0,
          },
          rateLimited: {
            count: stat.requests.rateLimited,
            percent: stat.requests.total > 0 ? (stat.requests.rateLimited / stat.requests.total) * 100 : 0,
          },
          failed: {
            count: stat.requests.failed,
            percent: stat.requests.total > 0 ? (stat.requests.failed / stat.requests.total) * 100 : 0,
          },
        },
        processedBlocks: {
          count: stat.blocks,
          perSecond: blockPerSecond,
        },
        bytesDownloaded: {
          count: stat.bytes,
          perSecond: secsDiff > 0 ? stat.bytes / secsDiff : 0,
        },
      },
    }
  }
}

export type ProgressTrackerOptions = {
  onStart?: (progress: StartState) => void
  onProgress?: (progress: ProgressState) => void
  interval?: number
  logger?: Logger
}

export function progressTracker<T>({ onProgress, onStart, interval = 5000, logger }: ProgressTrackerOptions) {
  let ticker: NodeJS.Timeout | null = null
  let currentBlock: Gauge | null = null
  let lastBlock: Gauge | null = null
  let progressRatio: Gauge | null = null
  let etaSeconds: Gauge | null = null
  let blocksPerSecond: Gauge | null = null
  let bytesDownloaded: Counter | null = null
  let portalRequests: Counter<'status'> | null = null
  let lastState: ProgressState | null = null

  const history = new ProgressHistory()

  if (!onStart) {
    onStart = (data: StartState) => {
      if (data.current) {
        logger?.info(`Resuming indexing from ${formatBlock(data.current.number)} block`)
        return
      }

      logger?.info(`Start indexing from ${formatBlock(data.initial)} block`)
    }
  }

  if (!onProgress) {
    onProgress = ({ state, interval }) => {
      if (!logger) return

      if (state.current === 0 && state.last === 0) {
        logger.info({ message: 'Initializing...' })
        return
      }

      const bps =
        interval.processedBlocks.perSecond > 1
          ? formatNumber(interval.processedBlocks.perSecond, 0)
          : interval.processedBlocks.perSecond.toFixed(2)

      const msg: Record<string, string> = {
        message: `${formatNumber(state.current)} / ${formatNumber(state.last)} (${formatNumber(state.percent)}%), ${displayEstimatedTime(state.etaSeconds)}`,
        blocks: `${bps} blocks/second`,
        bytes: `${humanBytes(interval.bytesDownloaded.perSecond)}/second`,
      }

      if (interval.requests.total.count > 0) {
        msg['requests'] =
          `${formatNumber(interval.requests.successful.percent)}% successful, ${formatNumber(interval.requests.rateLimited.percent)}% rate limited, ${formatNumber(interval.requests.failed.percent)}% failed out of ${formatNumber(interval.requests.total.count)} requests`
      }

      logger.info(msg)
    }
  }

  return createTransformer<T, T>({
    profiler: { id: 'track progress' },
    start: ({ metrics, state }) => {
      if (interval > 0) {
        ticker = setInterval(() => {
          if (!lastState) return

          onProgress(lastState)
        }, interval)
      }

      onStart(state)

      currentBlock = metrics.gauge({
        name: 'sqd_current_block',
        help: 'Current block number being processed',
      })
      currentBlock.set(-1)

      lastBlock = metrics.gauge({
        name: 'sqd_last_block',
        help: 'Latest known chain head block number',
      })

      progressRatio = metrics.gauge({
        name: 'sqd_progress_ratio',
        help: 'Indexing progress as a ratio from 0 to 1',
      })

      etaSeconds = metrics.gauge({
        name: 'sqd_eta_seconds',
        help: 'Estimated time to completion in seconds',
      })

      blocksPerSecond = metrics.gauge({
        name: 'sqd_blocks_per_second',
        help: 'Current indexing speed in blocks per second',
      })

      bytesDownloaded = metrics.counter({
        name: 'sqd_bytes_downloaded_total',
        help: 'Total bytes downloaded from portal',
      })

      portalRequests = metrics.counter({
        name: 'sqd_portal_requests_total',
        help: 'Total portal requests by status category',
        labelNames: ['status'] as const,
      })
    },
    transform: async (data, ctx) => {
      history.addState({
        state: ctx.state,
        bytes: ctx.meta.bytesSize,
        requests: ctx.meta.requests,
      })

      if (ctx.state.current?.number) {
        currentBlock?.set(ctx.state.current.number)
      }

      lastState = history.calculate()

      lastBlock?.set(lastState.state.last)
      progressRatio?.set(lastState.state.percent / 100)
      etaSeconds?.set(lastState.state.etaSeconds)
      blocksPerSecond?.set(lastState.interval.processedBlocks.perSecond)
      bytesDownloaded?.inc(ctx.meta.bytesSize)

      for (const [statusCode, count] of Object.entries(ctx.meta.requests)) {
        portalRequests?.inc({ status: mapRequestStatusLabel(Number(statusCode)) }, count)
      }

      ctx.state.progress = lastState

      return data
    },
    stop: () => {
      if (ticker) {
        clearInterval(ticker)
      }
    },
  })
}
