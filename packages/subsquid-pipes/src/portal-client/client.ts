import { createFuture, Future, unexpectedCase, wait, withErrorContext } from '@subsquid/util-internal'
import { Readable } from 'stream'
import {
  HttpBody,
  HttpClient,
  HttpClientOptions,
  HttpError,
  HttpResponse,
  RequestOptions,
} from '~/http-client/index.js'
import { npmVersion } from '~/version.js'
import { ForkException } from './fork-exception.js'
import { evm, GetBlock, PortalBlock, PortalQuery, Query, solana, substrate } from './query/index.js'

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
  'headers' | 'retryAttempts' | 'retrySchedule' | 'httpTimeout' | 'bodyTimeout' | 'abort'
> & { finalized?: boolean }

export interface PortalStreamOptions {
  request?: Omit<PortalRequestOptions, 'abort'>

  minBytes?: number
  maxBytes?: number
  maxIdleTime?: number
  maxWaitTime?: number

  headPollInterval?: number

  finalized?: boolean
}

export type PortalStreamData<B> = {
  blocks: B[]
  finalizedHead?: BlockRef
  meta: {
    bytes: number
  }
  lastBlockReceivedAt: Date
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
  readonly #finalized: boolean

  private readonly url: URL
  private client: HttpClient
  private readonly headPollInterval: number
  private readonly minBytes: number
  private readonly maxBytes: number
  private readonly maxIdleTime: number
  private readonly maxWaitTime: number

  constructor(options: PortalClientOptions) {
    this.url = new URL(options.url)
    this.#finalized = options.finalized || false
    this.client = options.http instanceof HttpClient ? options.http : new HttpClient(options.http)
    this.headPollInterval = options.headPollInterval ?? 0
    this.minBytes = options.minBytes ?? 10 * 1024 * 1024
    this.maxBytes = options.maxBytes ?? this.minBytes
    this.maxIdleTime = options.maxIdleTime ?? 300
    this.maxWaitTime = options.maxWaitTime ?? 5_000
  }

  getUrl() {
    return this.url.toString()
  }

  private getDatasetUrl(path: string): string {
    let u = new URL(this.url)
    if (this.url.pathname.endsWith('/')) {
      u.pathname += path
    } else {
      u.pathname += '/' + path
    }
    return u.toString()
  }

  async getHead(options?: PortalRequestOptions): Promise<BlockRef | undefined> {
    const res = await this.request(
      'GET',
      this.getDatasetUrl((options?.finalized ?? this.#finalized) ? 'finalized-head' : 'head'),
      options,
    )
    return res.body ?? undefined
  }

  getQuery<Q extends PortalQuery = PortalQuery, R extends PortalBlock = PortalBlock>(
    query: Q,
    options?: PortalRequestOptions,
  ): Promise<R[]> {
    // FIXME: is it needed or it is better to always use stream?
    return this.request<Buffer>(
      'POST',
      this.getDatasetUrl((options?.finalized ?? this.#finalized) ? 'finalized-stream' : `stream`),
      {
        ...options,
        json: query,
      },
    )
      .catch(
        withErrorContext({
          archiveQuery: query,
        }),
      )
      .then((res) => {
        return res.body
          .toString('utf8')
          .trimEnd()
          .split('\n')
          .map((line) => JSON.parse(line))
      })
  }

  getStream<Q extends evm.Query | solana.Query | substrate.Query>(
    query: Q,
    options?: PortalStreamOptions,
  ): PortalStream<GetBlock<Q>> {
    return createPortalStream(query, this.getStreamOptions(options), async (q, o) =>
      this.getStreamRequest((options?.finalized ?? this.#finalized) ? 'finalized-stream' : 'stream', q, o),
    )
  }

  private getStreamOptions(options?: PortalStreamOptions) {
    let {
      headPollInterval = this.headPollInterval,
      minBytes = this.minBytes,
      maxBytes = this.maxBytes,
      maxIdleTime = this.maxIdleTime,
      maxWaitTime = this.maxWaitTime,
      request = {},
      finalized = false,
    } = options ?? {}

    return {
      headPollInterval,
      minBytes,
      maxBytes,
      maxIdleTime,
      maxWaitTime,
      request,
      finalized,
    }
  }

  private async getStreamRequest(path: string, query: PortalQuery, options?: PortalRequestOptions) {
    try {
      let res = await this.request<Readable | undefined>('POST', this.getDatasetUrl(path), {
        ...options,
        json: query,
        stream: true,
      }).catch(withErrorContext({ query }))

      switch (res.status) {
        case 200:
          let finalizedHead = getFinalizedHeadHeader(res.headers)
          let stream = res.body ? splitLines(res.body) : undefined

          return {
            finalizedHead,
            stream,
          }
        case 204:
          return {
            finalizedHead: getFinalizedHeadHeader(res.headers),
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
    return this.client.request<T>(url, {
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
    options?: PortalRequestOptions,
  ) => Promise<{
    finalizedHead?: BlockRef
    stream?: AsyncIterable<string[]> | null | undefined
  }>,
): PortalStream<GetBlock<Q>> {
  const { headPollInterval, request, ...bufferOptions } = options
  const buffer = new PortalStreamBuffer<GetBlock<Q>>(bufferOptions)

  let { fromBlock = 0, toBlock, parentBlockHash } = query

  const ingest = async () => {
    if (buffer.signal.aborted) return

    if (toBlock != null && fromBlock > toBlock) return

    const res = await requestStream(
      {
        ...query,
        fromBlock,
        parentBlockHash,
      },
      {
        ...request,
        abort: buffer.signal,
      },
    )

    const finalizedHead = res.finalizedHead

    // we are on head
    if (!('stream' in res)) {
      await buffer.put({
        blocks: [],
        meta: { bytes: 0 },
        finalizedHead,
        lastBlockReceivedAt: new Date(),
      })
      buffer.flush()
      if (headPollInterval > 0) {
        await wait(headPollInterval, buffer.signal)
      }
      return ingest()
    }

    // no data left on this range
    if (res.stream == null) return

    const iterator = res.stream[Symbol.asyncIterator]()
    try {
      while (true) {
        let data = await iterator.next()
        if (data.done) break

        const lastBlockReceivedAt = new Date()

        let blocks: GetBlock<Q>[] = []
        let bytes = 0

        for (let line of data.value) {
          const block = JSON.parse(line)
          blocks.push(block)
          bytes += line.length

          fromBlock = block.header.number + 1
          parentBlockHash = block.header.hash
        }

        await buffer.put({
          blocks,
          finalizedHead,
          meta: { bytes },
          lastBlockReceivedAt,
        })
      }
    } catch (err) {
      if (buffer.signal.aborted || isStreamAbortedError(err)) {
        // ignore
      } else {
        throw err
      }
    } finally {
      await iterator?.return?.().catch(() => {})
    }

    return ingest()
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
  private takeFuture: Future<void> = createFuture()
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

  async put(data: PortalStreamData<B>) {
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
        meta: { bytes: 0 },
        lastBlockReceivedAt: new Date(),
      }
    }

    this.buffer.blocks.push(...data.blocks)
    this.buffer.finalizedHead = data.finalizedHead
    this.buffer.meta.bytes += data.meta.bytes
    this.buffer.lastBlockReceivedAt = data.lastBlockReceivedAt

    this.putFuture.resolve()

    if (this.buffer.meta.bytes >= this.minBytes) {
      this.readyFuture.resolve()
    }

    if (this.buffer.meta.bytes >= this.maxBytes) {
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

function getFinalizedHeadHeader(headers: HttpResponse['headers']) {
  let finalizedHeadHash = headers.get('X-Sqd-Finalized-Head-Hash')
  let finalizedHeadNumber = headers.get('X-Sqd-Finalized-Head-Number')

  return finalizedHeadHash != null && finalizedHeadNumber != null
    ? {
        hash: finalizedHeadHash,
        number: parseInt(finalizedHeadNumber),
      }
    : undefined
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
