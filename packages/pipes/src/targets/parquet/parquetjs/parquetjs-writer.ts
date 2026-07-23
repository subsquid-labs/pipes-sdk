import type { WriteStream } from 'node:fs'
import { stat } from 'node:fs/promises'

import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'

import { openWriteStream } from '../fs-durable.js'
import { type SegmentWriter } from '../segment.js'

type Row = Record<string, unknown>

export type ParquetjsSegmentWriterOptions = {
  /** The target-assigned temp path this segment writes to. */
  tmpPath: string
  /** The compiled library schema, shared by every segment of the table. */
  schema: ParquetSchema
  /** Rows per row group — the "split size" that bounds the writer's in-memory buffer. */
  rowGroupSize: number
  /** Rewrites plain-array LIST cells into the library's `{ list: [{ element }] }` row shape.
   * `undefined` for LIST-free tables (zero-copy path). */
  wrapRow?: (row: Row) => Row
}

/**
 * Wraps a single open `ParquetWriter` writing **one** segment file at the temp path the target
 * assigned. The writer's whole job is rows → Parquet bytes at that path: the target tracks row
 * counts, assigns the coverage window, names/publishes the finished file and deletes it on the
 * error path.
 *
 * The underlying file is **lazy-opened on the first `append`** (or at `finish` for a zero-row
 * segment — tail closing publishes real, schema-only files). The writer never inspects the
 * rows' block numbers: the published name states the coverage window, which only the target
 * knows, and per-block min/max lands in each row group's footer statistics anyway (what
 * DuckDB/Spark/Athena prune on).
 */
export class ParquetSegmentWriter implements SegmentWriter {
  readonly #tmpPath: string
  readonly #schema: ParquetSchema
  readonly #rowGroupSize: number
  readonly #wrapRow: ((row: Row) => Row) | undefined

  #writer: ParquetWriter | undefined
  // We own the underlying stream (rather than ParquetWriter.openFile owning it) so the error path
  // can force the fd shut — ParquetWriter.close() flips `closed` first and never reaches the
  // stream's close() if a footer write throws, which would otherwise leak the descriptor.
  #stream: WriteStream | undefined
  #closed = false

  constructor(options: ParquetjsSegmentWriterOptions) {
    this.#tmpPath = options.tmpPath
    this.#schema = options.schema
    this.#rowGroupSize = options.rowGroupSize
    this.#wrapRow = options.wrapRow
  }

  /** Appends a batch of rows, lazy-opening the temp file on first use. */
  async append(rows: readonly Row[]): Promise<void> {
    await this.#ensureOpen()
    for (const row of rows) {
      await this.#writer!.appendRow(this.#wrapRow ? this.#wrapRow(row) : row)
    }
  }

  async #ensureOpen(): Promise<void> {
    if (this.#writer) return

    const stream = await openWriteStream(this.#tmpPath)
    try {
      this.#writer = await ParquetWriter.openStream(this.#schema, stream, { rowGroupSize: this.#rowGroupSize })
      this.#stream = stream
    } catch (error) {
      // openStream writes the header immediately; if that throws, the stream we just opened would
      // leak — force it shut before propagating.
      stream.destroy()
      throw error
    }
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
   * Completes the segment file: opens it if no row ever arrived (a zero-row window still
   * produces a real, schema-only segment), flushes the last row group, writes the Parquet
   * footer and releases the fd. The target verifies and publishes the file afterwards.
   */
  async finish(): Promise<void> {
    await this.#ensureOpen()

    await this.#writer!.close()
    this.#closed = true
    // close() ended the stream (via the library's envelopeWriter.close → stream.end), so its fd is
    // already released; drop the reference so abort()/GC don't touch a finished stream.
    this.#stream = undefined
  }

  /**
   * Error-path teardown: releases the open fd without finishing the file (the target deletes the
   * temp file). We `destroy()` the stream directly instead of `ParquetWriter.close()`-ing it: the
   * file is about to be unlinked, so there is no point flushing a footer, and `close()` could
   * leak the fd (it flips `closed` before the stream is ended, so a throw mid-footer skips the
   * end) or hang on a footer flush against a full disk. `destroy()` frees the descriptor
   * immediately and can't hang.
   */
  async abort(): Promise<void> {
    if (this.#stream && !this.#closed) {
      this.#closed = true
      // A destroyed stream can emit 'error' for an in-flight write; swallow it so it never surfaces
      // as an unhandled rejection on the error path.
      this.#stream.once('error', () => {})
      this.#stream.destroy()
    }
    this.#writer = undefined
    this.#stream = undefined
  }
}
