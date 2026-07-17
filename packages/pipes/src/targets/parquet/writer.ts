import type { WriteStream } from 'node:fs'
import { rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { fsyncDir, fsyncFile, openWriteStream, pathExists } from './fs-durable.js'

/** Zero-pad block numbers in published filenames so they sort lexically (`0000000042`). */
export const BLOCK_PAD = 12

/** Prefix every in-progress temp file carries; recovery deletes anything matching `.tmp-*`. */
export const TMP_PREFIX = '.tmp-'

// Process-unique counter for temp file names. Recovery wipes all `.tmp-*` on startup, so a
// reset-to-0 across restarts can never collide with a leftover temp file.
let segmentSeq = 0

/**
 * Block range a published file **covers** — the window the pipe processed, not the rows' own
 * min/max. The two are independent: the window's edge blocks may carry no data, and a row may be
 * keyed outside the window that emitted it. That is the point — the filename states coverage, not
 * content.
 */
export type SegmentRange = { from: number; to: number }

/** Summary of a segment that was just published to its final path. */
export type PublishedSegment = {
  path: string
  rows: number
  bytes: number
}

export type ParquetSegmentWriterOptions = {
  /** The table's directory: `<baseDir>/<table>`. Created by the state layer before writes. */
  dir: string
  /** Pre-built library schema for this table. */
  schema: ParquetSchema
  /** Rows per row group — the "split size" that bounds the writer's in-memory buffer. */
  rowGroupSize: number
}

/**
 * Wraps a single open `ParquetWriter` writing **one** output file (a "segment") for one table.
 *
 * The underlying file is **lazy-opened on the first `appendRow`**, so a table that receives no
 * rows in a checkpoint window never creates a degenerate empty `.parquet` file. The writer
 * tracks the block range and row count it has seen, exposes the growing temp file size for
 * byte-based rotation, and publishes atomically:
 *
 *   `close()` (footer) → fsync file → atomic `rename` temp → `<dir>/<from>-<to>.parquet` → fsync dir
 *
 * The published name comes from the {@link SegmentRange} the caller passes to `publish()` — the
 * window the pipe processed. The writer never inspects the rows' own block numbers; it has no way
 * to know which blocks it was *responsible* for, only which ones happened to produce rows.
 *
 * A published file is immutable and contains only finalized rows, so it is never rewritten.
 */
export class ParquetSegmentWriter {
  readonly #dir: string
  readonly #schema: ParquetSchema
  readonly #rowGroupSize: number
  readonly #tmpPath: string

  #writer: ParquetWriter | undefined
  // We own the underlying stream (rather than ParquetWriter.openFile owning it) so the error path
  // can force the fd shut — ParquetWriter.close() flips `closed` first and never reaches the
  // stream's close() if a footer write throws, which would otherwise leak the descriptor.
  #stream: WriteStream | undefined
  #rowCount = 0
  #closed = false

  constructor(options: ParquetSegmentWriterOptions) {
    this.#dir = options.dir
    this.#schema = options.schema
    this.#rowGroupSize = options.rowGroupSize
    this.#tmpPath = path.join(options.dir, `${TMP_PREFIX}${(segmentSeq++).toString().padStart(6, '0')}.parquet`)
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
  async appendRow(row: Record<string, unknown>): Promise<void> {
    await this.#ensureOpen()
    await this.#writer!.appendRow(row)

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
   * Finalizes the segment: writes the Parquet footer, fsyncs the file, atomically renames the
   * temp file to `<dir>/<from>-<to>.parquet`, then fsyncs the directory so the rename is durable.
   * Returns the published file's path, row count and byte size.
   *
   * `range` is the window the caller assigns; the file is named for it so consumers read coverage
   * off the filename. Publishing with **no rows** is legitimate and how a table claims a window it
   * was present for but produced nothing in — the file carries the schema and an empty row set.
   *
   * Refuses to overwrite an existing target file — a collision means two segments claimed the same
   * window, which would silently drop data.
   */
  async publish(range: SegmentRange): Promise<PublishedSegment> {
    if (range.from > range.to) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.COVERAGE_RANGE_INVALID,
        `Internal: refusing to publish segment in '${this.#dir}' with an inverted coverage range ` +
          `${range.from}-${range.to}.`,
      )
    }

    // Opens the file if no row ever arrived, so a zero-row window still produces a real segment.
    await this.#ensureOpen()

    await this.#writer!.close()
    this.#closed = true
    // close() ended the stream (via the library's envelopeWriter.close → stream.end), so its fd is
    // already released; drop the reference so discard()/GC don't touch a finished stream.
    this.#stream = undefined

    // fsync the temp file so the footer is durable before the rename makes it visible.
    await fsyncFile(this.#tmpPath)

    const finalPath = path.join(this.#dir, `${pad(range.from)}-${pad(range.to)}.parquet`)
    if (await pathExists(finalPath)) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.FILE_COLLISION,
        `Refusing to overwrite existing Parquet file '${finalPath}'. A file covering block range ` +
          `${range.from}-${range.to} already exists — this indicates overlapping segments ` +
          `or a dirty output directory.`,
      )
    }

    await rename(this.#tmpPath, finalPath)
    await fsyncDir(this.#dir)

    const bytes = await stat(finalPath)
      .then((s) => s.size)
      .catch(() => 0)

    return { path: finalPath, rows: this.#rowCount, bytes }
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

function pad(block: number): string {
  return Math.trunc(block).toString().padStart(BLOCK_PAD, '0')
}
