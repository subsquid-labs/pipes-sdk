export class WebSocketListener {
  #socket: WebSocket
  #stopped = false
  #payload?: any
  #onMessage?: (data: any) => void

  constructor(private url: string) {
    this.#socket = new WebSocket(this.url)
  }

  private async open(): Promise<void> {
    this.#socket.addEventListener('close', async () => {
      if (this.#stopped) return

      this.#socket = new WebSocket(this.url)
      await this.open()
    })

    return new Promise((resolve) => {
      this.#socket.addEventListener('open', () => {
        this.#socket.send(JSON.stringify(this.#payload))
        this.#socket.addEventListener('message', (event) => {
          this.#onMessage?.(JSON.parse(event.data))
        })

        resolve()
      })
    })
  }

  subscribe(payload: any, onMessage: (data: any) => void) {
    // Just a simple guard to prevent multiple subscriptions
    if (this.#payload) throw new Error('Already subscribed')

    this.#payload = payload
    this.#onMessage = onMessage

    void this.open()
  }

  stop() {
    this.#stopped = true
    this.#socket.close()
  }
}
