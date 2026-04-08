import { createRequire } from 'node:module'

const _require = createRequire(typeof __filename !== 'undefined' ? __filename : import.meta.url)
const pkg = _require('../package.json')

export const npmVersion: string = pkg.version
