export function useRuntimeContext(): undefined {
  return undefined
}

async function runWithContext(ctx: any, fn: () => Promise<void>) {
  return fn()
}
