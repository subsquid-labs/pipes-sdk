import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MockWebSocket, mockWebSocket } from '~/testing/mock-websocket.js'

import { WebSocketListener } from './ws-client.js'

const PAYLOAD = { jsonrpc: '2.0', id: 1, method: 'eth_subscribe', params: ['newHeads'] }

describe('WebSocketListener', () => {
  let listener: WebSocketListener | undefined
  let restoreWebSocket: () => void

  beforeEach(() => {
    vi.useFakeTimers()
    restoreWebSocket = mockWebSocket()
  })

  afterEach(() => {
    listener?.stop()
    listener = undefined
    restoreWebSocket()
    vi.useRealTimers()
  })

  it('sends the subscription once the socket opens', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})

    MockWebSocket.last.open()

    expect(MockWebSocket.last.sent).toEqual([JSON.stringify(PAYLOAD)])
  })

  it('reconnects after the socket closes', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    MockWebSocket.last.emit('close')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(2)
    MockWebSocket.last.open()
    expect(MockWebSocket.last.sent).toEqual([JSON.stringify(PAYLOAD)])
  })

  it('reconnects on error, which does not always come with a close', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    MockWebSocket.last.emit('error')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('reconnects when the socket goes silent without closing', () => {
    // The regression that froze the freshness dashboard: a half-open socket emits
    // neither close nor error, so it looked alive while delivering nothing.
    listener = new WebSocketListener('ws://rpc', 1_000)
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    vi.advanceTimersByTime(1_000)
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('keeps the socket while messages keep arriving', () => {
    listener = new WebSocketListener('ws://rpc', 1_000)
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(800)
      MockWebSocket.last.message({ method: 'eth_subscription' })
    }
    vi.advanceTimersByTime(800)

    expect(MockWebSocket.instances).toHaveLength(1)
  })

  it('schedules a single reconnect when error and close both fire', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    const socket = MockWebSocket.last
    socket.emit('error')
    socket.emit('close')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('ignores events from a socket it already replaced', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    const stale = MockWebSocket.last
    stale.emit('close')
    vi.advanceTimersByTime(250)
    expect(MockWebSocket.instances).toHaveLength(2)

    stale.emit('close')
    vi.advanceTimersByTime(30_000)

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('backs off instead of reconnecting in a tight loop', () => {
    // A bare retry loop reconnects fast enough to get rate-limited.
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})

    // Never opens, so the attempt counter keeps climbing.
    for (let i = 0; i < 6; i++) {
      MockWebSocket.last.emit('close')
      vi.advanceTimersByTime(30_000)
    }
    const afterSixFailures = MockWebSocket.instances.length

    MockWebSocket.last.emit('close')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(afterSixFailures)
  })

  it('reconnects when the handshake hangs without opening', () => {
    // A blackholed connect emits no open, no error and no close, so the deadline
    // has to cover connecting too — not just an established socket.
    listener = new WebSocketListener('ws://rpc', 1_000)
    listener.subscribe(PAYLOAD, () => {})

    vi.advanceTimersByTime(1_000)
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(2)
  })

  it('keeps backing off when the socket opens and is dropped straight away', () => {
    // How a rate-limiting provider refuses: it accepts the upgrade, then closes.
    // Treating `open` as proof of health resets the backoff every cycle, which is
    // the tight loop the backoff exists to prevent.
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})

    for (let i = 0; i < 6; i++) {
      MockWebSocket.last.open()
      MockWebSocket.last.emit('close')
      vi.advanceTimersByTime(30_000)
    }
    const afterSixFailures = MockWebSocket.instances.length

    MockWebSocket.last.open()
    MockWebSocket.last.emit('close')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(afterSixFailures)
  })

  it('resets the backoff once a connection actually delivers data', () => {
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {})

    for (let i = 0; i < 6; i++) {
      MockWebSocket.last.emit('close')
      vi.advanceTimersByTime(30_000)
    }

    MockWebSocket.last.open()
    MockWebSocket.last.message({ method: 'eth_subscription' })
    const healthy = MockWebSocket.instances.length

    MockWebSocket.last.emit('close')
    vi.advanceTimersByTime(250)

    expect(MockWebSocket.instances).toHaveLength(healthy + 1)
  })

  it('survives a handler that throws', () => {
    // A throwing handler killed the freshness monitor 49 times.
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, () => {
      throw new TypeError('undefined is not an object')
    })
    MockWebSocket.last.open()

    expect(() => MockWebSocket.last.message({ method: 'eth_subscription' })).not.toThrow()
  })

  it('survives a malformed frame', () => {
    const seen: unknown[] = []
    listener = new WebSocketListener('ws://rpc')
    listener.subscribe(PAYLOAD, (data) => seen.push(data))
    MockWebSocket.last.open()

    expect(() => MockWebSocket.last.emit('message', { data: 'not json' })).not.toThrow()

    MockWebSocket.last.message({ ok: true })
    expect(seen).toEqual([{ ok: true }])
  })

  it('stops reconnecting after stop()', () => {
    listener = new WebSocketListener('ws://rpc', 1_000)
    listener.subscribe(PAYLOAD, () => {})
    MockWebSocket.last.open()

    listener.stop()
    const afterStop = MockWebSocket.instances.length
    vi.advanceTimersByTime(60_000)

    expect(MockWebSocket.instances).toHaveLength(afterStop)
    expect(MockWebSocket.instances[0].closed).toBe(true)
  })
})
