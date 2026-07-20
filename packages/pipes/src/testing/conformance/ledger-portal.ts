import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http'

import { getServerAddress, writeWireResponse } from '../portal-wire.js'
import type { MockPortal } from '../test-portal.js'
import type { ChainLedger, LedgerRequest } from './chain-ledger.js'

export type LedgerPortalOptions = {
  /** Serve `/finalized-stream` instead of `/stream` (IB-1). */
  finalized?: boolean
  /** Dataset kind reported by `/metadata`. */
  kind?: string
  startBlock?: number
  /** Runs on every parsed request body before the ledger answers; assert-only. */
  validateRequest?: (body: any) => unknown
}

export type LedgerPortal = MockPortal & {
  ledger: ChainLedger
}

/**
 * The simulator in ledger mode: same wire surface as {@link mockPortal}, but every response is
 * derived from the request anchor against the held chain instead of being read off a script.
 */
export async function ledgerPortal(ledger: ChainLedger, options: LedgerPortalOptions = {}): Promise<LedgerPortal> {
  const streamUrl = options.finalized ? '/finalized-stream' : '/stream'

  const server = await new Promise<Server>((resolve, reject) => {
    const server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.url?.startsWith('/metadata')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.write(
          JSON.stringify({
            dataset: 'ledger-dataset',
            aliases: [],
            real_time: true,
            start_block: options.startBlock ?? 0,
            metadata: { kind: options.kind ?? 'evm' },
          }),
        )
        res.end()

        return
      }

      if (req.url !== streamUrl) {
        res.statusCode = 404
        res.end()

        return
      }

      let body = ''
      req.on('data', (chunk) => {
        body += chunk
      })
      req.on('end', () => {
        const parsed = body ? JSON.parse(body) : undefined
        options.validateRequest?.(parsed)

        writeWireResponse(res, ledger.answer(toLedgerRequest(parsed)))
        res.end()
      })
    })

    server.listen(0, () => resolve(server))
    server.on('error', reject)
  })

  return {
    server,
    ledger,
    url: getServerAddress(server),
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()))
      }),
  }
}

function toLedgerRequest(body: any): LedgerRequest {
  return {
    fromBlock: body?.fromBlock ?? 0,
    toBlock: body?.toBlock,
    parentBlockHash: body?.parentBlockHash,
  }
}
