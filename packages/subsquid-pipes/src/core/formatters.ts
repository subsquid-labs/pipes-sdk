/**
 * Formats a number with US locale and up to 2 decimal places.
 *
 * Adds thousands separators and limits decimals to two digits.
 *
 * @param value - The number to format.
 * @returns The formatted number string (e.g., "1,234.56").
 * @example
 * formatNumber(1000) // "1,000"
 * formatNumber(1234.5678) // "1,234.57"
 */
export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

export function formatBlock(value: number | string) {
  return typeof value === 'number' ? formatNumber(value) : value
}

/**
 * Converts a number of bytes into a human-readable string using appropriate units.
 *
 * Automatically scales the value into KB, MB, GB, or TB as needed.
 *
 * @param bytes - The number of bytes.
 * @returns A human-readable string representation of the byte size.
 * @example
 * humanBytes(2048) // "2.00 KB"
 * humanBytes(1048576) // "1.00 MB"
 */
export function humanBytes(bytes: number) {
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < sizes.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(2)} ${sizes[i]}`
}

/**
 * Converts a duration in seconds to a human-readable estimated time string.
 *
 * Provides ETA in minutes/seconds, hours/minutes, or days/hours depending on the input.
 *
 * @param seconds - Duration in seconds. If undefined, displays a calculating message.
 * @returns A formatted ETA string.
 * @example
 * displayEstimatedTime(90) // "ETA: 1m 30s"
 * displayEstimatedTime(3700) // "ETA: 1h 1m"
 * displayEstimatedTime(90000) // "ETA: 1d 1h"
 */
export function displayEstimatedTime(seconds?: number) {
  if (typeof seconds === 'undefined' || Number.isNaN(seconds) || !Number.isFinite(seconds)) {
    return 'ETA: calculating...' // unknown
  }

  if (seconds < 1) {
    return 'IN SYNC'
  }

  // less than an hour
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60)
    const remainingSeconds = Math.floor(seconds % 60)

    return `ETA: ${minutes}m ${remainingSeconds}s`
  }

  // less than a day
  if (seconds < 86400) {
    const hours = Math.floor(seconds / 3600)
    const minutes = Math.floor((seconds % 3600) / 60)

    return `ETA: ${hours}h ${minutes}m`
  }

  // days....:(
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)

  return `ETA: ${days}d ${hours}h`
}

export function parseBlockNumber(block: number | string) {
  if (typeof block === 'string') {
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

  return block
}

export function lines(str: string[]): string {
  return str.join('\n')
}
