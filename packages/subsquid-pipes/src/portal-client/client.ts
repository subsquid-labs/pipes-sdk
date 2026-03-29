import { Readable } from 'stream'

import { unexpectedCase, wait, withErrorContext } from '@subsquid/util-internal'

import {
  HttpBody,
  HttpClient,
  HttpClientOptions,
  HttpError,
  HttpResponse,
  RequestOptions,
} from '~/http-client/index.js'
import { partition } from '~/internal/array.js'
import { npmVersion } from '~/version.js'

import { ForkException } from './fork-exception.js'
import { GetBlock, PortalQuery, Query } from './query/index.js'
import { splitLines } from './split-lines.js'
import { type BlockRef, type PortalHead, StreamBuffer, type StreamData } from './stream-buffer.js'

export type { BlockRef, PortalHead, StreamData } from './stream-buffer.js'

export type ApiDataset = {
  dataset: string
  aliases: string[]
  real_time: boolean
  start_block: number
  metadata?: {
    kind: string
    display_name?: string
    logo_url?: string
    type?: string
    evm?: {
      chain_id: number
    }
  }
}

const USER_AGENT = `@subsquid/pipes:${npmVersion}`

export interface PortalClientOptions {
  /**
   * The URL of the portal dataset.
   */
  url: string

  /**
   *  If true, queries will only return finalized blocks.
   */
  finalized?: boolean

  /**
   * Optional custom HTTP client to use.
   */
  http?: HttpClient | HttpClientOptions

  /**
   * Maximum number of bytes to buffer before flushing.
   * @default 10_485_760 (10MB)
   */
  maxBytes?: number

  /**
   * Maximum time between stream data in milliseconds for return.
   * @default 300
   */
  maxIdleTime?: number

  /**
   * Maximum wait time in milliseconds for return.
   * @default 5_000
   */
  maxWaitTime?: number

  /**
   * Interval for polling the head in milliseconds.
   * @default 0
   */
  headPollInterval?: number
}

export type PortalRequestOptions = Pick<
  RequestOptions,
  'headers' | 'retryAttempts' | 'retrySchedule' | 'httpTimeout' | 'bodyTimeout'
>

export interface PortalStreamOptions {
  request?: PortalRequestOptions
  maxBytes?: number
  maxIdleTime?: number
  maxWaitTime?: number
  headPollInterval?: number
  finalized?: boolean
  /**
   * When true, unfinalized blocks are buffered together with finalized blocks
   * instead of being flushed one-by-one. This improves throughput for targets
   * that benefit from processing multiple unfinalized blocks per transaction
   * (e.g. drizzle-target), at the cost of slightly higher latency per batch.
   */
  batchUnfinalized?: boolean
}

export interface PortalStream<B> extends AsyncIterable<StreamData<B>> {}

function isForkHttpError(err: unknown): err is HttpError {
  if (!(err instanceof HttpError)) return false
  if (err.response.status !== 409) return false

  return true
}

export class PortalClient {
  readonly #client: HttpClient
  readonly #url: URL
  readonly #options: Required<Omit<PortalClientOptions, 'url' | 'http'>>

  constructor(options: PortalClientOptions) {
    this.#client = options.http instanceof HttpClient ? options.http : new HttpClient(options.http)

    this.#url = new URL(options.url)
    this.#options = {
      finalized: options.finalized ?? false,
      headPollInterval: options.headPollInterval ?? 0,
      maxBytes: options.maxBytes ?? 10 * 1024 * 1024,
      maxIdleTime: options.maxIdleTime ?? 300,
      maxWaitTime: options.maxWaitTime ?? 5_000,
    }
  }

  getUrl() {
    return this.#url.toString()
  }

  private getDatasetUrl(path: string): string {
    let u = new URL(this.#url)
    if (this.#url.pathname.endsWith('/')) {
      u.pathname += path
    } else {
      u.pathname += '/' + path
    }
    return u.toString()
  }

  async getMetadata(options?: PortalRequestOptions): Promise<ApiDataset> {
    const url = this.getDatasetUrl('metadata') + '?expand[]=metadata'
    const res = await this.request('GET', url, options)

    return res.body
  }

  async resolveTimestamp(seconds: number, options?: PortalRequestOptions): Promise<number> {
    const res = await this.request<{ block_number: number }>(
      'GET',
      this.getDatasetUrl(`timestamps/${seconds}/block`),
      options,
    )

    return res.body.block_number
  }

  async getHead(options?: PortalRequestOptions & { finalized: boolean }): Promise<BlockRef | undefined> {
    const res = await this.request<BlockRef>(
      'GET',
      this.getDatasetUrl((options?.finalized ?? this.#options.finalized) ? 'finalized-head' : 'head'),
      options,
    )
    return res.body ?? undefined
  }

  getStream<Q extends Query>(query: Q, options?: PortalStreamOptions): PortalStream<GetBlock<Q>> {
    const settings = {
      request: {},
      batchUnfinalized: true,
      ...this.#options,
      ...options,
    }

    return createPortalStream(query, settings, async (q, o) =>
      this.getStreamRequest((options?.finalized ?? this.#options.finalized) ? 'finalized-stream' : 'stream', q, o),
    )
  }

  private async getStreamRequest(path: string, query: PortalQuery, options?: RequestOptions) {
    try {
      let res = await this.request<Readable | undefined>('POST', this.getDatasetUrl(path), {
        ...options,
        json: query,
        stream: true,
      }).catch(withErrorContext({ query }))

      switch (res.status) {
        case 200:
        case 204:
          return {
            status: res.status,
            head: getHeadFromHeaders(res.headers),
            stream: res.body && res.status === 200 ? splitLines(res.body) : undefined,
          }
        default:
          throw unexpectedCase(res.status)
      }
    } catch (e: unknown) {
      if (isForkHttpError(e)) {
        throw new ForkException(e.response.body.previousBlocks, {
          fromBlock: query.fromBlock,
          parentBlockHash: query.parentBlockHash,
        })
      }

      throw e
    }
  }

  private request<T = any>(method: string, url: string, options: RequestOptions & HttpBody = {}) {
    return this.#client.request<T>(url, {
      ...options,
      method,
      headers: {
        'User-Agent': USER_AGENT,
        ...options?.headers,
      },
    })
  }
}

function createPortalStream<Q extends Query>(
  query: Q,
  options: Required<PortalStreamOptions>,
  requestStream: (
    query: Q,
    options?: RequestOptions,
  ) => Promise<{
    head: PortalHead
    status: number
    stream?: AsyncIterable<string[]> | null | undefined
  }>,
): PortalStream<GetBlock<Q>> {
  const { headPollInterval, request, batchUnfinalized, ...bufferOptions } = options
  const buffer = new StreamBuffer<GetBlock<Q>>(bufferOptions)

  let { fromBlock = 0, toBlock, parentBlockHash } = query

  const ingest = async () => {
    while (!buffer.signal.aborted) {
      if (toBlock != null && fromBlock > toBlock) break

      let requests: Record<number, number> = {}

      const res = await requestStream(
        {
          ...query,
          fromBlock,
          parentBlockHash,
        },
        {
          ...request,
          abort: buffer.signal,
          hooks: {
            onAfterResponse: (_, res) => {
              requests[res.status] = (requests[res.status] || 0) + 1
            },
          },
        },
      )

      // We are on head, we need to wait a little bit until new dta arrives
      if (res.status === 204) {
        await buffer.put({
          blocks: [],
          meta: { bytes: 0, requestedFromBlock: fromBlock, lastBlockReceivedAt: new Date(), requests },
          head: res.head,
        })
        buffer.flush()
        if (headPollInterval > 0) {
          await wait(headPollInterval, buffer.signal)
        }
        continue
      }

      // If data is missing for a particular range,
      // portal responds with 200 status and empty body
      if (res.stream == null) break

      try {
        for await (let data of res.stream) {
          const lastBlockReceivedAt = new Date()
          const blocks: { block: GetBlock<Q>; bytes: number }[] = []
          const requestedFromBlock = fromBlock

          for (let line of data) {
            try {
              const block = JSON.parse(line)

              // Update for next request
              fromBlock = block.header.number + 1
              parentBlockHash = block.header.hash

              // Collect a block and its size
              blocks.push({ block, bytes: line.length })
            } catch (e: any) {
              // FIXME we need to catch JSON parse errors here
              // we hit an incomplete line, we should break and wait for more data
              // we need to find the RC first
              // if (e.message?.includes?.('Unterminated string')) break

              throw e
            }
          }

          const finalizedHead = res.head.finalized?.number

          // Split blocks into finalized and unfinalized
          const [finalizedBlocks, unfinalizedBlocks] = finalizedHead
            ? partition(blocks, ({ block }) => block.header?.number <= finalizedHead)
            : [blocks, []]

          // Push finalized blocks as a batch
          await buffer.put({
            blocks: finalizedBlocks.map((b) => b.block),
            head: res.head,
            meta: {
              bytes: finalizedBlocks.reduce((a, b) => a + b.bytes, 0),
              requestedFromBlock,
              lastBlockReceivedAt,
              requests,
            },
          })

          for (let { block, bytes } of unfinalizedBlocks) {
            await buffer.put(
              {
                blocks: [block],
                head: res.head,
                meta: {
                  bytes,
                  requestedFromBlock,
                  lastBlockReceivedAt,
                  // We flush requests here to avoid double-counting
                  // as we already sent them
                  requests: finalizedBlocks.length > 0 ? {} : requests,
                },
              },
              !batchUnfinalized,
            )
          }

          // Flush after each streaming chunk so unfinalized blocks are not held
          // in the buffer across chunks. This ensures each portal response is
          // delivered to the consumer immediately without waiting for the next
          // finalized batch or stream end.
          buffer.flush()

          requests = {}
        }
      } catch (err) {
        if (buffer.signal.aborted) break
        if (!isStreamAbortedError(err)) {
          throw err
        }
      }
    }
  }

  ingest().then(
    () => buffer.close(),
    (err) => buffer.fail(err),
  )

  return buffer.iterate()
}

function getHeadFromHeaders(headers: HttpResponse['headers']) {
  const finalizedHeadHash = headers.get('X-Sqd-Finalized-Head-Hash')
  const finalizedHeadNumber = headers.get('X-Sqd-Finalized-Head-Number')
  const headNumber = headers.get('X-Sqd-Head-Number')

  return {
    finalized:
      finalizedHeadHash && finalizedHeadNumber
        ? {
            hash: finalizedHeadHash,
            number: parseInt(finalizedHeadNumber, 10),
          }
        : undefined,
    latest: headNumber
      ? {
          number: parseInt(headNumber, 10),
        }
      : undefined,
  }
}

function isStreamAbortedError(err: unknown) {
  if (!(err instanceof Error)) return false

  const code = (err.cause as any)?.code || (err as any).code
  if (!code) return false

  switch (code) {
    // Explicitly canceled via AbortController
    case 'ABORT_ERR':
    // The remote server ended the connection
    // before Node finished reading the response body.
    case 'ERR_STREAM_PREMATURE_CLOSE':
    // The other side hung up unexpectedly
    case 'ECONNRESET':
    // A low-level socket problem —
    // the TCP connection between your app and the remote server failed
    // or behaved unexpectedly.
    case 'UND_ERR_SOCKET':
      return true
    default:
      return false
  }
}
