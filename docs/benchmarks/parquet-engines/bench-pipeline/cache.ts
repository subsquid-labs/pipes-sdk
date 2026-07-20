import { portalSqliteCache } from '../../../../packages/pipes/src/portal-cache/node/index.js'

export function openCache(path?: string) {
  return path ? portalSqliteCache({ path }) : undefined
}
