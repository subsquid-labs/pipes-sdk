import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { type BlockCursor, type Logger, formatBlock } from '~/core/index.js'

import { PQ_ERR, ParquetTargetError } from './errors.js'
import { fsyncDir, fsyncFile } from './fs-durable.js'
import { TMP_PREFIX } from './writer.js'

/** Base name of the durable state file living at the root of the output dir. */
const STATE_BASENAME = '_sqd_parquet_state'

/** Published data files are named `<min>-<max>.parquet`; nothing else in a table dir is ours. */
const DATA_FILE_RE = /^(\d+)-(\d+)\.parquet$/

type PersistedState = {
  /** Optional pipe namespace, mirrored from `settings.id`. */
  id?: string
  /** Last durably-checkpointed cursor — `read(cursor)` resumes from `cursor.number + 1`. */
  cursor: BlockCursor
}

export type ParquetStateOptions = {
  /** Output base directory — the isolation unit (one pipe per dir). */
  dir: string
  /** Declared table names; their sub-directories are created on startup. */
  tables: string[]
  /** Optional namespace so multiple pipes can share a dir (separate state files). */
  id?: string
  logger: Logger
}

/**
 * Durable cursor + crash recovery for the Parquet target.
 *
 * The output directory is the isolation unit — one pipe per dir — which removes any dependency
 * on `ctx.id` being available before the first batch. The cursor is persisted to a single JSON
 * file written atomically (temp + fsync + rename + dir fsync).
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
  async getCursor(): Promise<BlockCursor | undefined> {
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

    return state.cursor
  }

  /**
   * Atomically persists the checkpoint cursor: write a temp file, fsync it, rename over the
   * state file, then fsync the directory so the rename is durable. Called only after every open
   * writer for the checkpoint has been published.
   */
  async saveCursor(cursor: BlockCursor): Promise<void> {
    const payload: PersistedState = this.#id ? { id: this.#id, cursor } : { cursor }
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
        PQ_ERR.STATE_CORRUPT,
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

  /** Deletes every published `<min>-<max>.parquet` whose `max` exceeds the committed cursor. */
  async #deleteFilesAboveCursor(cursorNumber: number): Promise<void> {
    let removed = 0
    for (const table of this.#tables) {
      const dir = path.join(this.#baseDir, table)
      const entries = await readdir(dir).catch(() => [] as string[])
      for (const name of entries) {
        const match = DATA_FILE_RE.exec(name)
        if (!match) continue

        const maxBlock = Number.parseInt(match[2], 10)
        if (maxBlock > cursorNumber) {
          await unlink(path.join(dir, name)).catch(() => {})
          removed++
        }
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
