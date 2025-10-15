import { addErrorContext, ensureError, wait } from '@subsquid/util-internal'
import { addTimeout } from '@subsquid/util-timeout'

import { type Logger, createDefaultLogger } from '~/core/logger.js'
import type { HttpBody } from './body.js'

export type { HttpBody }

const USER_AGENT = 'sqd-core/http-client (sqd.ai)'

export type HeadersInit = string[][] | Record<string, string | readonly string[]> | Headers

export interface HttpClientOptions {
  baseUrl?: string
  headers?: Record<string, string | number | bigint>
  /**
   * Default request timeout in milliseconds.
   *
   * This timeout is only related to individual http requests.
   * Overall request processing time might be much larger due to retries.
   */
  httpTimeout?: number
  bodyTimeout?: number
  retryAttempts?: number
  retrySchedule?: number[]
  keepalive?: boolean

  log?: Logger | null
}

export interface RequestOptions {
  method?: string
  query?: Record<string, string | number | bigint>
  headers?: HeadersInit
  retryAttempts?: number
  retrySchedule?: number[]
  httpTimeout?: number
  bodyTimeout?: number
  abort?: AbortSignal
  stream?: boolean
  keepalive?: boolean
}

export interface FetchRequest extends RequestInit {
  id: number
  url: string
  headers: Headers
  timeout?: number
  bodyTimeout?: number
  signal?: AbortSignal
  stream?: boolean
}

export interface BaseHttpClient {
  request<T>(url: string, options?: RequestOptions & HttpBody): Promise<HttpResponse<T>>
}

export class HttpClient implements BaseHttpClient {
  protected log?: Logger
  protected headers?: Record<string, string | number | bigint>
  private baseUrl?: string
  private retrySchedule: number[]
  private retryAttempts: number
  private httpTimeout: number
  private bodyTimeout?: number
  private requestCounter = 0
  private keepalive?: boolean

  constructor(options: HttpClientOptions = {}) {
    this.log = options.log == null ? createDefaultLogger().child({ module: 'http-client' }) : options.log
    this.headers = options.headers
    this.setBaseUrl(options.baseUrl)
    this.retrySchedule = options.retrySchedule || [10, 100, 500, 2000, 10000, 20000]
    this.retryAttempts = options.retryAttempts || 0
    this.httpTimeout = options.httpTimeout ?? 20000
    this.bodyTimeout = options.bodyTimeout
    this.keepalive = options.keepalive
  }

  async get<T = any>(url: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    const res = await this.request(url, { ...options, method: 'put' })
    return res.body
  }

  async post<T = any>(url: string, options?: Omit<RequestOptions, 'method'> & HttpBody): Promise<T> {
    const res = await this.request(url, { ...options, method: 'put' })
    return res.body
  }

  async request<T = any>(url: string, options: RequestOptions & HttpBody = {}): Promise<HttpResponse<T>> {
    let req = await this.prepareRequest(url, options)

    this.beforeRequest(req)

    let retryAttempts = options.retryAttempts ?? this.retryAttempts
    let retrySchedule = options.retrySchedule ?? this.retrySchedule
    let retries = 0

    while (true) {
      let res: HttpResponse | Error = await this.performRequestWithTimeout(req).catch(ensureError)
      if (res instanceof Error || !res.ok) {
        if (retryAttempts > retries && isRetryableError(res, req)) {
          let pause = asRetryAfterPause(res)
          if (pause == null) {
            pause = retrySchedule[Math.min(retries, retrySchedule.length - 1)] ?? 1000
          }
          retries += 1
          this.beforeRetryPause(req, res, pause)
          await wait(pause, req.signal)
        } else if (res instanceof Error) {
          throw addErrorContext(res, { httpRequestId: req.id })
        } else {
          throw new HttpError(res)
        }
      } else {
        return res
      }
    }
  }

  protected beforeRequest(req: FetchRequest): void {
    if (this.log?.isLevelEnabled('debug')) {
      this.log.debug(
        {
          httpRequestId: req.id,
          httpRequestUrl: req.url,
          httpRequestMethod: req.method,
          httpRequestHeaders: Array.from(req.headers),
          httpRequestBody: req.body,
        },
        'http request',
      )
    }
  }

  protected beforeRetryPause(req: FetchRequest, reason: Error | HttpResponse, pause: number): void {
    if (this.log?.isLevelEnabled('warn')) {
      let info: any = {
        httpRequestId: req.id,
        httpRequestUrl: req.url,
        httpRequestMethod: req.method,
        httpRequestBody: req.body,
      }
      if (reason instanceof Error) {
        info.reason = reason.toString()
      } else {
        info.reason = `got ${reason.status}`
        info.httpResponseUrl = reason.url
        info.httpResponseStatus = reason.status
        info.httpResponseHeaders = Array.from(reason.headers)
        info.httpResponseBody = reason.body
      }
      this.log.warn(info, `request will be retried in ${pause} ms`)
    }
  }

  protected afterResponseHeaders(req: FetchRequest, url: string, status: number, headers: Headers): void {
    if (this.log?.isLevelEnabled('debug')) {
      this.log.debug(
        {
          httpRequestId: req.id,
          httpResponseUrl: url,
          httpResponseStatus: status,
          httpResponseHeaders: Array.from(headers),
        },
        'http headers',
      )
    }
  }

  protected afterResponse(req: FetchRequest, res: HttpResponse): void {
    if (!res.stream && this.log?.isLevelEnabled('debug')) {
      let httpResponseBody: any = res.body
      if (typeof res.body === 'string' || res.body instanceof Uint8Array) {
        if (res.body.length > 1024 * 1024) {
          httpResponseBody = '...body is too long to be logged'
        }
      }
      this.log.debug(
        {
          httpRequestId: req.id,
          httpResponseBody,
        },
        'http body',
      )
    }
  }

  protected async prepareRequest(url: string, options: RequestOptions & HttpBody): Promise<FetchRequest> {
    let req: FetchRequest = {
      id: this.requestCounter++,
      method: options.method,
      headers: new Headers(options.headers),
      url: this.getAbsUrl(url),
      signal: options.abort,
      timeout: options.httpTimeout ?? this.httpTimeout,
      bodyTimeout: options.bodyTimeout ?? this.bodyTimeout,
      stream: options.stream,
      keepalive: options.keepalive ?? this.keepalive,
    }

    this.handleBasicAuth(req)

    if (options.query) {
      let qs = new URLSearchParams(options.query as any).toString()
      if (req.url.includes('?')) {
        req.url += `&${qs}`
      } else {
        req.url += `?${qs}`
      }
    }

    if (!req.headers.has('user-agent')) {
      req.headers.set('user-agent', USER_AGENT)
    }

    if (options.content !== undefined) {
      if (typeof options.content === 'string') {
        req.body = options.content
        if (!req.headers.has('content-type')) {
          req.headers.set('content-type', 'text/plain')
        }
      } else {
        req.body = options.content
      }
    }

    if (options.json !== undefined) {
      req.body = JSON.stringify(options.json)
      if (!req.headers.has('content-type')) {
        req.headers.set('content-type', 'application/json')
      }
    }

    for (let name in this.headers) {
      if (!req.headers.has(name)) {
        req.headers.set(name, `${this.headers[name]}`)
      }
    }

    return req
  }

  private handleBasicAuth(req: FetchRequest): void {
    let u = new URL(req.url)
    if (u.username || u.password) {
      req.headers.set('Authorization', `Basic ${btoa(`${u.username}:${u.password}`)}`)
      u.username = ''
      u.password = ''
      req.url = u.toString()
    }
  }

  private async performRequestWithTimeout(req: FetchRequest): Promise<HttpResponse> {
    if (!req.timeout) return this.performRequest(req)

    let ac = new AbortController()

    function abort() {
      ac.abort()
    }

    req.signal?.addEventListener('abort', abort)

    let timer: any | null = setTimeout(() => {
      timer = null
      abort()
    }, req.timeout)

    let res: HttpResponse | undefined
    try {
      res = await this.performRequest({ ...req, signal: ac.signal })
      return res
    } catch (err: any) {
      if (timer == null) {
        throw new HttpTimeoutError(req.timeout)
      }
      throw err
    } finally {
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', abort)
    }
  }

  private async performRequest(req: FetchRequest): Promise<HttpResponse> {
    let res = await fetch(req.url, req)
    this.afterResponseHeaders(req, res.url, res.status, res.headers)
    let body = await this.handleResponseBody(req, res)
    let httpResponse = new HttpResponse(req.id, res.url, res.status, res.headers, body, body instanceof ReadableStream)
    this.afterResponse(req, httpResponse)
    return httpResponse
  }

  protected async handleResponseBody(req: FetchRequest, res: Response): Promise<any> {
    let contentType = (res.headers.get('content-type') || '').split(';')[0]

    if (req.bodyTimeout != null && res.body != null) {
      let body = addStreamTimeout(res.body, req.bodyTimeout, () => new HttpBodyTimeoutError(req.bodyTimeout ?? 0))
      res = new Response(body, res)
    }

    if (req.stream && res.ok && res.body != null) {
      return res.body
    }

    if (contentType === 'application/json') {
      return res.json()
    }

    if (contentType?.startsWith('text/')) {
      return res.text()
    }

    let arrayBuffer = await res.arrayBuffer()
    if (arrayBuffer.byteLength === 0) return undefined
    return arrayBuffer
  }

  private geTQueryUrlAndAuth(url: string): { url: string; basic?: string } {
    let u = new URL(this.getAbsUrl(url))
    if (u.username || u.password) {
      let basic = btoa(`${u.username}:${u.password}`)
      u.username = ''
      u.password = ''
      return { url: u.toString(), basic }
    }

    return { url: u.toString() }
  }

  getAbsUrl(url: string): string {
    if (!this.baseUrl) return url
    if (url.includes('://')) return url
    if (url === '/') return this.baseUrl
    if (url[0] === '/') return this.baseUrl + url
    return `${this.baseUrl}/${url}`
  }

  private setBaseUrl(url?: string): void {
    if (url) {
      let u = new URL(url)
      u.hash = ''
      u.search = ''
      url = u.toString()
      if (url.endsWith('/')) {
        url = url.slice(0, url.length - 1)
      }
      this.baseUrl = url
    } else {
      this.baseUrl = undefined
    }
  }
}

export class HttpResponse<T = any> {
  constructor(
    public readonly requestId: number,
    public readonly url: string,
    public readonly status: number,
    public readonly headers: Headers,
    public readonly body: T,
    public readonly stream: boolean,
  ) {}

  get ok(): boolean {
    return this.status >= 200 && this.status < 300
  }

  assert(): void {
    if (this.ok) return
    throw new HttpError(this)
  }

  toJSON() {
    return {
      status: this.status,
      headers: Array.from(this.headers),
      body: this.stream ? undefined : this.body,
      url: this.url,
    }
  }
}

export class HttpError extends Error {
  constructor(public readonly response: HttpResponse) {
    super(`Got ${response.status} from ${response.url}`)
  }

  override get name(): string {
    return 'HttpError'
  }
}

export class HttpTimeoutError extends Error {
  constructor(public readonly ms: number) {
    super(`request timed out after ${ms} ms`)
  }

  override get name(): string {
    return 'HttpTimeoutError'
  }
}

export class HttpBodyTimeoutError extends Error {
  constructor(ms: number) {
    super(`request body timed out after ${ms} ms`)
  }

  override get name(): string {
    return 'HttpBodyTimeoutError'
  }
}

function isRetryableError(error: HttpResponse | Error, req?: FetchRequest): boolean {
  if (isHttpConnectionError(error)) return true
  if (error instanceof HttpTimeoutError) return true
  if (error instanceof HttpError) {
    error = error.response
  }
  if (error instanceof HttpResponse) {
    switch (error.status) {
      case 429:
      case 500:
      case 502:
      case 503:
      case 504:
      case 524:
        return true
      default:
        return error.headers.has('retry-after')
    }
  }
  return false
}

export function asRetryAfterPause(res: HttpResponse | Error): number | undefined {
  if (res instanceof HttpError) {
    res = res.response
  }
  if (res instanceof HttpResponse) {
    let retryAfter = res.headers.get('retry-after')
    if (retryAfter == null) return undefined
    if (/^\d+$/.test(retryAfter)) return Number.parseInt(retryAfter, 10) * 1000
    if (HTTP_DATE_REGEX.test(retryAfter)) return Math.max(0, new Date(retryAfter).getTime() - Date.now())
  }

  return undefined
}

const HTTP_DATE_REGEX =
  /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), (\d{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) (\d{2}):(\d{2}):(\d{2}) GMT$/

// ref: https://github.com/sindresorhus/is-network-error/blob/main/index.js
const errorMessages = new Set([
  'network error', // Chrome
  'failed to fetch', // Chrome
  'networkerror when attempting to fetch resource.', // Firefox
  'the internet connection appears to be offline.', // Safari 16
  'load failed', // Safari 17+
  'network request failed', // `cross-fetch`
  'fetch failed', // Undici (Node.js)
  'terminated', // Undici (Node.js)
])

export function isHttpConnectionError(error: unknown) {
  if (error instanceof TypeError) {
    if (error.message === 'Load failed') {
      return error.stack === undefined
    }
    return errorMessages.has(error.message.toLowerCase())
  }
  return false
}

function addStreamTimeout<T>(
  stream: ReadableStream<T>,
  ms: number,
  onTimeout?: () => Error | undefined | void,
): ReadableStream<T> {
  if (!ms) return stream

  let reader = stream.getReader()
  return new ReadableStream({
    pull: async (c) => {
      try {
        let data = await addTimeout(reader.read(), ms, onTimeout)

        if (data.done) {
          c.close()
        } else {
          c.enqueue(data.value)
        }
      } catch (e) {
        c.error(e)
        await reader.cancel()
      }
    },
    cancel: async (reason) => {
      await reader.cancel(reason)
    },
  })
}

// aquestic
