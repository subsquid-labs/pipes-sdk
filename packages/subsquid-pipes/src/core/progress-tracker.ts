import { Counter, Gauge } from '~/core/index.js'

import { displayEstimatedTime, formatBlock, formatNumber, humanBytes } from './formatters.js'
import { Logger } from './logger.js'
import { createTransformer } from './transformer.js'
import { BlockCursor } from './types.js'

type HistoryState = {
  ts: number
  bytesDownloaded: number
  blockNumber: number
  requests: Record<number, number>
}
type LastCursorState = { initial: number; last: number; current: BlockCursor }

export type StartEvent = {
  state: {
    initial: number
    current?: BlockCursor
  }
  logger: Logger
}

export type ProgressEvent = {
  progress: {
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
  logger: Logger
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

  calculate(): ProgressEvent['progress'] {
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
  onStart?: (state: StartEvent) => void
  onProgress?: (state: ProgressEvent) => void
  interval?: number
}

export function progressTracker<T>({ onProgress, onStart, interval = 5000 }: ProgressTrackerOptions) {
  let ticker: NodeJS.Timeout | null = null
  let lastProgress: ProgressEvent['progress'] | null = null

  let pipeId = ''
  let currentBlock: Gauge<'id'> | null = null
  let lastBlock: Gauge<'id'> | null = null
  let progressRatio: Gauge<'id'> | null = null
  let etaSeconds: Gauge<'id'> | null = null
  let blocksPerSecond: Gauge<'id'> | null = null
  let bytesDownloaded: Counter<'id'> | null = null
  let pipelineRunning: Gauge<'id'> | null = null

  const history = new ProgressHistory()

  if (!onStart) {
    onStart = ({ state, logger }) => {
      if (state.current) {
        logger.info(`Resuming indexing from ${formatBlock(state.current.number)} block`)
        return
      }

      logger.info(`Start indexing from ${formatBlock(state.initial)} block`)
    }
  }

  if (!onProgress) {
    onProgress = ({ progress: { state, interval }, logger }) => {
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
        msg['requests'] = [
          interval.requests.successful.percent > 0
            ? `${formatNumber(interval.requests.successful.percent)}% successful`
            : false,
          interval.requests.rateLimited.percent
            ? `${formatNumber(interval.requests.rateLimited.percent)}% rate limited`
            : false,
          interval.requests.failed.percent > 0 ? `${formatNumber(interval.requests.failed.percent)}% failed` : false,
        ]
          .filter(Boolean)
          .join(', ')
      }

      logger.info(msg)
    }
  }

  return createTransformer<T, T>({
    profiler: { id: 'track progress' },
    start: ({ id, metrics, state, logger }) => {
      pipeId = id

      if (interval > 0) {
        ticker = setInterval(() => {
          if (!lastProgress) return

          onProgress({ progress: lastProgress, logger })
        }, interval)
      }

      onStart({ state, logger })

      currentBlock = metrics.gauge({
        name: 'sqd_current_block',
        help: 'Current block number being processed',
        labelNames: ['id'] as const,
      })
      lastBlock = metrics.gauge({
        name: 'sqd_last_block',
        help: 'Last known block number in the chain',
        labelNames: ['id'] as const,
      })
      progressRatio = metrics.gauge({
        name: 'sqd_progress_ratio',
        help: 'Indexing progress as a ratio from 0 to 1',
        labelNames: ['id'] as const,
      })
      etaSeconds = metrics.gauge({
        name: 'sqd_eta_seconds',
        help: 'Estimated time to full sync in seconds',
        labelNames: ['id'] as const,
      })
      blocksPerSecond = metrics.gauge({
        name: 'sqd_blocks_per_second',
        help: 'Block processing speed',
        labelNames: ['id'] as const,
      })
      bytesDownloaded = metrics.counter({
        name: 'sqd_bytes_downloaded_total',
        help: 'Total bytes downloaded from portal',
        labelNames: ['id'] as const,
      })
      pipelineRunning = metrics.gauge({
        name: 'sqd_pipeline_running',
        help: 'Whether the pipeline is currently running (1 = running, 0 = stopped)',
        labelNames: ['id'] as const,
      })

      currentBlock.set({ id }, -1)
      pipelineRunning.set({ id }, 1)
    },
    transform: async (data, ctx) => {
      history.addState({
        state: ctx.state,
        bytes: ctx.meta.bytesSize,
        requests: ctx.meta.requests,
      })

      if (ctx.state.current?.number) {
        currentBlock?.set({ id: ctx.id }, ctx.state.current.number)
      }

      lastProgress = history.calculate()

      lastBlock?.set({ id: ctx.id }, lastProgress.state.last)
      progressRatio?.set({ id: ctx.id }, lastProgress.state.percent / 100)
      etaSeconds?.set({ id: ctx.id }, lastProgress.state.etaSeconds)
      blocksPerSecond?.set({ id: ctx.id }, lastProgress.interval.processedBlocks.perSecond)
      bytesDownloaded?.inc({ id: ctx.id }, ctx.meta.bytesSize)

      ctx.state.progress = lastProgress

      return data
    },
    stop: () => {
      if (ticker) {
        clearInterval(ticker)
      }
      pipelineRunning?.set({ id: pipeId }, 0)
    },
  })
}
