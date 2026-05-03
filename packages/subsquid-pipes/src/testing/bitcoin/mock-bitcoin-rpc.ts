import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export type MockRpcCall = { method: string; params: unknown[]; auth?: string }

export type MockBitcoinRpcHandler = (method: string, params: unknown[]) => unknown | Promise<unknown>

export type MockBitcoinRpc = {
  url: string
  calls: MockRpcCall[]
  close(): Promise<void>
}

/**
 * Spins up an in-process HTTP server that speaks the bitcoind JSON-RPC dialect.
 * Pass a `handler(method, params)` that returns the `result` field; thrown
 * errors are surfaced as JSON-RPC errors with HTTP 500 (so callers can exercise
 * failure paths without hanging the connection).
 *
 * The returned `calls` array records every received request (including the
 * `Authorization` header value) so tests can assert on transport-level behavior
 * such as Basic auth.
 */
export async function createMockBitcoinRpc(handler: MockBitcoinRpcHandler): Promise<MockBitcoinRpc> {
  const calls: MockRpcCall[] = []

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', async () => {
      const { method, params } = JSON.parse(raw) as { method: string; params: unknown[] }
      const auth = typeof req.headers.authorization === 'string' ? req.headers.authorization : undefined
      calls.push({ method, params, auth })
      res.setHeader('Content-Type', 'application/json')
      try {
        const result = await handler(method, params)
        res.end(JSON.stringify({ result, error: null, id: 'pipes' }))
      } catch (err) {
        res.statusCode = 500
        res.end(JSON.stringify({ result: null, error: { message: (err as Error).message }, id: 'pipes' }))
      }
    })
  })

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo

  return {
    url: `http://127.0.0.1:${port}`,
    calls,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve())
      }),
  }
}
