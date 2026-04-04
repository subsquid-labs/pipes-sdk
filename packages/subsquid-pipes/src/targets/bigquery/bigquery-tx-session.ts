import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'

import type { BigQuery } from '@google-cloud/bigquery'

/**
 * A single BigQuery session wrapping one BEGIN/COMMIT transaction.
 *
 * The session ID is persisted to a file immediately after the session is
 * created (before any DML), so that a crash mid-batch leaves a recoverable
 * session ID.  On the next startup, `terminateDanglingSession` reads the file
 * and terminates the leftover session before any new work begins.
 */
export class BigQuerySession {
  private constructor(
    private bq: BigQuery,
    readonly sessionId: string,
    private sessionFilePath: string,
  ) {}

  /**
   * Opens a new session and begins a transaction.
   * Writes the session ID to `sessionFilePath` before returning so that a crash
   * after this point can be recovered on restart.
   */
  static async create(bq: BigQuery, sessionFilePath: string): Promise<BigQuerySession> {
    const [job] = await bq.createQueryJob({
      query: 'BEGIN TRANSACTION',
      createSession: true,
      useLegacySql: false,
    })

    const [metadata] = await job.getMetadata()
    const sessionId: string = metadata.statistics.sessionInfo.sessionId

    // Persist before any DML so a crash is recoverable
    writeFileSync(sessionFilePath, sessionId, 'utf8')

    return new BigQuerySession(bq, sessionId, sessionFilePath)
  }

  /**
   * Executes a query within this session's transaction.
   */
  query(
    sql: string,
    params?: Record<string, any>,
    types?: Record<string, any>,
  ): Promise<any[]> {
    return this.bq
      .query({
        query: sql,
        params,
        types,
        connectionProperties: [{ key: 'session_id', value: this.sessionId }],
        useLegacySql: false,
      })
      .then((r) => r[0])
  }

  /**
   * Commits the transaction, terminates the session, and deletes the session file.
   */
  async commit(): Promise<void> {
    await this.query('COMMIT TRANSACTION')
    await this.abortSession()
  }

  /**
   * Rolls back the transaction, terminates the session, and deletes the session file.
   */
  async rollback(): Promise<void> {
    await this.query('ROLLBACK TRANSACTION')
    await this.abortSession()
  }

  private async abortSession(): Promise<void> {
    await this.bq.query({
      query: `CALL BQ.ABORT_SESSION('${this.sessionId}')`,
      useLegacySql: false,
    })
    this.deleteSessionFile()
  }

  private deleteSessionFile(): void {
    try {
      unlinkSync(this.sessionFilePath)
    } catch {
      // Already deleted — nothing to do
    }
  }
}

/**
 * Called on startup.  If a session ID file exists from a previous crash,
 * terminates that session and removes the file.
 *
 * Errors indicating the session is already gone (expired, not found, not
 * active) are swallowed — the file is still deleted so the next run starts
 * clean.
 */
export async function terminateDanglingSession(
  bq: BigQuery,
  sessionFilePath: string,
): Promise<void> {
  if (!existsSync(sessionFilePath)) return

  const sessionId = readFileSync(sessionFilePath, 'utf8').trim()

  if (sessionId) {
    try {
      await bq.query({
        query: `CALL BQ.ABORT_SESSION('${sessionId}')`,
        useLegacySql: false,
      })
    } catch (e) {
      if (!isSessionGoneError(e)) throw e
      console.error(`Caught error "${(e as Error).message}" when terminating dangling session - deemed safe to ignore`)
      // Session already expired/terminated — safe to ignore
    }
  }

  try {
    unlinkSync(sessionFilePath)
  } catch {
    // Already deleted concurrently — nothing to do
  }
}

function isSessionGoneError(e: unknown): boolean {
  if (!(e instanceof Error)) return false
  const msg = e.message.toLowerCase()
  return (
    msg.includes('session not found') ||
    msg.includes('not active') ||
    msg.includes('session has expired') ||
    msg.includes('invalid session') ||
    msg.includes('no active session')
  )
}
