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

/** Summary of a segment that was just published to its final path. */
export type PublishedSegment = {
  path: string
  rows: number
  bytes: number
  minBlock: number
  maxBlock: number
}

/**
 * The exact surface `ParquetStore` drives a per-table segment writer through. Every engine
 * implements it — the built-in `parquetjsEngine` and any external
 * `ParquetEngine`; everything above the writer — finalization buffers, the durable cursor,
 * `.tmp-*` recovery, collision refusal — are engine-agnostic; external engines reuse
 * `nextTmpPath` and `finalizeSegmentFile` so recovery and collision semantics stay uniform.
 */
export interface SegmentWriter {
  /** Whether the segment has been opened (i.e. at least one row was appended). */
  readonly isOpen: boolean
  readonly rowCount: number
  readonly minBlock: number | undefined
  readonly maxBlock: number | undefined
  appendRow(row: Record<string, unknown>, blockNumber: number): Promise<void>
  size(): Promise<number>
  publish(): Promise<PublishedSegment>
  discard(): Promise<void>
}

/**
 * Shared publish tail for every engine: fsync the finished temp file so its content is durable
 * before the rename makes it visible, refuse to overwrite an existing `<min>-<max>.parquet`
 * (a collision means two segments claimed the same block range, which would silently drop
 * data), atomically rename into place, then fsync the directory so the rename is durable.
 */
export async function finalizeSegmentFile(options: {
  dir: string
  tmpPath: string
  rows: number
  minBlock: number
  maxBlock: number
}): Promise<PublishedSegment> {
  const { dir, tmpPath, rows, minBlock, maxBlock } = options

  await fsyncFile(tmpPath)

  const finalPath = path.join(dir, `${pad(minBlock)}-${pad(maxBlock)}.parquet`)
  if (await pathExists(finalPath)) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.FILE_COLLISION,
      `Refusing to overwrite existing Parquet file '${finalPath}'. A file for block range ` +
        `${minBlock}-${maxBlock} already exists — this indicates overlapping segments ` +
        `or a dirty output directory.`,
    )
  }

  await rename(tmpPath, finalPath)
  await fsyncDir(dir)

  const bytes = await stat(finalPath)
    .then((s) => s.size)
    .catch(() => 0)

  return { path: finalPath, rows, bytes, minBlock, maxBlock }
}

function pad(block: number): string {
  return Math.trunc(block).toString().padStart(BLOCK_PAD, '0')
}
