import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findPackageRoot } from '~/utils/package-root.js'

/**
 * Get __dirname that works in both ESM and CJS.
 * Returns the directory containing template files (pipes/evm or pipes/svm).
 * Always uses findPackageRoot to ensure correct path resolution.
 *
 * @param folder - The folder name to get the directory for (evm or svm)
 */
export function getTemplateDirname(folder: 'evm' | 'svm'): string {
  const packageRoot = findPackageRoot()

  const distTemplatePath = join(packageRoot, 'dist', 'commands', 'init', 'templates', 'pipes', folder)
  const srcTemplatePath = join(packageRoot, 'src', 'commands', 'init', 'templates', 'pipes', folder)

  if (existsSync(distTemplatePath)) {
    return distTemplatePath
  }

  if (existsSync(srcTemplatePath)) {
    return srcTemplatePath
  }

  // Last resort: return src path even if it doesn't exist (will error with clear message)
  return srcTemplatePath
}