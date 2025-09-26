export function arrayify<T>(data: T | T[]): T[] {
  return Array.isArray(data) ? data : [data]
}

export function last<T>(arr: T[]): T {
  if (!arr.length) {
    throw new Error(`last() called on empty array`)
  }

  return arr[arr.length - 1]
}

export function nonNullable<T>(value: T): value is NonNullable<T> {
  return value !== null && value !== undefined
}
