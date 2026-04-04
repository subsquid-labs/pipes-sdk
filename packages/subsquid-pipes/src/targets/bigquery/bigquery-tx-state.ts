import type { BigQuery } from '@google-cloud/bigquery'

import type { BlockCursor } from '~/core/types.js'

export async function createStateTable(
  bq: BigQuery,
  dataset: string,
  stateTable: string,
): Promise<void> {
  await bq.query({
    query: `
      CREATE TABLE IF NOT EXISTS \`${dataset}.${stateTable}\` (
        id         STRING    NOT NULL,
        cursor     STRING    NOT NULL,
        updated_at TIMESTAMP NOT NULL
      )
    `,
    useLegacySql: false,
  })
}

export async function getCursor(
  bq: BigQuery,
  dataset: string,
  stateTable: string,
  id: string,
): Promise<BlockCursor | undefined> {
  const [rows] = await bq.query({
    query: `SELECT cursor FROM \`${dataset}.${stateTable}\` WHERE id = @id ORDER BY updated_at DESC LIMIT 1`,
    params: { id },
    useLegacySql: false,
  })
  if (rows.length === 0) return undefined
  return JSON.parse((rows[0] as { cursor: string }).cursor) as BlockCursor
}

/**
 * Returns a MERGE SQL statement that upserts the cursor for the given stream id.
 *
 * Values are interpolated directly (no query params) because BQ has known
 * quirks with parameterized queries combined with `connectionProperties` in
 * multi-statement sessions.  All interpolated values are validated/escaped
 * before use.
 */
export function buildSaveCursorSql(
  dataset: string,
  stateTable: string,
  id: string,
  cursor: BlockCursor,
): string {
  const escapedId = escapeSingleQuotes(id)
  const cursorJson = escapeSingleQuotes(JSON.stringify(cursor))

  return `
    MERGE \`${dataset}.${stateTable}\` AS target
    USING (SELECT '${escapedId}' AS id, '${cursorJson}' AS cursor, CURRENT_TIMESTAMP() AS updated_at) AS source
    ON target.id = source.id
    WHEN MATCHED THEN
      UPDATE SET cursor = source.cursor, updated_at = source.updated_at
    WHEN NOT MATCHED THEN
      INSERT (id, cursor, updated_at) VALUES (source.id, source.cursor, source.updated_at)
  `
}

function escapeSingleQuotes(s: string): string {
  return s.replace(/'/g, "\\'")
}
