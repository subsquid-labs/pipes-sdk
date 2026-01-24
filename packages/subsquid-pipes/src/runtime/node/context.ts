import { AsyncLocalStorage } from 'node:async_hooks'

import { MetricsServer } from '~/core/index.js'
import { Logger } from '~/core/logger.js'

export type RuntimeContext = {
  id: string
  logger: Logger
  metrics: MetricsServer
}

const asyncLocalStorage = new AsyncLocalStorage<RuntimeContext>()

export function useRuntimeContext(): RuntimeContext | undefined {
  return asyncLocalStorage.getStore()
}

export async function runWithContext(ctx: RuntimeContext, fn: () => Promise<void>) {
  return asyncLocalStorage.run(ctx, fn)
}
