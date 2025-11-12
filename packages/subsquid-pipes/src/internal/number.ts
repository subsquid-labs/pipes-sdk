export function parseNumber(value: string, error?: string): number {
  const parsed = parseInt(value, 10)
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(error || `Value "${value}" is not a valid safe integer`)
  }

  return parsed
}
