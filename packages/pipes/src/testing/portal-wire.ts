import { Server, ServerResponse } from 'node:http'

/** A point on a chain: the pair every wire surface identifies a block by. */
export type BlockRef = {
  number: number
  hash: string
}

/** One block as it appears on the wire — a single NDJSON line of a 200 response (IB-5). */
export type PortalBlockPayload = {
  header: {
    number: number
    hash: string
    timestamp?: number
  }
  logs?: any[]
  instructions?: any[]
  transactions?: any[]
  inputs?: any[]
  outputs?: any[]
  internalTransactions?: any[]
}

/** Head report carried by every stream response (IB-6). */
export type PortalHead = {
  finalized?: BlockRef
  latest?: { number: number }
}

/**
 * A response reduced to what goes on the wire, with no notion of how it was chosen — the ordinal
 * simulator picks it from a script, the ledger derives it from the request anchor, and both must
 * be byte-indistinguishable to the SUT.
 */
export type WireResponse =
  | { statusCode: 200; data: PortalBlockPayload[]; head?: PortalHead }
  | { statusCode: 204; head?: PortalHead }
  | { statusCode: 409; data: { previousBlocks: BlockRef[] } }
  | { statusCode: 429 | 500 | 502 | 503 | 504; retryAfter?: number | string }

/**
 * Head headers per IB-6. `!= null` rather than truthiness: block 0 is a valid head, and dropping
 * the header on it would hide finality entirely.
 */
export function headHeaders(head: PortalHead | undefined): Record<string, string | number> {
  const headers: Record<string, string | number> = {}
  if (!head) {
    return headers
  }

  if (head.finalized?.number != null) {
    headers['X-Sqd-Finalized-Head-Number'] = head.finalized.number
  }
  if (head.finalized?.hash != null) {
    headers['X-Sqd-Finalized-Head-Hash'] = head.finalized.hash
  }
  if (head.latest?.number != null) {
    headers['X-Sqd-Head-Number'] = head.latest.number
  }

  return headers
}

/**
 * Writes `response` onto `res` per IB-4/IB-5/IB-6. Leaves the response open — the caller ends it,
 * so a fault injector can truncate a stream mid-body.
 */
export function writeWireResponse(res: ServerResponse, response: WireResponse): void {
  switch (response.statusCode) {
    case 200:
      res.writeHead(200, {
        'Content-Type': 'application/jsonl',
        ...headHeaders(response.head),
      })
      for (const block of response.data) {
        res.write(JSON.stringify(block) + '\n')
      }
      break

    case 409:
      res.writeHead(409, { 'Content-Type': 'application/json' })
      res.write(JSON.stringify(response.data))
      break

    case 204:
      res.writeHead(204, headHeaders(response.head))
      break

    default: {
      const headers: Record<string, string | number> = {}
      if (response.retryAfter != null) {
        headers['Retry-After'] = response.retryAfter
      }
      res.writeHead(response.statusCode, headers)
      break
    }
  }
}

/** @internal */
export function getServerAddress(server: Server): string {
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Invalid server address')
  }

  return `http://127.0.0.1:${address.port}`
}
