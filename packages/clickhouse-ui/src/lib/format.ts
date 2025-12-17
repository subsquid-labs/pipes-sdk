export function formatNumber(
  value: number | string | null | undefined,
  options?: Intl.NumberFormatOptions,
  locale: string = 'en-US',
): string {
  if (value === null || value === undefined) return '—'
  const num = typeof value === 'number' ? value : Number(value)
  if (Number.isNaN(num)) return String(value)
  return new Intl.NumberFormat(locale, options).format(num)
}

export function formatBytes(bytes: number) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const
  let unitIndex = 0
  let scaled = value
  while (scaled >= 1024 && unitIndex < units.length - 1) {
    scaled /= 1024
    unitIndex++
  }
  const fractionDigits = unitIndex === 0 ? 0 : scaled >= 100 ? 1 : 2
  return `${scaled.toFixed(fractionDigits)} ${units[unitIndex]}`
}

export function formatSeconds(seconds: number) {
  return formatNumber(seconds, { minimumFractionDigits: 3, maximumFractionDigits: 6 })
}
