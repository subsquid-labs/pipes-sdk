import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Package name - must match package.json
const PACKAGE_NAME = '@iankressin/pipes-cli'

/**
 * Finds the package root directory by resolving the package location.
 * Works both in development (source) and production (bundled dist, npx).
 */
export function findPackageRoot(): string {
  // Method 1: In CJS (production bundled), use __dirname if available
  // This is the most reliable method when running as a bundled CJS file
  // @ts-expect-error - __dirname is available in CJS but not in ESM types
  if (typeof __dirname !== 'undefined') {
    // @ts-expect-error - __dirname is available in CJS
    let current = __dirname
    // Walk up from dist/ (or wherever the bundled file is) to find package.json
    const maxDepth = 10 // Prevent infinite loops
    let depth = 0
    while (current !== dirname(current) && depth < maxDepth) {
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
      depth++
    }
  }

  // Method 2: Try require.resolve - works in CJS natively
  // This should work when the package is properly installed
  try {
    if (typeof require !== 'undefined' && require.resolve) {
      const packageJsonPath = require.resolve(`${PACKAGE_NAME}/package.json`)
      if (existsSync(packageJsonPath)) {
        return dirname(packageJsonPath)
      }
    }
  } catch {
    // require.resolve failed, continue to next method
  }

  // Method 3: ESM mode - use createRequire with import.meta.url
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const requireFn = createRequire(import.meta.url)
      const packageJsonPath = requireFn.resolve(`${PACKAGE_NAME}/package.json`)
      return dirname(packageJsonPath)
    }
  } catch {}

  // Method 4: Fallback - search from current file location
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      const currentFile = fileURLToPath(import.meta.url)
      let current = dirname(currentFile)
      // Walk up to find package.json
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
  } catch {}

  // Method 5: Last resort - search from common locations
  const searchPaths = [
    join(process.cwd(), 'node_modules', PACKAGE_NAME),
    process.cwd(),
  ]

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

  // Final fallback - should not reach here in normal circumstances
  throw new Error(
    `Could not find package root for ${PACKAGE_NAME}. Please ensure the package is properly installed.`,
  )
}
