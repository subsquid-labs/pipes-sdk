import { rename, stat, unlink } from 'node:fs/promises'
import path from 'node:path'

import { ParquetSchema, ParquetWriter } from '@dsnp/parquetjs'

import { PQ_ERR, ParquetTargetError } from './errors.js'
import { fsyncDir, fsyncFile, pathExists } from './fs-durable.js'

/** Zero-pad block numbers in published filenames so they sort lexically (`0000000042`). */
export const BLOCK_PAD = 12

/** Prefix every in-progress temp file carries; recovery deletes anything matching `.tmp-*`. */
export const TMP_PREFIX = '.tmp-'

// Process-unique counter for temp file names. Recovery wipes all `.tmp-*` on startup, so a
// reset-to-0 across restarts can never collide with a leftover temp file.
let segmentSeq = 0

/** Summary of a segment that was just published to its final path. */
export type PublishedSegment = {
  path: string
  rows: number
  bytes: number
  minBlock: number
  maxBlock: number
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
 *   `close()` (footer) → fsync file → atomic `rename` temp → `<dir>/<min>-<max>.parquet` → fsync dir
 *
 * A published file is immutable and contains only finalized rows, so it is never rewritten.
 */
export class ParquetSegmentWriter {
  readonly #dir: string
  readonly #schema: ParquetSchema
  readonly #rowGroupSize: number
  readonly #tmpPath: string

  #writer: ParquetWriter | undefined
  #rowCount = 0
  #minBlock: number | undefined
  #maxBlock: number | undefined
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
  async appendRow(row: Record<string, unknown>, blockNumber: number): Promise<void> {
    if (!this.#writer) {
      this.#writer = await ParquetWriter.openFile(this.#schema, this.#tmpPath, { rowGroupSize: this.#rowGroupSize })
    }

    await this.#writer.appendRow(row)

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
        PQ_ERR.FILE_COLLISION,
        `Internal: publish() called on an empty segment in '${this.#dir}'. Only segments with ` +
          `at least one row may be published.`,
      )
    }

    await this.#writer.close()
    this.#closed = true

    // fsync the temp file so the footer is durable before the rename makes it visible.
    await fsyncFile(this.#tmpPath)

    const finalPath = path.join(this.#dir, `${pad(this.#minBlock)}-${pad(this.#maxBlock)}.parquet`)
    if (await pathExists(finalPath)) {
      throw new ParquetTargetError(
        PQ_ERR.FILE_COLLISION,
        `Refusing to overwrite existing Parquet file '${finalPath}'. A file for block range ` +
          `${this.#minBlock}-${this.#maxBlock} already exists — this indicates overlapping segments ` +
          `or a dirty output directory.`,
      )
    }

    await rename(this.#tmpPath, finalPath)
    await fsyncDir(this.#dir)

    const bytes = await stat(finalPath)
      .then((s) => s.size)
      .catch(() => 0)

    return { path: finalPath, rows: this.#rowCount, bytes, minBlock: this.#minBlock, maxBlock: this.#maxBlock }
  }

  /**
   * Best-effort cleanup of an unpublished segment: closes the writer (if open) and deletes the
   * temp file. Used on the error path — the temp file holds finalized-but-not-checkpointed rows
   * that will be regenerated from the portal on the next run, since the cursor never advanced.
   */
  async discard(): Promise<void> {
    if (this.#writer && !this.#closed) {
      try {
        await this.#writer.close()
      } catch {
        // best-effort
      }
    }
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
