export interface RangeLike {
  from: string
  to?: string
}

function toBlockNumber(value: string): number {
  if (value === 'latest') return Number.POSITIVE_INFINITY
  return Number(value.replace(/[_,]/g, ''))
}

export function oldestRange<T extends RangeLike>(a: T, b: T): T {
  const na = toBlockNumber(a.from)
  const nb = toBlockNumber(b.from)
  if (Number.isNaN(nb)) return a
  if (Number.isNaN(na)) return b
  return nb < na ? b : a
}
