import { portalSqliteCache } from '../../src/portal-cache/node/index.js'

export function openCache(path?: string) {
  return path ? portalSqliteCache({ path }) : undefined
}
