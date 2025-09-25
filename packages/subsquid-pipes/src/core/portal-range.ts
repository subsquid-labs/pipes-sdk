import { NaturalRange } from './query-builder'

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

export function parsePortalRange(range: PortalRange, defaultValue?: PortalRange): NaturalRange {
  range = range || defaultValue

  if (range.from === 'latest') {
    return { from: 'latest', to: range.to ? parseBlock(range.to) : undefined }
  }

  const from = parseBlock(range.from || '0')

  const to = range.to ? parseBlock(range.to, from) : undefined

  return { from, to }
}
export type PortalRange = {
  from?: number | string | 'latest'
  to?: number | string
}
