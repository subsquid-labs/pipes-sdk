import type { WriteStream } from 'node:fs'
import { stat, unlink } from 'node:fs/promises'

import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'

import { openWriteStream } from '../fs-durable.js'
import {
  type PublishedSegment,
  type SegmentRange,
  type SegmentWriter,
  finalizeSegmentFile,
  nextTmpPath,
} from '../segment.js'

type Row = Record<string, unknown>

export type ParquetjsSegmentWriterOptions = {
  /** The table's directory: `<baseDir>/<table>`. Created by the state layer before writes. */
  dir: string
  /** The compiled library schema, shared by every segment of the table. */
  schema: ParquetSchema
  /** Rows per row group — the "split size" that bounds the writer's in-memory buffer. */
  rowGroupSize: number
  /** Rewrites plain-array LIST cells into the library's `{ list: [{ element }] }` row shape.
   * `undefined` for LIST-free tables (zero-copy path). */
  wrapRow?: (row: Row) => Row
}

/**
 * Wraps a single open `ParquetWriter` writing **one** output file (a "segment") for one table.
 *
 * The underlying file is **lazy-opened on the first `appendRow`** (or at `publish` for a
 * zero-row segment). The writer tracks the row count it has seen, exposes the growing temp
 * file size for byte-based rotation, and publishes atomically through the shared segment
 * toolkit:
 *
 *   `close()` (footer) → fsync file → atomic `rename` temp → `<dir>/<from>-<to>.parquet` → fsync dir
 *
 * The published name comes from the {@link SegmentRange} the caller passes to `publish()` — the
 * window the pipe processed. The writer never inspects the rows' own block numbers; it has no way
 * to know which blocks it was *responsible* for, only which ones happened to produce rows.
 *
 * A published file is immutable and contains only finalized rows, so it is never rewritten.
 */
export class ParquetSegmentWriter implements SegmentWriter {
  readonly #dir: string
  readonly #schema: ParquetSchema
  readonly #rowGroupSize: number
  readonly #wrapRow: ((row: Row) => Row) | undefined
  readonly #tmpPath: string

  #writer: ParquetWriter | undefined
  // We own the underlying stream (rather than ParquetWriter.openFile owning it) so the error path
  // can force the fd shut — ParquetWriter.close() flips `closed` first and never reaches the
  // stream's close() if a footer write throws, which would otherwise leak the descriptor.
  #stream: WriteStream | undefined
  #rowCount = 0
  #closed = false

  constructor(options: ParquetjsSegmentWriterOptions) {
    this.#dir = options.dir
    this.#schema = options.schema
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

  /**
   * Appends one row, lazy-opening the temp file on first use.
   *
   * The writer tracks no block range of its own: the filename comes from the coverage window the
   * caller passes to {@link publish}, and per-block min/max is already written into each row group's
   * statistics by the Parquet footer (what DuckDB/Spark/Athena prune on).
   */
  async appendRow(row: Row): Promise<void> {
    await this.#ensureOpen()
    await this.#writer!.appendRow(this.#wrapRow ? this.#wrapRow(row) : row)

    this.#rowCount++
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
   * Finalizes the segment: writes the Parquet footer, then publishes through the shared
   * `finalizeSegmentFile` tail (fsync → collision check → atomic rename to
   * `<dir>/<from>-<to>.parquet` → dir fsync). Returns the published file's path, row count and
   * byte size.
   *
   * `range` is the window the caller assigns; the file is named for it so consumers read coverage
   * off the filename. Publishing with **no rows** is legitimate and how a table claims a window it
   * was present for but produced nothing in — the file carries the schema and an empty row set.
   */
  async publish(range: SegmentRange): Promise<PublishedSegment> {
    // Opens the file if no row ever arrived, so a zero-row window still produces a real segment.
    await this.#ensureOpen()

    await this.#writer!.close()
    this.#closed = true
    // close() ended the stream (via the library's envelopeWriter.close → stream.end), so its fd is
    // already released; drop the reference so discard()/GC don't touch a finished stream.
    this.#stream = undefined

    return finalizeSegmentFile({
      dir: this.#dir,
      tmpPath: this.#tmpPath,
      rows: this.#rowCount,
      range,
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
