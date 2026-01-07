import { PortalRange, parsePortalRange } from '~/core/portal-range.js'
import { Query } from '~/portal-client/index.js'
import { Heap } from '../internal/heap.js'

/**
 * A range of blocks with inclusive boundaries
 */
export type Range = {
  from: number
  to?: number
}

export type NaturalRange = Range | { from: 'latest'; to?: number }

export interface RangeRequest<Req, R = Range> {
  range: R
  request: Req
}

export type RequestOptions<R> = {
  range: PortalRange
  request: R
}

export type Subset<T, U> = {
  [K in keyof T]: K extends keyof U ? T[K] : never
}

export abstract class QueryBuilder<F extends {}, R = any> {
  protected fields: F = {} as F
  protected requests: RangeRequest<R, NaturalRange>[] = []

  abstract getType(): string
  abstract mergeDataRequests(...requests: R[]): R
  abstract addFields(fields: F): QueryBuilder<F, R>

  getRequests() {
    return this.requests
  }

  getFields() {
    return this.fields
  }

  addRange(range: PortalRange): this {
    this.requests.push({ range: parsePortalRange(range) } as any)
    return this
  }

  merge(query?: QueryBuilder<F, R>) {
    if (!query) return this

    this.requests = [...query.requests, ...this.requests]
    this.addFields(query.getFields())

    return this
  }

  async calculateRanges({
    portal,
    bound,
  }: {
    bound?: Range
    portal: Portal
  }): Promise<{ bounded: RangeRequest<R>[]; raw: RangeRequest<R>[] }> {
    const latest = this.requests.some((r) => r.range.from === 'latest') ? await portal.getHead() : undefined

    const ranges = mergeRangeRequests(
      this.requests.map((r) => ({
        range:
          r.range.from === 'latest'
            ? {
                from: Math.min(latest?.number || 0, bound?.from || Infinity),
              }
            : r.range,
        request: r.request || ({} as R),
      })),
      this.mergeDataRequests,
    )

    if (!ranges.length) {
      // FIXME request should be optional
      return {
        raw: [{ range: { from: 0 } } as any],
        bounded: [{ range: bound || { from: 0 } } as any],
      }
    }

    return {
      raw: ranges,
      bounded: applyRangeBound(ranges, bound),
    }
  }
}

export interface Portal {
  getHead(): Promise<{ number: number; hash: string } | undefined>
}

// TODO generate unit tests for this

/**
 * Merges overlapping range requests into a sorted list of non-overlapping ranges.
 * When ranges overlap, their requests are combined using the provided merge function.
 *
 * @param requests - Array of range requests to merge
 * @param merge - Function to merge two overlapping requests
 * @returns Array of non-overlapping range requests sorted by range.from
 *
 * @example
 * // Merge overlapping log requests
 * const requests = [
 *   { range: { from: 0, to: 100 }, request: { logs: [{address: '0x1'}] } },
 *   { range: { from: 50, to: 150 }, request: { logs: [{address: '0x2'}] } }
 * ]
 *
 * const merged = mergeRangeRequests(requests, mergeDataRequests)
 * // Result:
 * // [
 * //   { range: { from: 0, to: 49 }, request: { logs: [{address: '0x1'}] } },
 * //   { range: { from: 50, to: 100 }, request: { logs: [{address: '0x1'}, {address: '0x2'}] } },
 * //   { range: { from: 101, to: 150 }, request: { logs: [{address: '0x2'}] } }
 * // ]
 *
 * @example
 * // Merge requests with infinite ranges
 * const requests = [
 *   { range: { from: 0 }, request: { logs: [{address: '0x1'}] } },
 *   { range: { from: 100 }, request: { logs: [{address: '0x2'}] } }
 * ]
 *
 * const merged = mergeRangeRequests(requests, mergeDataRequests)
 * // Result:
 * // [
 * //   { range: { from: 0, to: 99 }, request: { logs: [{address: '0x1'}] } },
 * //   { range: { from: 100 }, request: { logs: [{address: '0x1'}, {address: '0x2'}] } }
 * // ]
 */
export function mergeRangeRequests<R>(requests: RangeRequest<R>[], merge: (r1: R, r2: R) => R): RangeRequest<R>[] {
  if (requests.length <= 1) return requests

  let union: RangeRequest<R>[] = []
  let heap = new Heap<RangeRequest<R>>((a, b) => a.range.from - b.range.from)

  heap.init(requests.slice())

  let top = heap.popStrict()
  let req: RangeRequest<R> | undefined = heap.peek()
  while (req) {
    let i = rangeIntersection(top.range, req.range)
    if (i == null) {
      union.push(top)
      top = heap.popStrict()
    } else {
      heap.pop()
      for (let range of rangeDifference(top.range, i)) {
        heap.push({ range, request: top.request })
      }
      for (let range of rangeDifference(req.range, i)) {
        heap.push({ range, request: req.request })
      }
      heap.push({
        range: i,
        request: merge(top.request, req.request),
      })
      top = heap.popStrict()
    }
    req = heap.peek()
  }
  union.push(top)
  return union
}

/**
 * Filters range requests by applying a boundary range and returns only intersecting requests.
 * For requests that partially intersect with the boundary, only the intersecting portion is kept.
 *
 * @param requests - Array of range requests to filter
 * @param range - Optional boundary range to apply. If not provided, returns original requests unmodified.
 * @returns Array of range requests that intersect with the boundary range
 *
 * @example
 * // Filter requests by range boundary
 * const requests = [
 *   { range: { from: 0, to: 100 }, request: { logs: [{address: '0x1'}] } },
 *   { range: { from: 150, to: 200 }, request: { logs: [{address: '0x2'}] } }
 * ]
 *
 * const filtered = applyRangeBound(requests, { from: 50, to: 150 })
 * // Result:
 * // [
 * //   { range: { from: 50, to: 100 }, request: { logs: [{address: '0x1'}] } }
 * // ]
 *
 * @example
 * // Filter requests with infinite ranges
 * const requests = [
 *   { range: { from: 0 }, request: { logs: [{address: '0x1'}] } },
 *   { range: { from: 100 }, request: { logs: [{address: '0x2'}] } }
 * ]
 *
 * const filtered = applyRangeBound(requests, { from: 50, to: 150 })
 * // Result:
 * // [
 * //   { range: { from: 50, to: 150 }, request: { logs: [{address: '0x1'}] } },
 * //   { range: { from: 100, to: 150 }, request: { logs: [{address: '0x2'}] } }
 * // ]
 */
export function applyRangeBound<R>(requests: RangeRequest<R>[], range?: Range): RangeRequest<R>[] {
  if (range == null) return requests
  let result: RangeRequest<R>[] = []
  for (let req of requests) {
    let i = rangeIntersection(range, req.range)
    if (i) {
      result.push({ range: i, request: req.request })
    }
  }
  return result
}

/**
 * Finds the intersection between two ranges. Returns undefined if there is no intersection.
 * If both ranges extend to infinity, the result will also extend to infinity.
 *
 * @param a - First range to intersect
 * @param b - Second range to intersect
 * @returns The intersecting range, or undefined if ranges don't intersect
 *
 * @example
 * // Intersect finite ranges
 * const a = { from: 0, to: 100 }
 * const b = { from: 50, to: 150 }
 * const intersection = rangeIntersection(a, b)
 * // Result: { from: 50, to: 100 }
 *
 * @example
 * // Intersect with infinite range
 * const a = { from: 0 }  // infinite range
 * const b = { from: 100, to: 200 }
 * const intersection = rangeIntersection(a, b)
 * // Result: { from: 100, to: 200 }
 *
 * @example
 * // No intersection case
 * const a = { from: 0, to: 50 }
 * const b = { from: 100, to: 150 }
 * const intersection = rangeIntersection(a, b)
 * // Result: undefined
 */
export function rangeIntersection(a: Range, b: Range): Range | undefined {
  let beg = Math.max(a.from, b.from)
  let end = Math.min(rangeEnd(a), rangeEnd(b))
  if (beg > end) return undefined
  if (end === Number.POSITIVE_INFINITY) {
    return { from: beg }
  }
  return { from: beg, to: end }
}

/**
 * Calculates the difference between two ranges, returning an array of non-intersecting ranges.
 * The difference consists of parts of range 'a' that do not overlap with range 'b'.
 *
 * @param a - The first range to compare
 * @param b - The second range to subtract from the first range
 * @returns Array of ranges representing the non-overlapping parts of range 'a'
 *
 * @example
 * // Get difference between finite ranges
 * const a = { from: 0, to: 100 }
 * const b = { from: 50, to: 75 }
 * const diff = rangeDifference(a, b)
 * // Result:
 * // [
 * //   { from: 0, to: 49 },
 * //   { from: 76, to: 100 }
 * // ]
 *
 * @example
 * // Get difference with infinite range
 * const a = { from: 0 }  // infinite range
 * const b = { from: 50, to: 100 }
 * const diff = rangeDifference(a, b)
 * // Result:
 * // [
 * //   { from: 0, to: 49 },
 * //   { from: 101 }  // infinite range
 * // ]
 *
 * @example
 * // No intersection case
 * const a = { from: 0, to: 50 }
 * const b = { from: 100, to: 150 }
 * const diff = rangeDifference(a, b)
 * // Result:
 * // [
 * //   { from: 0, to: 50 }  // original range 'a' returned unchanged
 * // ]
 */
export function rangeDifference(a: Range, b: Range): Range[] {
  let i = rangeIntersection(a, b)
  if (i == null) return [a]
  let result: Range[] = []
  if (a.from < i.from) {
    result.push({ from: a.from, to: i.from - 1 })
  }
  if (i.to != null && i.to < rangeEnd(a)) {
    let from = i.to + 1
    if (a.to) {
      result.push({ from, to: a.to })
    } else {
      result.push({ from })
    }
  }
  return result
}

export function rangeEnd(range: Range): number {
  return range.to ?? Number.POSITIVE_INFINITY
}

export function concatQueryLists<T extends object>(a?: T[], b?: T[]): T[] | undefined {
  let result = [...(a || []), ...(b || [])]
  return result.length ? result : undefined
}

export async function hashQuery(query: Query): Promise<string> {
  /**
   *  We use a hash of the query (excluding fromBlock and toBlock) as a unique identifier
   *  to store and retrieve cached data.
   *  This ensures that different queries are cached separately
   *  and can be efficiently retrieved based on their specific parameters.
   */
  const { fromBlock, toBlock, parentBlockHash, ...unique } = query

  return await sha256Hex(JSON.stringify(unique))
}

/** UTF-8 encode a JS string to ArrayBuffer. */
export function stringToArrayBuffer(str: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(str)
  }

  throw new Error(
    'TextEncoder is not supported in this environment. Please ensure you are running in a modern JavaScript environment that supports TextEncoder (Node.js 11+, modern browsers, or include a polyfill).',
  )
}

async function sha256Hex(data: string): Promise<string> {
  // globalThis.crypto is available in browsers, Node 18+, and Cloudflare Workers
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error(
      'crypto.subtle is not supported in this environment. Please ensure you are running in a modern JavaScript environment that supports crypto.subtle (Node.js 18+, modern browsers, or include a polyfill).',
    )
  }
  const d = await crypto.subtle.digest('SHA-256', stringToArrayBuffer(data))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
