import { IncomingMessage, Server, ServerResponse, createServer } from 'http'

export type MockData<T extends object = any> = T

type ValidateRequest = (res: any) => unknown

export type MockResponse =
  | {
      statusCode: 204
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 200
      data: {
        header: {
          number: number
          hash: string
          timestamp?: number
        }
        logs?: any[]
      }[]
      head?: {
        finalized?: { number: number; hash: string }
        latest?: { number: number }
      }
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 409
      data: {
        previousBlocks: {
          number: number
          hash: string
        }[]
      }
      validateRequest?: ValidateRequest
    }
  | {
      statusCode: 500 | 503
      validateRequest?: ValidateRequest
    }

export type MockPortal = { server: Server; url: string }

export async function createFinalizedMockPortal(mockResponses: MockResponse[]) {
  return createMockPortal(mockResponses, {
    finalized: true,
  })
}

export async function createMockPortal(
  mockResponses: MockResponse[],
  { finalized = false }: { finalized?: boolean } = {},
): Promise<MockPortal> {
  const promise = new Promise<Server>((resolve, reject) => {
    let requestCount = 0

    const streamUrl = finalized ? '/finalized-stream' : '/stream'

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url === '/metadata') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(
          JSON.stringify({
            dataset: 'mock-dataset',
            real_time: true,
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

        switch (mockResp.statusCode) {
          case 200:
            const headers: Record<string, string | number> = {
              'Content-Type': 'application/jsonl',
            }
            if (mockResp.head?.finalized?.number) {
              headers['X-Sqd-Finalized-Head-Number'] = mockResp.head.finalized.number
            }
            if (mockResp.head?.finalized?.hash) {
              headers['X-Sqd-Finalized-Head-Hash'] = mockResp.head.finalized.hash
            }
            if (mockResp.head?.latest?.number) {
              headers['X-Sqd-Head-Number'] = mockResp.head.latest.number
            }

            res.writeHead(mockResp.statusCode, headers)
            // Send each mock data item as a JSON line
            mockResp.data.forEach((data) => {
              res.write(JSON.stringify(data) + '\n')
            })
            break

          case 409:
            res.writeHead(mockResp.statusCode, { 'Content-Type': 'application/json' })
            res.write(JSON.stringify(mockResp.data))
            break
          default:
            res.writeHead(mockResp.statusCode)
            break
        }

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

  return { server, url: getServerAddress(server) }
}

export async function closeMockPortal(mockPortal?: MockPortal) {
  if (!mockPortal) return

  return new Promise((resolve, reject) => {
    mockPortal.server.close((err) => {
      if (err) return reject(err)

      resolve(null)
    })
  })
}

function getServerAddress(server: Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Invalid server address')
  }
  return `http://127.0.0.1:${address.port}`
}

export async function readAll<T>(stream: AsyncIterable<{ data: T[] }>): Promise<T[]> {
  const res: T[] = []

  for await (const chunk of stream) {
    res.push(...chunk.data)
  }

  return res
}
