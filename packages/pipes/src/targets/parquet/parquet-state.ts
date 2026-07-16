import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type BlockCursor, type Logger, type TargetState, formatBlock } from '~/core/index.js'

import { PARQUET_ERROR_CODES, ParquetTargetError } from './errors.js'
import { fsyncDir, fsyncFile } from './fs-durable.js'
import { TMP_PREFIX } from './writer.js'

/** Base name of the durable state file living at the root of the output dir. */
const STATE_BASENAME = '_sqd_parquet_state'

/** Published data files are named `<min>-<max>.parquet`; nothing else in a table dir is ours. */
const DATA_FILE_RE = /^(\d+)-(\d+)\.parquet$/

type PersistedState = {
  /** Optional pipe namespace, mirrored from `settings.id`. */
  id?: string
  /** Last durably-checkpointed cursor — `read` resumes from `cursor.number + 1`. */
  cursor: BlockCursor
  /**
   * Finalized head observed at the checkpoint, persisted so the source can re-seed its monotonic
   * finalized watermark after an unclean restart mid-fork. Absent in state written before this
   * field existed (treated as "no persisted finalized head").
   */
  finalized?: BlockCursor
}

export type ParquetStateOptions = {
  /** Output base directory — the isolation unit (one pipe per dir). */
  dir: string
  /** Declared table names; their sub-directories are created on startup. */
  tables: string[]
  /**
   * Namespace so multiple pipes can share a dir (separate state files). The target passes the
   * pipe's source id unless an explicit `settings.id` pins it.
   */
  id?: string
  logger: Logger
}

/**
 * Durable cursor + crash recovery for the Parquet target.
 *
 * The output directory is the primary isolation unit — one pipe per dir — and the state file is
 * additionally namespaced by the pipe's id, so several pipes can share a dir with separate
 * cursors. The cursor is persisted to a single JSON file written atomically (temp + fsync +
 * rename + dir fsync).
 *
 * Recovery on startup reconciles the on-disk files with the committed cursor: any published file
 * holding blocks above the cursor is a remnant of a checkpoint that published files but crashed
 * before persisting the new cursor, and any `.tmp-*` file is an aborted in-progress segment —
 * both are deleted so `read(cursor)` regenerates that (deterministic, finalized) data cleanly.
 */
export class ParquetState {
  readonly #baseDir: string
  readonly #tables: string[]
  readonly #id: string | undefined
  readonly #statePath: string
  readonly #logger: Logger

  constructor(options: ParquetStateOptions) {
    this.#baseDir = options.dir
    this.#tables = options.tables
    this.#id = options.id
    this.#logger = options.logger
    this.#statePath = path.join(
      options.dir,
      options.id ? `${STATE_BASENAME}.${options.id}.json` : `${STATE_BASENAME}.json`,
    )
  }

  /**
   * Prepares the output directory and returns the cursor to resume from (or `undefined` to start
   * from the stream beginning).
   *
   * Always: `mkdir -p` the base dir + every table dir, and delete every `.tmp-*` file. When a
   * committed cursor exists, additionally delete every published data file whose `maxBlock`
   * exceeds it (incomplete-checkpoint remnants).
   */
  async getCursor(): Promise<TargetState | undefined> {
    await mkdir(this.#baseDir, { recursive: true })
    for (const table of this.#tables) {
      await mkdir(path.join(this.#baseDir, table), { recursive: true })
    }

    await this.#deleteTempFiles()

    const state = await this.#readState()
    if (!state) {
      return undefined
    }

    await this.#deleteFilesAboveCursor(state.cursor.number)

    // Hand the persisted finalized head back as resume state so the source can re-seed its
    // monotonic watermark (explicit `null` when no finalized head was stored).
    return { latest: state.cursor, finalized: state.finalized ?? null }
  }

  /**
   * Atomically persists the checkpoint cursor: write a temp file, fsync it, rename over the
   * state file, then fsync the directory so the rename is durable. Called only after every open
   * writer for the checkpoint has been published.
   */
  async saveCursor(cursor: BlockCursor, finalized?: BlockCursor): Promise<void> {
    const payload: PersistedState = { cursor }
    if (this.#id) {
      payload.id = this.#id
    }
    if (finalized) {
      payload.finalized = finalized
    }

    const tmpPath = path.join(this.#baseDir, `${TMP_PREFIX}state-${path.basename(this.#statePath)}`)

    await writeFile(tmpPath, JSON.stringify(payload))
    await fsyncFile(tmpPath)
    await rename(tmpPath, this.#statePath)
    await fsyncDir(this.#baseDir)
  }

  async #readState(): Promise<PersistedState | undefined> {
    let raw: string
    try {
      raw = await readFile(this.#statePath, 'utf8')
    } catch {
      return undefined
    }

    try {
      const parsed = JSON.parse(raw) as PersistedState
      if (!parsed?.cursor || typeof parsed.cursor.number !== 'number') {
        throw new Error('missing cursor.number')
      }

      return parsed
    } catch (error) {
      throw new ParquetTargetError(
        PARQUET_ERROR_CODES.STATE_CORRUPT,
        `Parquet state file '${this.#statePath}' exists but could not be parsed: ` +
          `${error instanceof Error ? error.message : String(error)}. Inspect or remove it to recover.`,
      )
    }
  }

  /** Deletes every `.tmp-*` file in the base dir and each table dir. */
  async #deleteTempFiles(): Promise<void> {
    for (const dir of [this.#baseDir, ...this.#tables.map((t) => path.join(this.#baseDir, t))]) {
      const entries = await readdir(dir).catch(() => [] as string[])
      for (const name of entries) {
        if (name.startsWith(TMP_PREFIX)) {
          await unlink(path.join(dir, name)).catch(() => {})
        }
      }
    }
  }

  /**
   * Deletes every published `<min>-<max>.parquet` whose `max` exceeds the committed cursor.
   *
   * A surviving over-cursor file is a correctness hazard, not a cosmetic leftover: `read(cursor)`
   * re-fetches the same blocks and either collides with it (fatal) or, if rotation lands on a
   * different range, overlaps it (silent duplicate rows). So a failed `unlink` here is fatal —
   * we surface it with remediation guidance rather than swallowing it and counting it as removed.
   */
  async #deleteFilesAboveCursor(cursorNumber: number): Promise<void> {
    let removed = 0
    for (const table of this.#tables) {
      const dir = path.join(this.#baseDir, table)
      const entries = await readdir(dir).catch(() => [] as string[])
      for (const name of entries) {
        const match = DATA_FILE_RE.exec(name)
        if (!match) continue

        const maxBlock = Number.parseInt(match[2], 10)
        if (maxBlock <= cursorNumber) continue

        const filePath = path.join(dir, name)
        try {
          await unlink(filePath)
        } catch (error) {
          throw new ParquetTargetError(
            PARQUET_ERROR_CODES.RECOVERY_DELETE_FAILED,
            `Crash recovery could not delete the over-cursor Parquet file '${filePath}' ` +
              `(its blocks exceed the committed cursor ${formatBlock(cursorNumber)}): ` +
              `${error instanceof Error ? error.message : String(error)}. Leaving it would duplicate or ` +
              `overlap re-fetched data — remove it manually and restart.`,
          )
        }

        removed++
      }
    }

    if (removed > 0) {
      this.#logger.warn(
        `Crash recovery: removed ${removed} Parquet file(s) above the committed cursor ` +
          `(block ${formatBlock(cursorNumber)}) before resuming.`,
      )
    }
  }
}
