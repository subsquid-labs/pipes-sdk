import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { findPackageRoot } from '~/utils/package-root.js'

/**
 * Get __dirname that works in both ESM and CJS.
 * Returns the directory containing template files (pipes/evm or pipes/svm).
 * In ESM (build time), uses import.meta.url. In CJS (runtime), uses findPackageRoot.
 * 
 * @param chainType - 'evm' or 'svm' to specify which template directory to use
 */
export function getDirname(chainType: 'evm' | 'svm'): string {
  try {
    // ESM: use import.meta.url (works during build)
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const url = import.meta.url
      if (url && url !== 'undefined') {
        return dirname(fileURLToPath(url))
      }
    }
  } catch {
    // import.meta.url is undefined or invalid (CJS context)
  }

  const packageRoot = findPackageRoot()
  
  const distTemplatePath = join(packageRoot, 'dist', 'template', 'pipes', chainType)
  const srcTemplatePath = join(packageRoot, 'src', 'template', 'pipes', chainType)
  
  if (existsSync(distTemplatePath)) {
    return distTemplatePath
  }
  
  if (existsSync(srcTemplatePath)) {
    return srcTemplatePath
  }
  
  // Last resort: return dist path even if it doesn't exist (will error with clear message)
  return distTemplatePath
}

