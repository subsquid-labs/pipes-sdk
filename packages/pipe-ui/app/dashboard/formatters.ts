export function humanBytes(bytes: number) {
  const sizes = ['bytes', 'KB', 'MB', 'GB', 'TB']
  let i = 0
  while (bytes >= 1024 && i < sizes.length - 1) {
    bytes /= 1024
    i++
  }
  return `${bytes.toFixed(2)} ${sizes[i]}`
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value)
}

export function formatBlock(value: number | string) {
  return typeof value === 'number' ? formatNumber(value) : value
}

export function displayEstimatedTime(seconds?: number) {
  if (typeof seconds === 'undefined' || Number.isNaN(seconds) || !Number.isFinite(seconds)) {
    return '' // unknown
  }

  if (seconds < 1) {
    return 'Synced'
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
