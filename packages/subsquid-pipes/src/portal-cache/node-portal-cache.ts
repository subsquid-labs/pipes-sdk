import { promisify } from 'node:util'
import zlib from 'node:zlib'
import { BlockCursor, cursorFromHeader, Logger } from '~/core/index.js'
import { hashQuery } from '../core/query-builder.js'
import { last } from '../internal/array.js'
import { GetBlock, Portal, PortalStream, PortalStreamData, Query } from '../portal-client/index.js'

// @ts-ignore
const compressAsync = promisify('zstdCompress' in zlib ? (zlib.zstdCompress as any) : zlib.gzip)
// @ts-ignore
const decompressAsync = promisify('zstdDecompress' in zlib ? (zlib.zstdDecompress as any) : zlib.gunzip)

export type SaveBatch = { queryHash: string; cursors: { first: BlockCursor; last: BlockCursor }; data: Buffer }
export type StreamBatch = { queryHash: string; fromBlock: number }

const PortalCacheInitMissing = new Error('Portal is not initialized. Call init() method before using the cache')

export type Options<ImplOptions> = {
  /**
   * Enable or disable data compression.
   * Uses zstd compression algorithm.
   * @default true
   */
  compress?: boolean
} & ImplOptions

export abstract class PortalCacheNodeJs<ImplOptions> implements Portal {
  protected readonly options: Options<ImplOptions>
  protected portal?: Portal
  protected logger?: Logger

  protected abstract stream(request: StreamBatch): AsyncIterable<Buffer>
  protected abstract save(batch: SaveBatch): Promise<void>
  protected constructor(options: Options<ImplOptions>) {
    this.options = {
      compress: true,
      ...options,
    }
  }

  init(portal: Portal) {
    this.portal = portal
    // Assign child logger
    this.logger = this.portal.getLogger()?.child({ module: 'portal-cache' })

    return this
  }

  getLogger() {
    return this.logger
  }

  getUrl() {
    if (!this.portal) throw PortalCacheInitMissing

    return this.portal.getUrl()
  }

  getHead() {
    if (!this.portal) throw PortalCacheInitMissing

    return this.portal.getHead()
  }

  protected async compress(value: string): Promise<Buffer> {
    if (!this.options.compress) return Buffer.from(value)

    return await compressAsync(value)
  }

  protected async decompress(value: Buffer): Promise<string> {
    if (!this.options.compress) return value.toString('utf-8')

    const buffer = await decompressAsync(value)
    return buffer.toString('utf8')
  }

  async *getStream<Q extends Query>(query: Q): PortalStream<GetBlock<Q>> {
    if (!this.portal) throw PortalCacheInitMissing

    const queryHash = await hashQuery(query)

    let cursor: BlockCursor = { number: query.fromBlock, hash: query.parentBlockHash }

    this.logger?.debug(`loading data from cache from ${cursor.number} block`)
    let first = false
    const fromBlock = cursor.number + 1

    for await (const message of this.stream({
      fromBlock,
      queryHash,
    })) {
      const decoded: PortalStreamData<GetBlock<Q>> = JSON.parse(await this.decompress(message))
      if (!first) {
        if (decoded.blocks[0]?.header.number !== fromBlock) {
          this.logger?.debug(`cache miss at ${cursor.number} block, switching to portal`)
          break
        }
        first = true
      }

      yield decoded

      cursor = cursorFromHeader(last(decoded.blocks))
    }

    if (cursor.number === query.toBlock) return

    this.logger?.debug(`switching to the portal from ${cursor.number} block`)

    for await (const batch of this.portal.getStream({
      ...query,
      fromBlock,
      parentBlockHash: cursor.hash,
    } as Q)) {
      const finalizedHead = batch.finalizedHead?.number
      if (!finalizedHead) continue

      const blocks = batch.blocks.filter((b) => b.header.number <= finalizedHead)
      if (blocks.length === 0) continue

      cursor = cursorFromHeader(last(blocks))

      await this.save({
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
