import { NaturalRange } from './query-builder.js'

export function parseBlockFormatting(block: string | number) {
  if (typeof block === 'number') return block
  /**
   * Remove commas and underscores
   * 1_000_000 -> 1000000
   * 1,000,000 -> 1000000
   */
  const value = Number(block.replace(/[_,]/g, ''))
  if (Number.isNaN(value)) {
    throw new Error(
      `Can't parse a block number from string "${block}". Valid examples: "1000000", "1_000_000", "1,000,000"`,
    )
  }

  return value
}

function parseBlock(block: string | number, offset?: number) {
  if (typeof block === 'number') return block

  if (block.startsWith('+') && offset) {
    return offset + parseBlockFormatting(block.substring(1))
  }

  return parseBlockFormatting(block)
}

/**
 * Checks if a string looks like an ISO date (e.g., "2024-01-01", "2024-01-01T00:00:00Z")
 */
function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}/.test(value)
}

function toDate(value: string): Date {
  // Treat date-only strings as UTC (e.g., "2024-01-01" → "2024-01-01T00:00:00Z")
  const date = new Date(value.includes('T') ? value : `${value}T00:00:00Z`)
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date value: "${value}"`)
  }
  return date
}

function parseBlockOrTimestamp(value: number | string | Date, offset?: number): number | Date {
  if (value instanceof Date) return value
  if (typeof value === 'string' && isDateString(value)) return toDate(value)

  return parseBlock(value, offset)
}

export function parsePortalRange(range: PortalRange, defaultValue?: PortalRange): NaturalRange {
  range = range || defaultValue

  if (range.from === 'latest') {
    const to = range.to ? parseBlockOrTimestamp(range.to) : undefined
    return { from: 'latest', to }
  }

  const from = range.from ? parseBlockOrTimestamp(range.from) : 0
  const to = range.to ? parseBlockOrTimestamp(range.to, typeof from === 'number' ? from : undefined) : undefined

  return { from, to }
}

export type PortalRange = {
  from?: number | string | 'latest' | Date
  to?: number | string | Date
}
