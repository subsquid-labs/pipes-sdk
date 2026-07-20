import { RpcLatencyListener } from './rpc-latency-watcher.js'

const RECONNECT_MIN_MS = 250
const RECONNECT_MAX_MS = 30_000

/** Silence beyond this means a dead socket; must exceed the slowest chain's block time. */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/**
 * Keeps a JSON-RPC subscription alive over a WebSocket.
 *
 * Recovers from `close`, `error`, and silence — a half-open socket and a hung
 * handshake both emit no event, so only a data-liveness deadline tells them apart
 * from a quiet chain. Backoff is exponential and resets on delivered data rather
 * than on `open`: a tight retry loop just gets the client rate-limited.
 */
export class WebSocketListener implements RpcLatencyListener {
  #socket?: WebSocket
  #stopped = false
  #payload?: any
  #onMessage?: (data: any) => void
  #attempt = 0
  #reconnectTimer?: ReturnType<typeof setTimeout>
  #idleTimer?: ReturnType<typeof setTimeout>

  constructor(
    private url: string,
    private idleTimeoutMs: number = DEFAULT_IDLE_TIMEOUT_MS,
  ) {}

  subscribe(payload: any, onMessage: (data: any) => void) {
    // Just a simple guard to prevent multiple subscriptions
    if (this.#payload) throw new Error('Already subscribed')

    this.#payload = payload
    this.#onMessage = onMessage

    this.connect()
  }

  private connect() {
    if (this.#stopped) return

    // Opened here, not in the constructor: an `open` firing before its listener is
    // attached would leave the subscription unsent on a healthy-looking socket.
    const socket = new WebSocket(this.url)
    this.#socket = socket

    // Armed before `open`, because a handshake that hangs emits no event at all —
    // the deadline has to cover connecting, not just an established socket.
    this.armIdleTimer()

    // A replaced socket's events must not tear down its successor.
    const isCurrent = () => this.#socket === socket

    socket.addEventListener('open', () => {
      if (!isCurrent()) return

      socket.send(JSON.stringify(this.#payload))
      this.armIdleTimer()
    })

    socket.addEventListener('message', (event) => {
      if (!isCurrent()) return

      // Delivered data, not `open`, is what proves the endpoint is usable: a
      // rate-limiting provider accepts the upgrade and drops it, and resetting on
      // `open` would turn that into the tight loop the backoff exists to prevent.
      this.#attempt = 0
      this.armIdleTimer()

      // Runs detached from any caller's stack — a throw here reaches the top level.
      try {
        this.#onMessage?.(JSON.parse(event.data))
      } catch {
        // matches the silent-on-error behavior of PollingClient's tick
      }
    })

    socket.addEventListener('error', () => {
      if (isCurrent()) this.reconnect()
    })

    socket.addEventListener('close', () => {
      if (isCurrent()) this.reconnect()
    })
  }

  private reconnect() {
    // `error` is usually followed by `close`; without this the pair schedules two.
    if (this.#stopped || this.#reconnectTimer) return

    this.clearIdleTimer()
    this.closeSocket()

    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** this.#attempt)
    this.#attempt++

    // Jitter keeps watchers off a shared cadence.
    const delay = backoff / 2 + Math.random() * (backoff / 2)

    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = undefined
      this.connect()
    }, delay)
  }

  private armIdleTimer() {
    this.clearIdleTimer()
    if (this.idleTimeoutMs <= 0) return

    this.#idleTimer = setTimeout(() => this.reconnect(), this.idleTimeoutMs)
  }

  private clearIdleTimer() {
    if (!this.#idleTimer) return

    clearTimeout(this.#idleTimer)
    this.#idleTimer = undefined
  }

  private closeSocket() {
    const socket = this.#socket
    // Cleared first so the resulting `close` reads as stale.
    this.#socket = undefined
    socket?.close()
  }

  stop() {
    this.#stopped = true

    this.clearIdleTimer()

    if (this.#reconnectTimer) {
      clearTimeout(this.#reconnectTimer)
      this.#reconnectTimer = undefined
    }

    this.closeSocket()
  }
}
