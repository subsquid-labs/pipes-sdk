import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findPackageRoot } from '~/utils/package-root.js'

/**
 * Get __dirname that works in both ESM and CJS.
 * Returns the directory containing template files (pipes/evm or pipes/svm).
 * Always uses findPackageRoot to ensure correct path resolution.
 *
 * @param chainType - 'evm' or 'svm' to specify which template directory to use
 */
export function getDirname(chainType: 'evm' | 'svm'): string {
  const packageRoot = findPackageRoot()

  const distTemplatePath = join(packageRoot, 'dist', 'template', 'pipes', chainType)
  const srcTemplatePath = join(packageRoot, 'src', 'template', 'pipes', chainType)

  if (existsSync(distTemplatePath)) {
    return distTemplatePath
  }

  if (existsSync(srcTemplatePath)) {
    return srcTemplatePath
  }

  // Last resort: return src path even if it doesn't exist (will error with clear message)
  return srcTemplatePath
}
