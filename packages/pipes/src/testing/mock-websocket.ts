type Handler = (event?: any) => void

/**
 * Stand-in for the global `WebSocket`, driven by the test rather than a server.
 * Install with `mockWebSocket()`; combine with fake timers to exercise
 * reconnect and idle-timeout behaviour without waiting on wall-clock delays.
 */
export class MockWebSocket {
  static instances: MockWebSocket[] = []

  sent: string[] = []
  closed = false
  readonly #handlers = new Map<string, Handler[]>()

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this)
  }

  static get last() {
    return MockWebSocket.instances[MockWebSocket.instances.length - 1]
  }

  addEventListener(type: string, handler: Handler) {
    this.#handlers.set(type, [...(this.#handlers.get(type) ?? []), handler])
  }

  emit(type: string, event?: any) {
    for (const handler of this.#handlers.get(type) ?? []) {
      handler(event)
    }
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
    this.emit('close')
  }

  open() {
    this.emit('open')
  }

  /** Delivers `payload` as a JSON frame, the way a subscription update arrives. */
  message(payload: unknown) {
    this.emit('message', { data: JSON.stringify(payload) })
  }
}

/**
 * Swaps the global `WebSocket` for {@link MockWebSocket} and resets the instance
 * log. Returns the restore function — call it from `afterEach`.
 */
export function mockWebSocket(): () => void {
  const original = (globalThis as any).WebSocket
  MockWebSocket.instances = []
  ;(globalThis as any).WebSocket = MockWebSocket

  return () => {
    ;(globalThis as any).WebSocket = original
  }
}
