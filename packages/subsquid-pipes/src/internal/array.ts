export function arrayify<T>(data: T | T[]): T[] {
  return Array.isArray(data) ? data : [data]
}

export function last<T>(arr: T[]): T {
  return arr[arr.length - 1]
}
