import type { BigQueryStore } from './bigquery-store.js'
import type { TrackedTable } from './tables.js'

export type TrackedTableLocation = {
  /** Unqualified table name. */
  table: string
  /** Fully-qualified `dataset.table`. */
  fqn: string
  /** The column we DELETE on during fork cleanup. */
  blockNumberColumn: string
}

/**
 * Per-target registry of user data tables and their fork-cleanup behavior.
 *
 * The tracker owns one method that matters: `fork(safe, upper)`. It dispatches one DELETE
 * per registered table in parallel via `Promise.all` — serial dispatch would multiply BQ
 * job latency (1-5s each) by the number of tracked tables, which makes a 10-table fork
 * take 10-50 seconds instead of one round trip.
 */
export class BigQueryTracker {
  readonly #tables: TrackedTableLocation[]
  readonly #store: BigQueryStore

  constructor({
    store,
    tables,
    dataset,
    projectId,
  }: {
    store: BigQueryStore
    tables: TrackedTable[]
    dataset: string
    projectId: string
  }) {
    this.#store = store
    this.#tables = tables.map((t) => ({
      table: t.table,
      fqn: `${projectId}.${dataset}.${t.table}`,
      blockNumberColumn: t.blockNumberColumn,
    }))
  }

  /**
   * Delete every row whose block_number is strictly greater than `safeBlockNumber` and at most
   * `upperBlockNumber` from every registered table.
   *
   * Both bounds are mandatory in the SQL — without the upper bound BigQuery's planner cannot
   * statically prune partitions, so DELETE scans every partition above safe (frequently the
   * whole table at scale). With both bounds it walks only the affected partitions.
   *
   * Parameterized values prevent SQL injection from any user-controlled cursor input. The DML
   * runs as a single statement per table (BigQuery disallows multi-statement transactions on
   * recently streamed data, so we cannot wrap multiple DELETEs in BEGIN/COMMIT).
   *
   * Returns the per-table affected-row counts in registration order.
   */
  async fork(safeBlockNumber: number, upperBlockNumber: number): Promise<{ table: string; rowCount: number }[]> {
    if (this.#tables.length === 0) return []

    return Promise.all(
      this.#tables.map(async (t) => {
        const sql = `DELETE FROM \`${t.fqn}\` WHERE \`${t.blockNumberColumn}\` > @safe AND \`${t.blockNumberColumn}\` <= @upper`
        const result = await this.#store.executeDml(sql, { safe: safeBlockNumber, upper: upperBlockNumber })
        return { table: t.table, rowCount: result.rowCount }
      }),
    )
  }

  /** @internal — exposed for testing. */
  get _tables(): readonly TrackedTableLocation[] {
    return this.#tables
  }
}
