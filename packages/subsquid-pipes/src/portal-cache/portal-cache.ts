import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { BlockCursor, cursorFromHeader, Logger } from '~/core/index.js'
import { hashQuery } from '../core/query-builder.js'
import { last } from '../internal/array.js'
import { GetBlock, PortalClient, PortalStream, PortalStreamData, Query } from '../portal-client/index.js'

// @ts-ignore
const compressAsync = promisify('zstdCompress' in zlib ? (zlib.zstdCompress as any) : zlib.gzip)
// @ts-ignore
const decompressAsync = promisify('zstdDecompress' in zlib ? (zlib.zstdDecompress as any) : zlib.gunzip)

export type SaveBatch = { queryHash: string; cursors: { first: BlockCursor; last: BlockCursor }; data: Buffer }

export interface PortalCacheAdapter {
  init?(): Promise<void>
  stream(request: { queryHash: string; cursor: BlockCursor }): AsyncIterable<Buffer>
  save(batch: SaveBatch): Promise<void>
}

/**
 * Configuration options for the Portal Cache system
 */
export interface PortalCacheOptions {
  /**
   * Enable or disable data compression.
   * Uses zstd compression algorithm.
   * @default true
   */
  compress?: boolean
  /**
   * Storage adapter implementation for caching portal data
   */
  adapter: PortalCacheAdapter
}

interface Options extends PortalCacheOptions {
  portal: PortalClient
  query: Query
  logger: Logger
}

class CacheBuffer {
  #buffer: string[] = []
  #size = 0

  add(str: any) {
    const serialized = JSON.stringify(str)
    this.#buffer.push(serialized)
    this.#size += serialized.length

    return this.#size
  }

  flush() {
    const buffer = this.#buffer.join('')
    this.#buffer = []
    this.#size = 0

    return buffer
  }
}

class PortalCache {
  private readonly options: Options

  #buffer = new CacheBuffer()

  constructor(options: Options) {
    this.options = {
      compress: true,
      ...options,
    }
  }

  async compress(value: string): Promise<Buffer> {
    if (!this.options.compress) return Buffer.from(value)

    return await compressAsync(value)
  }

  async decompress(value: Buffer): Promise<string> {
    if (!this.options.compress) return value.toString('utf-8')

    const buffer = await decompressAsync(value)
    return buffer.toString('utf8')
  }

  // async buffer(value: any): Promise<void> {
  //  const size = this.#buffer.add(value)
  //   if (size < 1_000_000) {
  //     await adapter.save({
  //       queryHash,
  //       cursors: {
  //         first: cursorFromHeader(batch.blocks[0]),
  //         last: cursor,
  //       },
  //       data: await this.compress(JSON.stringify(batch)),
  //     })
  //   }
  // }

  async *getStream<Q extends Query>(): PortalStream<GetBlock<Q>> {
    const { query, portal, logger, adapter } = this.options
    const queryHash = await hashQuery(query)

    let cursor: BlockCursor = { number: query.fromBlock, hash: query.parentBlockHash }

    logger.debug(`loading data from cache from ${cursor.number} block`)
    for await (const message of adapter.stream({ cursor, queryHash })) {
      const decoded: PortalStreamData<GetBlock<Q>> = JSON.parse(await this.decompress(message))
      yield decoded

      cursor = cursorFromHeader(last(decoded.blocks))
    }

    if (cursor.number === query.toBlock) return

    logger.debug(`switching to the portal from ${cursor.number} block`)
    for await (const batch of portal.getStream({
      ...query,
      fromBlock: cursor.number + 1,
      parentBlockHash: cursor.hash,
    } as Q)) {
      const finalizedHead = batch.finalizedHead?.number
      if (!finalizedHead) return

      const blocks = batch.blocks.filter((b) => b.header.number <= finalizedHead)
      if (blocks.length === 0) continue

      cursor = cursorFromHeader(last(blocks))

      await adapter.save({
        queryHash,
        cursors: {
          first: cursorFromHeader(blocks[0]),
          last: cursor,
        },
        data: await this.compress(
          JSON.stringify({
            ...batch,
            blocks,
          }),
        ),
      })

      yield batch

      // TODO check next batch in cache
    }
  }
}

export async function createPortalCache(opts: Options) {
  const cache = new PortalCache(opts)

  await opts.adapter.init?.()

  return cache.getStream()
}
