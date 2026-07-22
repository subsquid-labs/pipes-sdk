import { rename, stat } from 'node:fs/promises'
import path from 'node:path'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { fsyncDir, fsyncFile, pathExists } from './fs-durable.js'

/** Zero-pad block numbers in published filenames so they sort lexically (`0000000042`). */
export const BLOCK_PAD = 12

/** Prefix every in-progress temp file carries; recovery deletes anything matching `.tmp-*`. */
export const TMP_PREFIX = '.tmp-'

// Process-unique counter for temp file names. Recovery wipes all `.tmp-*` on startup, so a
// reset-to-0 across restarts can never collide with a leftover temp file.
let segmentSeq = 0

/** Next process-unique temp file path inside `dir`. */
export function nextTmpPath(dir: string): string {
  return path.join(dir, `${TMP_PREFIX}${(segmentSeq++).toString().padStart(6, '0')}.parquet`)
}

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

/**
 * The exact surface `ParquetStore` drives a per-table segment writer through. Every engine
 * implements it — the built-in `parquetjsEngine` and any external `ParquetEngine`; everything
 * above the writer — finalization buffers, coverage tracking, the durable cursor, `.tmp-*`
 * recovery, collision refusal — is engine-agnostic; external engines reuse `nextTmpPath` and
 * `finalizeSegmentFile` so recovery and collision semantics stay uniform.
 */
export interface SegmentWriter {
  /** Whether the segment's file has been opened (i.e. at least one row was appended). */
  readonly isOpen: boolean
  readonly rowCount: number
  appendRow(row: Record<string, unknown>): Promise<void>
  size(): Promise<number>
  /**
   * Finalizes and publishes the segment, named for the coverage window `range`. Must succeed
   * with **zero appended rows** — a zero-row window still publishes a real (schema-only)
   * Parquet file; that is how a table claims a window it produced nothing in.
   */
  publish(range: SegmentRange): Promise<PublishedSegment>
  discard(): Promise<void>
}

/**
 * Shared publish tail for every engine: refuse an inverted coverage range, fsync the finished
 * temp file so its content is durable before the rename makes it visible, refuse to overwrite an
 * existing `<from>-<to>.parquet` (a collision means two segments claimed the same window, which
 * would silently drop data), atomically rename into place, then fsync the directory so the
 * rename is durable.
 */
export async function finalizeSegmentFile(options: {
  dir: string
  tmpPath: string
  rows: number
  range: SegmentRange
}): Promise<PublishedSegment> {
  const { dir, tmpPath, rows, range } = options

  if (range.from > range.to) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.COVERAGE_RANGE_INVALID,
      `Internal: refusing to publish segment in '${dir}' with an inverted coverage range ` +
        `${range.from}-${range.to}.`,
    )
  }

  await fsyncFile(tmpPath)

  const finalPath = path.join(dir, `${pad(range.from)}-${pad(range.to)}.parquet`)
  if (await pathExists(finalPath)) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.FILE_COLLISION,
      `Refusing to overwrite existing Parquet file '${finalPath}'. A file covering block range ` +
        `${range.from}-${range.to} already exists — this indicates overlapping segments ` +
        `or a dirty output directory.`,
    )
  }

  await rename(tmpPath, finalPath)
  await fsyncDir(dir)

  const bytes = await stat(finalPath)
    .then((s) => s.size)
    .catch(() => 0)

  return { path: finalPath, rows, bytes }
}

function pad(block: number): string {
  return Math.trunc(block).toString().padStart(BLOCK_PAD, '0')
}
