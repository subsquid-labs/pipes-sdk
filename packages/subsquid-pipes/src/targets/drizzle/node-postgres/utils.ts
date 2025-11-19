/**
 * This limit is derived from the maximum value of a signed 16-bit integer, which is 32,767.
 */
const PG_DRIVER_MAX_PARAMETERS = 32_767

/**
 * Splits an array of records into smaller chunks based on PostgreSQL driver parameter limits.
 * This is necessary because PostgreSQL has a maximum number of parameters (32767) that can be used in a single query.
 *
 * @param data - Array of records to be split into chunks
 * @param size - Optional custom chunk size. If not provided or exceeds max-allowed size, will use calculated max size
 * @returns Generator yielding chunks of the original array
 * @example
 * ```ts
 * const records = [{id: 1, name: 'a'}, {id: 2, name: 'b'}]
 * for (const chunk of chunk(records)) {
 *   await db.insert(table).values(chunk)
 * }
 * ```
 */
export function* chunk<T>(data: readonly T[], size?: number) {
  // Calculate how many parameters each record will use in the query
  const parametersPerRecord = data[0] ? Object.keys(data[0]).length : 1
  // Calculate maximum chunk size based on Postgres parameter limit
  const maxSize = Math.floor(PG_DRIVER_MAX_PARAMETERS / parametersPerRecord)

  if (!size || size > maxSize) {
    size = maxSize
  }

  for (let i = 0; i < data.length; i += size) {
    yield data.slice(i, i + size)
  }
}
