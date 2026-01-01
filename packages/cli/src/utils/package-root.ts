import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// Package name - must match package.json
// Using dynamic import to get the actual package name from package.json
const PACKAGE_NAME = '@iankressin/pipes-cli'

/**
 * Finds the package root directory by resolving the package location.
 * Works both in development (source) and production (bundled dist, npx).
 */
export function findPackageRoot(): string {
  // Try require.resolve - works in CJS natively, works in ESM via createRequire
  try {
    if (typeof require !== 'undefined' && require.resolve) {
      // CJS mode - use require.resolve directly
      const packageJsonPath = require.resolve(`${PACKAGE_NAME}/package.json`)
      return dirname(packageJsonPath)
    }
  } catch {}

  // ESM mode - use createRequire
  try {
    // In CJS, import.meta.url is undefined, so we need a valid URL for createRequire
    let requireContext: string
    try {
      if (typeof import.meta !== 'undefined' && import.meta.url) {
        requireContext = import.meta.url
      } else {
        throw new Error('CJS mode - use require.resolve path above')
      }
    } catch {
      throw new Error('Cannot create require context')
    }
    
    const requireFn = createRequire(requireContext)
    const packageJsonPath = requireFn.resolve(`${PACKAGE_NAME}/package.json`)
    return dirname(packageJsonPath)
  } catch {
    // Fallback: search from common locations
    const searchPaths = [join(process.cwd(), 'node_modules', PACKAGE_NAME), process.cwd()]

    for (const start of searchPaths) {
      let current = start
      while (current !== dirname(current)) {
        const packageJsonPath = join(current, 'package.json')
        if (existsSync(packageJsonPath)) {
          try {
            const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
            if (packageJson.name === PACKAGE_NAME) {
              return current
            }
          } catch {
            // Continue
          }
        }
        current = dirname(current)
      }
    }

    return process.cwd()
  }
}
