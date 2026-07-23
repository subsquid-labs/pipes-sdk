import { open as fsOpen, rename, stat } from 'node:fs/promises'
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

/** Next process-unique temp file path inside `dir`. Target-internal: engines receive the path. */
export function nextTmpPath(dir: string): string {
  return path.join(dir, `${TMP_PREFIX}${(segmentSeq++).toString().padStart(6, '0')}.parquet`)
}

/**
 * Block range a published file **covers** — the window the pipe processed, not the rows' own
 * min/max. The two are independent: the window's edge blocks may carry no data, and a row may be
 * keyed outside the window that emitted it. That is the point — the filename states coverage, not
 * content. Target-internal: engines never see a range; the store names files itself.
 */
export type SegmentRange = { from: number; to: number }

/** Summary of a segment that was just published to its final path. */
export type PublishedSegment = {
  path: string
  rows: number
  bytes: number
}

/**
 * The per-segment surface an engine implements: write rows into the Parquet file at the temp
 * path the target passed to `createSegment`, and nothing else. The target tracks row counts,
 * assigns the coverage window, names and publishes the file (`finalizeSegmentFile`), and
 * deletes the temp file on the error path — so a writer holds no naming, durability or
 * recovery responsibilities and none of those semantics can vary per engine.
 */
export interface SegmentWriter {
  /** Appends a batch of finalized rows (≥1) to the segment file, in order. */
  append(rows: readonly Record<string, unknown>[]): Promise<void>
  /**
   * Bytes staged so far, used for byte-based rotation. An estimate is fine (e.g. in-memory
   * staging before the file exists); it only needs to grow with the data.
   */
  size(): Promise<number>
  /**
   * Completes the file at the temp path: flush everything, write the footer, release the fd.
   * Must succeed with **zero appended rows** — tail closing claims a window the table produced
   * nothing in with a real, schema-only Parquet file. After `finish()` resolves the file must
   * be complete Parquet — the target verifies its magic bytes before publishing.
   */
  finish(): Promise<void>
  /**
   * Error-path teardown: release resources (fds, native handles) without completing the file.
   * Must be idempotent and must not throw. The target deletes the temp file afterwards.
   */
  abort(): Promise<void>
}

/**
 * Target-internal publish tail, run by `ParquetStore` after the engine's `finish()`: refuse an
 * inverted coverage range, verify the finished temp file is actually Parquet (magic bytes),
 * fsync it so its content is durable before the rename makes it visible, refuse to overwrite an
 * existing `<from>-<to>.parquet` (a collision means two segments claimed the same window, which
 * would silently drop data), atomically rename into place, then fsync the directory so the
 * rename is durable.
 */
export async function finalizeSegmentFile(options: {
  dir: string
  tmpPath: string
  rows: number
  range: SegmentRange
  /** Engine name for error messages. */
  engine: string
}): Promise<PublishedSegment> {
  const { dir, tmpPath, rows, range, engine } = options

  if (range.from > range.to) {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.COVERAGE_RANGE_INVALID,
      `Internal: refusing to publish segment in '${dir}' with an inverted coverage range ` +
        `${range.from}-${range.to}.`,
    )
  }

  await assertParquetMagic(tmpPath, engine)
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

const PARQUET_MAGIC = Buffer.from('PAR1')
// Header magic (4) + footer metadata length (4) + footer magic (4) — no valid file is smaller.
const PARQUET_MIN_BYTES = 12

/**
 * Verifies the finished segment file has the Parquet envelope: it starts and ends with the
 * magic bytes (`PAR1`), and the footer length field (the little-endian uint32 immediately
 * before the trailing magic) describes a footer that actually fits inside the file. This is
 * the runtime check behind the engine contract's "must produce real Parquet files": a
 * truncated, non-Parquet, or magic-wrapped-garbage output is refused here, at the checkpoint,
 * instead of surfacing as a corrupt file in a downstream reader. (It is an envelope check,
 * not a decode — an engine writing structurally valid Parquet with wrong *contents* is beyond
 * cheap verification.)
 */
async function assertParquetMagic(tmpPath: string, engine: string): Promise<void> {
  const refuse = (problem: string): never => {
    throw new ParquetTargetError(
      PARQUET_ERROR_CODES.SEGMENT_NOT_PARQUET,
      `Refusing to publish segment file '${tmpPath}' from engine '${engine}': ${problem}. ` +
        `Engines must produce complete Parquet files — downstream readers rely on it.`,
    )
  }

  let fh: Awaited<ReturnType<typeof fsOpen>>
  try {
    fh = await fsOpen(tmpPath, 'r')
  } catch (error) {
    return refuse(`the file cannot be opened (${error instanceof Error ? error.message : String(error)})`)
  }

  try {
    const { size } = await fh.stat()
    if (size < PARQUET_MIN_BYTES) {
      return refuse(`the file is ${size} byte(s), smaller than any valid Parquet file`)
    }

    const head = Buffer.alloc(4)
    // The last 8 bytes: footer metadata length (LE uint32) followed by the trailing magic.
    const tail = Buffer.alloc(8)
    await fh.read(head, 0, 4, 0)
    await fh.read(tail, 0, 8, size - 8)
    if (!head.equals(PARQUET_MAGIC) || !tail.subarray(4).equals(PARQUET_MAGIC)) {
      return refuse('it does not start and end with the Parquet magic bytes (PAR1)')
    }

    // The footer must be non-empty and fit between the header magic and its own length field —
    // this is what rejects arbitrary payloads merely wrapped in PAR1.
    const footerLength = tail.readUInt32LE(0)
    if (footerLength < 1 || footerLength > size - PARQUET_MIN_BYTES) {
      return refuse(`its footer length field claims ${footerLength} byte(s), which cannot fit in a ${size}-byte file`)
    }
  } finally {
    await fh.close()
  }
}

function pad(block: number): string {
  return Math.trunc(block).toString().padStart(BLOCK_PAD, '0')
}
