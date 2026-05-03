import { RpcLatencyListener } from './rpc-latency-watcher.js'

export type PollingTick = () => Promise<void> | void

/**
 * Drives a periodic callback. Calls `tick` immediately, then on every
 * `intervalMs` interval until `stop()` is called. Errors thrown from
 * `tick` are swallowed so a single failing poll cannot crash the loop.
 */
export class PollingClient implements RpcLatencyListener {
  #stopped = false
  #timer?: ReturnType<typeof setTimeout>
  #wakeSleep?: () => void

  constructor(
    private readonly intervalMs: number,
    private readonly tick: PollingTick,
  ) {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new RangeError(`PollingClient: intervalMs must be a positive finite number, got ${intervalMs}`)
    }
    void this.run()
  }

  private async run() {
    while (!this.#stopped) {
      try {
        await this.tick()
      } catch {
        // matches the silent-on-error behavior of WebSocketListener's reconnect loop
      }
      if (this.#stopped) return
      await this.sleep(this.intervalMs)
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      this.#wakeSleep = resolve
      this.#timer = setTimeout(() => {
        this.#wakeSleep = undefined
        resolve()
      }, ms)
    })
  }

  stop() {
    this.#stopped = true
    if (this.#timer) {
      clearTimeout(this.#timer)
      this.#timer = undefined
    }
    // Resolve a pending sleep so `run()` unblocks immediately and lets
    // the loop body observe `#stopped` and exit.
    const wake = this.#wakeSleep
    this.#wakeSleep = undefined
    wake?.()
  }
}
