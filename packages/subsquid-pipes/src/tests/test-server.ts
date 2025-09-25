import { createServer, IncomingMessage, Server, ServerResponse } from 'http'

export type MockData<T extends object = any> = T

export interface BlockHeader {
  hash: string
  height: number
  parentHash: string
  status: string
  newRoot: string
  timestamp: number
  sequencerAddress: string
}

type ValidateRequest = (res: any) => unknown

type MockResponse =
  | {
      statusCode: 200
      data: {
        header: {
          number: number
          hash: string
          timestamp: number
        }
      }[]
      finalizedHead?: { number: number; hash: string }
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

export async function createMockPortal(mockResponses: MockResponse[]): Promise<MockPortal> {
  const promise = new Promise<Server>((resolve, reject) => {
    let requestCount = 0

    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url !== '/stream') {
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
            res.writeHead(mockResp.statusCode, {
              'Content-Type': 'application/jsonl',
              ...(mockResp.finalizedHead
                ? {
                    'X-Sqd-Finalized-Head-Number': mockResp.finalizedHead.number,
                    'X-Sqd-Finalized-Head-Hash': mockResp.finalizedHead.hash,
                  }
                : {}),
            })
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

export async function readAll(stream: AsyncIterable<MockData>) {
  const res: MockData[] = []

  for await (const chunk of stream) {
    res.push(...chunk.data)
  }

  return res
}
