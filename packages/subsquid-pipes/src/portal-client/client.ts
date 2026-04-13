import { Readable } from 'stream'

import { Future, createFuture, unexpectedCase, wait, withErrorContext } from '@subsquid/util-internal'

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
   * Minimum number of bytes to return.
   * @default 10_485_760 (10MB)
   */
  minBytes?: number

  /**
   * Maximum number of bytes to return.
   * @default minBytes
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
  minBytes?: number
  maxBytes?: number
  maxIdleTime?: number
  maxWaitTime?: number
  headPollInterval?: number
  finalized?: boolean
}

type PortalHead = {
  finalized?: BlockRef
  latest?: { number: number }
}

export type PortalStreamData<B> = {
  blocks: B[]
  head: PortalHead
  meta: {
    bytes: number
    requestedFromBlock: number
    lastBlockReceivedAt: Date
    requests: Record<number, number>
  }
}

export interface PortalStream<B> extends AsyncIterable<PortalStreamData<B>> {}

export type BlockRef = {
  hash: string
  number: number
}

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
      minBytes: options.minBytes ?? 10 * 1024 * 1024,
      maxBytes: options.maxBytes ?? options.minBytes ?? 10 * 1024 * 1024,
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

  async getMetadata(options?: PortalRequestOptions): Promise<{
    dataset: string
    aliases: string[]
    real_time: boolean
    start_block: number
  }> {
    const res = await this.request('GET', this.getDatasetUrl('metadata'), options)

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
  const { headPollInterval, request, ...bufferOptions } = options
  const buffer = new PortalStreamBuffer<GetBlock<Q>>(bufferOptions)

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
              true,
            )
          }

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

class PortalStreamBuffer<B> {
  private buffer: PortalStreamData<B> | undefined
  private state: 'pending' | 'ready' | 'failed' | 'closed' = 'pending'
  private error: unknown

  private readyFuture: Future<void> = createFuture()
  // Signals that data has been taken and more can be put
  private takeFuture: Future<void> = createFuture()
  // Signals that data has been put and can be taken
  private putFuture: Future<void> = createFuture()

  private idleTimeout: ReturnType<typeof setTimeout> | undefined
  private waitTimeout: ReturnType<typeof setTimeout> | undefined

  private minBytes: number
  private maxBytes: number
  private maxIdleTime: number
  private maxWaitTime: number

  private abortController = new AbortController()

  get signal() {
    return this.abortController.signal
  }

  constructor(options: {
    maxWaitTime: number
    maxBytes: number
    maxIdleTime: number
    minBytes: number
  }) {
    this.maxWaitTime = options.maxWaitTime
    this.minBytes = options.minBytes
    this.maxBytes = Math.max(options.maxBytes, options.minBytes)
    this.maxIdleTime = options.maxIdleTime
  }

  async take(): Promise<PortalStreamData<B> | undefined> {
    if (this.state === 'pending') {
      this.waitTimeout = setTimeout(() => this._ready(), this.maxWaitTime)
    }

    await Promise.all([this.readyFuture.promise(), this.putFuture.promise()])

    if (this.waitTimeout != null) {
      clearTimeout(this.waitTimeout)
      this.waitTimeout = undefined
    }

    const result = this.buffer
    this.buffer = undefined

    switch (this.state) {
      case 'failed':
        if (result != null) return result
        throw this.error
      case 'closed':
        return result
      default:
        if (result == null) {
          throw new Error('Buffer is empty')
        }
        this.takeFuture.resolve()
        this._reset()
        return result
    }
  }

  async put(data: PortalStreamData<B>, flushImmediate = false): Promise<void> {
    if (this.state === 'closed' || this.state === 'failed') {
      throw new Error('Buffer is closed')
    }

    if (this.idleTimeout != null) {
      clearTimeout(this.idleTimeout)
      this.idleTimeout = undefined
    }

    if (this.buffer == null) {
      this.buffer = {
        blocks: [],
        head: {},
        meta: {
          bytes: 0,
          lastBlockReceivedAt: new Date(),
          requestedFromBlock: Infinity,
          requests: {},
        },
      }
    }

    this.buffer.blocks.push(...data.blocks)
    this.buffer.head = data.head
    this.buffer.meta.bytes += data.meta.bytes
    this.buffer.meta.requests = mergeRequests(this.buffer.meta.requests, data.meta.requests)
    this.buffer.meta.requestedFromBlock = Math.min(this.buffer.meta.requestedFromBlock, data.meta.requestedFromBlock)
    this.buffer.meta.lastBlockReceivedAt = data.meta.lastBlockReceivedAt

    this.putFuture.resolve()

    if (flushImmediate || this.buffer.meta.bytes >= this.minBytes) {
      this.readyFuture.resolve()
    }

    if (flushImmediate || this.buffer.meta.bytes >= this.maxBytes) {
      await this.takeFuture.promise()
    }

    if (this.state === 'pending') {
      this.idleTimeout = setTimeout(() => this._ready(), this.maxIdleTime)
    }
  }

  flush() {
    if (this.buffer == null) return
    this._ready()
  }

  close() {
    if (this.state === 'closed' || this.state === 'failed') return
    this.state = 'closed'
    this._cleanup()
  }

  fail(err: any) {
    if (this.state === 'closed' || this.state === 'failed') return
    this.state = 'failed'
    this.error = err
    this._cleanup()
  }

  iterate() {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<PortalStreamData<B>> => {
        return {
          next: async (): Promise<IteratorResult<PortalStreamData<B>>> => {
            const value = await this.take()
            if (value == null) {
              return { done: true, value: undefined }
            }
            return { done: false, value }
          },
          return: async (): Promise<IteratorResult<PortalStreamData<B>>> => {
            this.close()
            return { done: true, value: undefined }
          },
          throw: async (error?: any): Promise<IteratorResult<PortalStreamData<B>>> => {
            this.fail(error)
            throw error
          },
        }
      },
    }
  }

  private _reset() {
    this.readyFuture = createFuture()
    this.putFuture = createFuture()
    this.takeFuture = createFuture()
    this.state = 'pending'
  }

  private _ready() {
    if (this.state === 'pending') {
      this.state = 'ready'
      this.readyFuture.resolve()
    }
    if (this.idleTimeout != null) {
      clearTimeout(this.idleTimeout)
      this.idleTimeout = undefined
    }
    if (this.waitTimeout != null) {
      clearTimeout(this.waitTimeout)
      this.waitTimeout = undefined
    }
  }

  private _cleanup() {
    if (this.idleTimeout != null) {
      clearTimeout(this.idleTimeout)
      this.idleTimeout = undefined
    }
    if (this.waitTimeout != null) {
      clearTimeout(this.waitTimeout)
      this.waitTimeout = undefined
    }
    this.readyFuture.resolve()
    this.putFuture.resolve()
    this.takeFuture.resolve()
    this.abortController.abort()
  }
}

export async function* splitLines(chunks: AsyncIterable<Uint8Array>) {
  const splitter = new LineSplitter()

  for await (let chunk of chunks) {
    const lines = splitter.push(chunk)
    if (lines.length) {
      yield lines
    }
  }

  const lastLine = splitter.end()
  if (lastLine) {
    yield [lastLine]
  }
}

class LineSplitter {
  private decoder = new TextDecoder('utf-8')
  private line = ''

  push(data: Uint8Array): string[] {
    let s = this.decoder.decode(data)
    if (!s) return []

    let lines = s.split('\n')
    if (lines.length === 1) {
      this.line += lines[0]
    } else {
      lines[0] = this.line + lines[0]
      this.line = lines.pop() || ''

      return lines.filter((l) => l)
    }

    return []
  }

  end(): string | undefined {
    if (this.line) return this.line

    return
  }
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

function mergeRequests(a: Record<number, number>, b: Record<number, number>) {
  for (let code in b) {
    if (a[code] == null) {
      a[code] = 0
    }

    a[code] += b[code]
  }

  return a
}
