import { Gauge } from 'prom-client'
import { displayEstimatedTime, formatBlock, formatNumber, humanBytes } from './formatters'
import { Logger } from './logger'
import { createTransformer } from './transformer'
import { BlockCursor } from './types'

type HistoryState = { ts: number; bytesDownloaded: number; blockNumber: number }
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
      maxHistory: 50,
      maxStaleSeconds: 30,

      ...options,
    }
  }

  addState({ bytes, state }: { bytes: number; state: LastCursorState }) {
    if (!state.current?.number) return

    this.#states.push({
      ts: Date.now(),
      bytesDownloaded: bytes,
      blockNumber: state.current.number || 0,
    })

    this.#lastCursorState = state

    // Keep only the last N states for X seconds
    this.#states = this.#states.slice(-this.#options.maxHistory)
  }

  private validateHistory(states: HistoryState[]) {
    const lastTs = states[states.length - 1]?.ts

    // If the last state is too old, reset the history
    // This can happen if the stream got stuck
    if (lastTs && Date.now() - lastTs > this.#options.maxStaleSeconds * 1000) {
      this.#states = []
      return { blocks: 0, bytes: 0 }
    }

    return {
      blocks: states.length >= 2 ? states[states.length - 1].blockNumber - states[0].blockNumber : 0,
      bytes: states.reduce((acc, state) => acc + state.bytesDownloaded, 0),
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

export function progressTracker<T>({ onProgress, onStart, interval, logger }: ProgressTrackerOptions) {
  let ticker: NodeJS.Timeout
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
      if (state.current === 0 && state.last === 0) {
        logger?.info({ message: 'Initializing...' })
        return
      }

      logger?.info({
        message: `${formatNumber(state.current)} / ${formatNumber(state.last)} (${formatNumber(state.percent)}%), ${displayEstimatedTime(state.etaSeconds)}`,
        blocks: `${interval.processedBlocks.perSecond.toFixed(interval.processedBlocks.perSecond > 1 ? 0 : 2)} blocks/second`,
        bytes: `${humanBytes(interval.bytesDownloaded.perSecond)}/second`,
      })
    }
  }

  let currentBlock: Gauge

  return createTransformer<T, T>({
    profiler: { id: 'progress_tracker' },
    start: ({ metrics, state }) => {
      ticker = setInterval(() => onProgress(history.calculate()), interval)

      onStart(state)

      currentBlock = metrics.gauge({
        name: 'sqd_current_block',
        help: 'Total number of blocks processed',
      })
      currentBlock.set(-1)
    },
    transform: async (data, { state, bytes }) => {
      history.addState({
        state: state,
        bytes: bytes,
      })

      if (state.current?.number) {
        currentBlock.set(state.current.number)
      }

      return data
    },
    stop: () => {
      clearInterval(ticker)
    },
  })
}
