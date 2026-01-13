import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { findPackageRoot } from '~/utils/package-root.js'

/**
 * Get __dirname that works in both ESM and CJS.
 * Returns the directory containing template files (pipe-templates/evm or pipe-templates/svm).
 * Always uses findPackageRoot to ensure correct path resolution.
 *
 * @param folder - The folder name to get the directory for (evm or svm)
 */
export function getTemplateDirname(folder: 'evm' | 'svm'): string {
  const packageRoot = findPackageRoot()

  const distTemplatePath = join(packageRoot, 'dist', 'templates', 'pipe-templates', folder)
  const srcTemplatePath = join(packageRoot, 'src', 'templates', 'pipe-templates', folder)

  if (existsSync(distTemplatePath)) {
    return distTemplatePath
  }

  if (existsSync(srcTemplatePath)) {
    return srcTemplatePath
  }

  // Last resort: return src path even if it doesn't exist (will error with clear message)
  return srcTemplatePath
}