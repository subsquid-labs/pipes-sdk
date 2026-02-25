import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { defineConfig } from 'tsup'

/**
 * Copy templates to dist after build.
 *
 * This is a temporary solution. Once this package is integrated into the main branch,
 * templates will be read from the git main branch instead of being bundled.
 */
function copyTemplates() {
  const srcTemplateDir = 'src/template'
  const distTemplateDir = 'dist/template'

  if (!existsSync(srcTemplateDir)) {
    return
  }

  function copyRecursive(src: string, dest: string) {
    if (!existsSync(dest)) {
      mkdirSync(dest, { recursive: true })
    }

    const entries = readdirSync(src)

    for (const entry of entries) {
      const srcPath = join(src, entry)
      const destPath = join(dest, entry)
      const stat = statSync(srcPath)

      if (stat.isDirectory()) {
        copyRecursive(srcPath, destPath)
      } else {
        copyFileSync(srcPath, destPath)
      }
    }
  }

  copyRecursive(srcTemplateDir, distTemplateDir)
}

export default defineConfig([
  // Main CLI entry - CJS only (for binary)
  {
    entry: ['src/index.ts'],
    outDir: 'dist',
    format: ['cjs'],
    clean: true,
    bundle: true,
    splitting: false,
    sourcemap: true,
    tsconfig: 'tsconfig.json',
    banner: {
      js: '#!/usr/bin/env node\n',
    },
    onSuccess: async () => {
      copyTemplates()
    },
  },
  // Config files - both ESM and CJS (for UI and CLI)
  {
    entry: {
      'config/networks': 'src/commands/init/config/networks.ts',
      'config/templates': 'src/commands/init/config/templates.ts',
      'config/sinks': 'src/commands/init/config/sinks.ts',
      'services/sqd-abi': 'src/services/sqd-abi.ts',
    },
    outDir: 'dist',
    format: ['esm', 'cjs'],
    clean: false,
    bundle: true,
    splitting: false,
    sourcemap: true,
    tsconfig: 'tsconfig.json',
    dts: true,
  },
])
