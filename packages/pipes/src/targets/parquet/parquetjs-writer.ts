import type { WriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'

import type { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'

import type { ParquetEngine } from './engine.js'
import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { openWriteStream } from './fs-durable.js'
import { loadParquetjs } from './parquetjs-engine.js'
import { buildRowWrapper, toParquetSchemaShape } from './parquetjs-schema.js'
import { type PublishedSegment, type SegmentWriter, finalizeSegmentFile, nextTmpPath } from './segment.js'

type Row = Record<string, unknown>

/**
 * The default engine: writes segments with `@dsnp/parquetjs` on the JS thread. Requires the
 * optional peer dependency `@dsnp/parquetjs`, loaded lazily on the first segment open.
 *
 * Per-table state compiled once and shared by every segment of that table: the library
 * schema (lazily, so merely constructing the engine never touches the optional dependency)
 * and the LIST row wrapper.
 */
export function parquetjsEngine(): ParquetEngine {
  return {
    name: 'parquetjs',
    table(table, context) {
      const shape = toParquetSchemaShape(table, context.codec)
      const wrapRow = buildRowWrapper(table.schema)
      let schema: Promise<ParquetSchema> | undefined
      const getSchema = () => (schema ??= loadParquetjs().then((api) => new api.ParquetSchema(shape)))

      return {
        createSegment: () =>
          new ParquetSegmentWriter({
            dir: context.dir,
            schema: getSchema,
            rowGroupSize: context.rowGroupSize,
            wrapRow,
          }),
      }
    },
  }
}

export type ParquetjsSegmentWriterOptions = {
  /** The table's directory: `<baseDir>/<table>`. Created by the state layer before writes. */
  dir: string
  /** Returns the (per-table cached) compiled library schema; first awaited on segment open. */
  schema: () => Promise<ParquetSchema>
  /** Rows per row group — the "split size" that bounds the writer's in-memory buffer. */
  rowGroupSize: number
  /** Rewrites plain-array LIST cells into the library's `{ list: [{ element }] }` row shape.
   * `undefined` for LIST-free tables (zero-copy path). */
  wrapRow?: (row: Row) => Row
}

/**
 * Wraps a single open `ParquetWriter` writing **one** output file (a "segment") for one table.
 *
 * The underlying file is **lazy-opened on the first `appendRow`** — which is also where the
 * optional `@dsnp/parquetjs` dependency is first loaded — so a table that receives no rows in
 * a checkpoint window never creates a degenerate empty `.parquet` file. The writer tracks the
 * block range and row count it has seen, exposes the growing temp file size for byte-based
 * rotation, and publishes atomically:
 *
 *   `close()` (footer) → fsync file → atomic `rename` temp → `<dir>/<min>-<max>.parquet` → fsync dir
 *
 * A published file is immutable and contains only finalized rows, so it is never rewritten.
 */
export class ParquetSegmentWriter implements SegmentWriter {
  readonly #dir: string
  readonly #getSchema: () => Promise<ParquetSchema>
  readonly #rowGroupSize: number
  readonly #wrapRow: ((row: Row) => Row) | undefined
  readonly #tmpPath: string

  #writer: ParquetWriter | undefined
  // We own the underlying stream (rather than ParquetWriter.openFile owning it) so the error path
  // can force the fd shut — ParquetWriter.close() flips `closed` first and never reaches the
  // stream's close() if a footer write throws, which would otherwise leak the descriptor.
  #stream: WriteStream | undefined
  #rowCount = 0
  #minBlock: number | undefined
  #maxBlock: number | undefined
  #closed = false

  constructor(options: ParquetjsSegmentWriterOptions) {
    this.#dir = options.dir
    this.#getSchema = options.schema
    this.#rowGroupSize = options.rowGroupSize
    this.#wrapRow = options.wrapRow
    this.#tmpPath = nextTmpPath(options.dir)
  }

  /** Whether the underlying file has been opened (i.e. at least one row was appended). */
  get isOpen(): boolean {
    return this.#writer !== undefined
  }

  get rowCount(): number {
    return this.#rowCount
  }

  get minBlock(): number | undefined {
    return this.#minBlock
  }

  get maxBlock(): number | undefined {
    return this.#maxBlock
  }

  /**
   * Appends one row, lazy-opening the temp file on first use. `blockNumber` is tracked
   * separately (not re-read from the row) so range naming stays correct regardless of the
   * declared block column's encoding.
   */
  async appendRow(row: Row, blockNumber: number): Promise<void> {
    if (!this.#writer) {
      // Load the library and compile the schema BEFORE opening the stream, so a missing
      // optional dependency never leaks a file descriptor or an empty temp file.
      const [api, schema] = await Promise.all([loadParquetjs(), this.#getSchema()])
      const stream = await openWriteStream(this.#tmpPath)
      try {
        this.#writer = await api.ParquetWriter.openStream(schema, stream, { rowGroupSize: this.#rowGroupSize })
        this.#stream = stream
      } catch (error) {
        // openStream writes the header immediately; if that throws, the stream we just opened
        // would leak — force it shut before propagating.
        stream.destroy()
        throw error
      }
    }

    await this.#writer.appendRow(this.#wrapRow ? this.#wrapRow(row) : row)

    this.#rowCount++
    if (this.#minBlock === undefined || blockNumber < this.#minBlock) this.#minBlock = blockNumber
    if (this.#maxBlock === undefined || blockNumber > this.#maxBlock) this.#maxBlock = blockNumber
  }

  /**
   * Current on-disk size of the temp file in bytes (0 before the file is opened). Reads
   * `fs.stat` because `@dsnp/parquetjs` flushes row groups to disk incrementally, so the file
   * size grows during appends and is a faithful rotation signal (verified by the Step 0 spike).
   */
  async size(): Promise<number> {
    if (!this.#writer) return 0
    try {
      return (await stat(this.#tmpPath)).size
    } catch {
      return 0
    }
  }

  /**
   * Finalizes the segment: writes the Parquet footer, fsyncs the file, atomically renames the
   * temp file to `<dir>/<min>-<max>.parquet`, then fsyncs the directory so the rename is durable.
   * Returns the published file's path, row count, byte size and block range.
   *
   * Refuses to overwrite an existing target file — a collision means two segments claimed the
   * same block range, which would silently drop data.
   */
  async publish(): Promise<PublishedSegment> {
    if (!this.#writer || this.#minBlock === undefined || this.#maxBlock === undefined) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.FILE_COLLISION,
        `Internal: publish() called on an empty segment in '${this.#dir}'. Only segments with ` +
          `at least one row may be published.`,
      )
    }

    await this.#writer.close()
    this.#closed = true
    // close() ended the stream (via the library's envelopeWriter.close → stream.end), so its fd is
    // already released; drop the reference so discard()/GC don't touch a finished stream.
    this.#stream = undefined

    return finalizeSegmentFile({
      dir: this.#dir,
      tmpPath: this.#tmpPath,
      rows: this.#rowCount,
      minBlock: this.#minBlock,
      maxBlock: this.#maxBlock,
    })
  }

  /**
   * Best-effort cleanup of an unpublished segment: releases the open fd and deletes the temp file.
   * Used on the error path — the temp file holds finalized-but-not-checkpointed rows that will be
   * regenerated from the portal on the next run, since the cursor never advanced.
   *
   * We `destroy()` the stream directly instead of `ParquetWriter.close()`-ing it: the file is about
   * to be unlinked, so there is no point flushing a footer, and `close()` could leak the fd (it
   * flips `closed` before the stream is ended, so a throw mid-footer skips the end) or hang on a
   * footer flush against a full disk. `destroy()` frees the descriptor immediately and can't hang.
   */
  async discard(): Promise<void> {
    if (this.#stream && !this.#closed) {
      this.#closed = true
      // A destroyed stream can emit 'error' for an in-flight write; swallow it so it never surfaces
      // as an unhandled rejection on the error path.
      this.#stream.once('error', () => {})
      this.#stream.destroy()
    }
    this.#writer = undefined
    this.#stream = undefined

    try {
      await unlink(this.#tmpPath)
    } catch {
      // best-effort — the temp file may not exist yet (never opened) or already be gone
    }
  }
}
