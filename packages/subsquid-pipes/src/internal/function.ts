/** Sleeps for the given number of milliseconds. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Retries the given async function up to `retries` times with an optional delay between attempts. */
export async function doWithRetry<T>(
  fn: () => Promise<T>,
  { retries = 3, delayMs = 0, title }: { retries?: number; delayMs?: number; title?: string } = {},
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (attempt === retries) {
        throw error
      }

      if (delayMs > 0) {
        await sleep(delayMs)
      }
    }
  }

  throw new Error(`Maximum number of ${title ? `${title} ` : ''}retries (${retries}) exceeded`)
}
