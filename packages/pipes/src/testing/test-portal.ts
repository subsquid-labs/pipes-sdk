import { IncomingMessage, Server, ServerResponse, createServer } from 'http'

import { Portal } from '~/core/query-builder.js'

import {
  type BlockRef,
  type PortalBlockPayload,
  type PortalHead,
  getServerAddress,
  writeWireResponse,
} from './portal-wire.js'

type ValidateRequest = (res: any) => unknown

export type MockResponse =
  | {
      statusCode: 204
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 200
      data: PortalBlockPayload[]
      head?: PortalHead
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 409
      data: {
        previousBlocks: BlockRef[]
      }
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 500 | 503
      validateRequest?: ValidateRequest
    }

export type MockPortal = {
  server: Server
  url: string
  close(): Promise<void>
}

export async function finalizedMockPortal(mockResponses: MockResponse[]) {
  return mockPortal(mockResponses, {
    finalized: true,
  })
}

export async function mockPortal(
  mockResponses: MockResponse[],
  { finalized = false }: { finalized?: boolean } = {},
): Promise<MockPortal> {
  const promise = new Promise<Server>((resolve, reject) => {
    let requestCount = 0

    const streamUrl = finalized ? '/finalized-stream' : '/stream'

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/metadata')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(
          JSON.stringify({
            dataset: 'mock-dataset',
            aliases: [],
            real_time: true,
            start_block: 0,
            metadata: {
              kind: 'evm',
            },
          }),
        )
        res.end()
        return
      } else if (req.url !== streamUrl) {
        res.statusCode = 404
        res.end()
        return
      }

      const mockResp: MockResponse | undefined = mockResponses[requestCount]
      if (!mockResp) {
        let body = ''
        req.on('data', (chunk) => {
          body += chunk
        })
        req.on('end', () => {
          res.statusCode = 500
          res.end()
        })

        return
      }

      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        mockResp.validateRequest?.(body ? JSON.parse(body) : undefined)

        writeWireResponse(res, mockResp)

        requestCount++

        res.end()
      })
    })

    server.listen(0, () => {
      // console.log(`Listening ${getServerAddress(server)}`);
      resolve(server)
    })

    server.on('error', (e) => {
      reject(e)
    })
  })

  const server = await promise

  const portal: MockPortal = {
    server,
    url: getServerAddress(server),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) return reject(err)
          resolve()
        })
      }),
  }

  return portal
}

/** @internal */
export async function readAll<T>(stream: AsyncIterable<{ data: T[] }>): Promise<T[]> {
  const res: T[] = []

  for await (const chunk of stream) {
    res.push(...chunk.data)
  }

  return res
}

/**
 * @internal
 */
export function mockPortalRestApi(overrides: Partial<Portal> = {}): Portal {
  return {
    getHead: async () => ({ number: 1, hash: '0x' }),
    resolveTimestamp: async () => 0,
    ...overrides,
  }
}
